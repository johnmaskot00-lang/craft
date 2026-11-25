// Run with the media stub loader: all database and model calls are local fixtures.
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import express from "express";

const originalFetch = globalThis.fetch;
const originalCwd = process.cwd();
const oldIndex = "<!doctype html><html><head><title>Site</title></head><body><main><h1>Old title</h1><p>Original copy.</p></main></body></html>";
const oldAbout = "<!doctype html><html><head><title>About</title></head><body><main><p>Old description</p></main></body></html>";
const newIndex = "<!doctype html><html><head><title>Site</title></head><body><main class=\"new-grid\"><section><h1>New layout</h1><p>Original copy.</p></section></main></body></html>";
const finishedHero = '<section data-craft-scrollanim="1"><canvas></canvas></section><style>canvas{display:block}</style><script>/* hero engine */</script>';
const cssFilename = "assets/style.css";
const oldCss = "h1 { color: black; }\np { color: gray; }\n";
const newCss = oldCss.replace("color: black", "color: red");
const patch = (filename: string, search: string, replace: string) => ({ name: "apply_patch", args: { filename, search, replace } });
const finish = { name: "finish", args: { summary: "Применены запрошенные изменения в исходном коде." } };
const scenarios = ["patch", "write", "partial", "css", "stream-only", "db-reject", "malformed-tool", "truncated", "provider-error", "empty-html"] as const;

async function main() {
  // Only this child test process is affected. Don't let inherited service
  // credentials, provider config, or default Postgres settings escape the fixture.
  const platformEnv = /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|HOME|USERPROFILE|TEMP|TMP|TMPDIR)$/i;
  for (const key of Object.keys(process.env)) {
    if (!platformEnv.test(key)) delete process.env[key];
  }
  Object.assign(process.env, {
    NODE_ENV: "test", REDIS_URL: "", DB_POOL_MAX: "1", CRAFT_RUN_WORKER: "0",
    ROUTER_CHEAP_API_KEY: "test", ROUTER_CHEAP_BASE_URL: "https://router.cheap",
    CRAFT_GEMINI_ROUTER_MODELS: "gemini-4-neon,gpt-6.2-sol,kimi-k3.1-pro",
    CRAFT_SITE_BLOB_MIN_BYTES: "256",
  });
  const pgl = await PGlite.create();
  const dbServer = new PGLiteSocketServer({ db: pgl, host: "127.0.0.1", port: 0 });
  const scratch = await mkdtemp(path.join(process.env.TMPDIR || tmpdir(), "craft-edit-itest-"));
  let origin = "";
  let mode: (typeof scenarios)[number] = "patch";
  const modelRequests: Array<{ pathname: string; body: any }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (origin && url.origin === origin) return originalFetch(input, init);
    assert.equal(url.origin, "https://router.cheap", `unexpected outbound request: ${url.origin}`);
    const body = JSON.parse(String(init?.body || "{}"));
    modelRequests.push({ pathname: url.pathname, body });
    assert.equal(modelRequests.length, 1, "no extra paid request or alternate model");
    if (mode === "stream-only") return Response.json({ type: "error", error: { type: "invalid_request_error", message: "Streaming is required for this request" } }, { status: 400 });
    if (mode === "provider-error") return Response.json({ error: { message: "PRIVATE_UPSTREAM_DETAIL" } }, { status: 503 });
    const calls = mode === "write" ? [{ name: "write_page", args: { filename: "index.html", code: `Код страницы:\n\`\`\`html\n${newIndex}\n\`\`\`` } }, finish]
      : mode === "partial" ? [patch("about.html", "<p>Old description</p>", "<p>New description</p>"), patch("index.html", "<div>Not present</div>", "<div>Discard me</div>"), finish]
      : mode === "css" ? [patch(cssFilename, "color: black", "color: red"), finish]
      : mode === "empty-html" ? [patch("index.html", oldIndex, ""), finish]
      : mode === "db-reject" ? [patch("index.html", "<h1>Old title</h1>", "<h1>New title</h1>"), patch("about.html", "<p>Old description</p>", "<p>DB_REJECT</p>"), finish]
      : [patch("index.html", "<h1>Old title</h1>", "<h1>New title</h1>"), patch("about.html", "<p>Old description</p>", "<p>New description</p>"), finish];
    if (url.pathname === "/v1/messages") {
      return Response.json({ id: "msg_test", type: "message", role: "assistant", model: body.model,
        content: calls.map((call, i) => ({ type: "tool_use", id: `call_${i}`, name: call.name, input: call.args })),
        stop_reason: mode === "truncated" ? "model_context_window_exceeded" : "tool_use",
        stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } });
    }
    assert.equal(url.pathname, "/v1/chat/completions");
    const toolCalls = calls.map((call, i) => ({ id: `call_${i}`, type: "function",
      function: { name: call.name, arguments: JSON.stringify(call.args) } }));
    if (mode === "malformed-tool") toolCalls.splice(1, 0, { id: "malformed", type: "function", function: { name: "", arguments: "{}" } });
    return Response.json({ choices: [{ finish_reason: "tool_calls", message: {
      role: "assistant", content: calls.length ? null : "I will edit later.", tool_calls: toolCalls,
    } }] });
  }) as typeof fetch;

  const app = express();
  app.use(express.json());
  const http = createServer(app);
  let closePool: (() => Promise<void>) | undefined;
  try {
    const schema = await import("../shared/schema.ts");
    const statements = await generateMigration(generateDrizzleJson({}), generateDrizzleJson(schema));
    await pgl.exec(statements.join("\n"));
    await dbServer.start();
    process.env.DATABASE_URL = `postgres://postgres@${dbServer.getServerConn()}/postgres`;
    const { pool, db } = await import("../server/db.ts");
    closePool = () => pool.end();
    const { storage } = await import("../server/storage.ts");
    const { registerRoutes } = await import("../server/routes.ts");
    const { sql } = await import("drizzle-orm");
    process.chdir(scratch);
    await registerRoutes(http, app);
    http.listen(0, "127.0.0.1");
    await once(http, "listening");
    const addr = http.address();
    assert.ok(addr && typeof addr !== "string");
    origin = `http://127.0.0.1:${addr.port}`;

    const register = await fetch(`${origin}/api/auth/register`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "editor-itest@example.test", displayName: "Local test", password: "integration-fixture" }),
    });
    assert.equal(register.status, 201);
    const userId: number = (await register.json()).id;
    const cookie = register.headers.get("set-cookie")?.split(";", 1)[0];
    assert.ok(cookie);
    await db.execute(sql`UPDATE users SET credits = 300 WHERE id = ${userId}`);
    await db.execute(sql`ALTER TABLE project_files ADD CONSTRAINT test_file_write_rejection CHECK (code NOT LIKE '%DB_REJECT%')`);

    const selectedScenario = process.argv[2];
    const selectedScenarios = selectedScenario ? scenarios.filter((scenario) => scenario === selectedScenario) : scenarios;
    assert.ok(selectedScenarios.length, `unknown scenario: ${selectedScenario}`);
    for (const scenario of selectedScenarios) {
      mode = scenario;
      modelRequests.length = 0;
      const initialIndex = scenario === "write" ? oldIndex.replace("<body>", `<body>${finishedHero}`)
        : scenario === "css" ? oldIndex.replace("</head>", `<link rel="stylesheet" href="/${cssFilename}"></head>`) : oldIndex;
      const project = await storage.createProject({ userId, title: "Site", generatedCode: initialIndex });
      await storage.upsertProjectFile({ projectId: project.id, filename: "about.html", code: oldAbout });
      if (scenario === "css") await storage.upsertProjectFile({ projectId: project.id, filename: cssFilename, code: oldCss });
      const before = (await storage.getUser(userId))!.credits;
      const version = scenario === "write" || scenario === "stream-only" || scenario === "truncated" ? "v1" : "v2";
      const response = await fetch(`${origin}/api/projects/${project.id}/generate`, {
        method: "POST", headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          prompt: scenario === "write" ? "Полностью переделай дизайн страницы"
            : scenario === "css" ? "Сделай заголовок красным" : "Обнови тексты на указанных страницах",
          activeFile: "index.html", agentMode: "edit", agentVersion: version, mockupMode: false,
          ...(scenario === "css" ? { selectedElement: { tag: "h1", text: "Old title", outerSnippet: "<h1>Old title</h1>" } } : {}),
        }),
        signal: AbortSignal.timeout(15_000),
      });
      assert.equal(response.status, 200);
      const frames = (await response.text()).split("\n").filter((line) => line.startsWith("data: ")).map((line) => JSON.parse(line.slice(6)));
      assert.equal(modelRequests.length, 1, `${scenario}: one model request`);
      const { pathname, body } = modelRequests[0];
      assert.equal(pathname, version === "v1" ? "/v1/messages" : "/v1/chat/completions");
      const prompt = pathname === "/v1/messages" ? body.system : body.messages[0].content;
      assert.ok(prompt.includes(initialIndex) && prompt.includes(oldAbout), `${scenario}: exact sources in first request`);
      assert.deepEqual(body.tools.map((t: any) => t.name || t.function.name), ["apply_patch", "write_page", "finish"]);
      assert.ok(frames.some((frame) => /1 запрос/.test(frame.status || "")), `${scenario}: one-request status`);
      assert.ok(!frames.some((frame) => /шаг\s+\d+\//i.test(frame.status || "")));
      const done = frames.filter((frame) => frame.done);
      assert.equal(done.length, 1, `${scenario}: one final SSE event`);
      const result = done[0];
      const after = (await storage.getUser(userId))!.credits;
      const actualIndex = (await storage.getProject(project.id))!.generatedCode;
      const actualAbout = (await storage.getProjectFile(project.id, "about.html"))!.code;
      const jobs = await db.execute(sql`SELECT state FROM generation_jobs WHERE project_id = ${project.id}`);
      if (scenario === "patch" || scenario === "write" || scenario === "css") {
        assert.equal(result.error, undefined);
        assert.equal(result.creditsUsed, 30);
        assert.equal(after, before - 30);
        const expectedIndex = scenario === "write" ? newIndex.replace("<body>", `<body>\n${finishedHero}`)
          : scenario === "patch" ? oldIndex.replace("Old title", "New title") : initialIndex;
        assert.equal(actualIndex, expectedIndex);
        assert.equal(actualAbout, scenario === "patch" ? oldAbout.replace("Old description", "New description") : oldAbout);
        if (scenario === "css") {
          assert.ok(prompt.includes(oldCss), "linked stylesheet is present in the first request");
          assert.equal(result.editedFile, "index.html", "keep preview focused on the selected page");
          assert.deepEqual(result.editedFiles, [cssFilename]);
          assert.equal(result.fetchCode, true);
          const files = await (await fetch(`${origin}/api/projects/${project.id}/files`, { headers: { cookie } })).json();
          assert.equal(files.find((file: any) => file.filename === cssFilename)?.code, newCss);
        }
        assert.deepEqual(jobs.rows.map((job) => job.state), ["completed"]);
      } else {
        assert.ok(result.error, `${scenario}: fail without recovery`);
        assert.doesNotMatch(result.error, /PRIVATE_UPSTREAM_DETAIL|DB_REJECT|Failed query/i);
        assert.equal(result.refunded, true);
        assert.equal(result.refundAmount, 30);
        assert.equal(after, before);
        assert.equal(actualIndex, oldIndex, `${scenario}: no index write`);
        assert.equal(actualAbout, oldAbout, `${scenario}: no partial file write`);
        assert.equal(await storage.getProjectFile(project.id, "craft.md"), undefined);
        assert.deepEqual(jobs.rows.map((job) => job.state), ["failed"]);
      }
      console.log(`single-pass HTTP: ${scenario} passed`);
    }
  } finally {
    globalThis.fetch = originalFetch;
    process.chdir(originalCwd);
    if (http.listening) await new Promise<void>((resolve, reject) => http.close((err) => err ? reject(err) : resolve()));
    await closePool?.();
    await dbServer.stop();
    await pgl.close();
    await rm(scratch, { recursive: true, force: true });
  }
}

// registerRoutes installs long-lived maintenance timers; terminate this isolated test process.
main().then(() => process.exit(0), (err) => { console.error(err); process.exit(1); });
