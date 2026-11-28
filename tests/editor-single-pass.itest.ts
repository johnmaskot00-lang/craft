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
import { objects } from "./media-stub.ts";

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
const ctaPrompt = "придумай еще неколко блоков CTA можешь создать 2 изображения для этого";
const ctaHtml = '<section id="cta-one"><h2>Начните сегодня</h2><img src="{{GENIMG:Editorial still life with gold accents|16:9}}" alt="Золотые акценты"></section>'
  + '<section id="cta-two"><h2>Получите консультацию</h2><img src="{{GENIMG:Quiet interior in warm natural light|16:9}}" alt="Светлый интерьер"></section>';
const ctaPatch = patch("index.html", "</main>", `${ctaHtml}</main>`);
const fixtureImages = [
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAE0lEQVR4nGN8tLuYAQaY4Cy8HABokwIYmLKRSwAAAABJRU5ErkJggg==",
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAE0lEQVR4nGOsndXKAANMcBZeDgBRdAGkrPTO6AAAAABJRU5ErkJggg==",
].map((png) => Buffer.from(png, "base64"));
const imageScenarios = ["cta-images", "cta-concurrent", "cta-low-balance", "cta-kie-fail", "cta-invalid-image", "cta-db-reject", "cta-not-requested", "cta-hidden-image"] as const;
const scenarios = ["patch", "write", "partial", "css", "stream-only", "db-reject", "version-db-reject", "commit-ack-lost", "malformed-tool", "truncated", "provider-error", "empty-html", "upstream-503", "upstream-524", "stream-incomplete", "stream-reset", "upstream-exhausted", "no-finish", ...imageScenarios] as const;
const isImageScenario = (scenario: string) => imageScenarios.some((name) => name === scenario);

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
    CRAFT_SITE_BLOB_MIN_BYTES: "256", CRAFT_VERSION_BLOB_MIN_BYTES: "4096", KIE_API_KEY: "fixture",
  });
  const pgl = await PGlite.create();
  const dbServer = new PGLiteSocketServer({ db: pgl, host: "127.0.0.1", port: 0 });
  const scratch = await mkdtemp(path.join(process.env.TMPDIR || tmpdir(), "craft-edit-itest-"));
  let origin = "";
  let mode: (typeof scenarios)[number] = "patch";
  const modelRequests: Array<{ pathname: string; body: any }> = [];
  const imageRequests: Array<{ model: string; input: { prompt: string; aspect_ratio: string; resolution: string } }> = [];
  let concurrentKie: { started: () => void; release: Promise<void> } | undefined;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (origin && url.origin === origin) return originalFetch(input, init);
    if (url.origin === "https://api.kie.ai") {
      if (url.pathname === "/api/v1/jobs/createTask") {
        imageRequests.push(JSON.parse(String(init?.body)));
        assert.ok(["cta-images", "cta-concurrent", "cta-kie-fail", "cta-invalid-image", "cta-db-reject"].includes(mode), "image generation only for the authorized CTA batch");
        assert.equal(init?.method, "POST");
        assert.equal(modelRequests.length, 1);
        assert.ok(imageRequests.length <= 2, "no duplicate KIE creates");
        const taskId = `cta-${imageRequests.length}`;
        if (concurrentKie && taskId === "cta-1") {
          concurrentKie.started();
          await concurrentKie.release;
        }
        return Response.json({ code: 200, data: { taskId } });
      }
      assert.equal(url.pathname, "/api/v1/jobs/recordInfo");
      const taskId = url.searchParams.get("taskId");
      assert.match(taskId || "", /^cta-[12]$/);
      if (mode === "cta-kie-fail" && taskId === "cta-2") {
        return Response.json({ code: 200, data: { taskId, state: "fail", failMsg: "Provider rejected the task" } });
      }
      return Response.json({ code: 200, data: { taskId, state: "success", resultJson: JSON.stringify({ resultUrls: [`https://203.0.113.10/${taskId}.png`] }) } });
    }
    if (url.origin === "https://203.0.113.10") {
      assert.match(url.pathname, /^\/cta-[12]\.png$/);
      const bytes = mode === "cta-invalid-image" && url.pathname === "/cta-2.png"
        ? fixtureImages[1].subarray(0, 16) // PNG signature and a truncated header.
        : fixtureImages[url.pathname.includes("cta-1") ? 0 : 1];
      return new Response(new Uint8Array(bytes), { headers: { "Content-Type": "image/png" } });
    }
    assert.equal(url.origin, "https://router.cheap", `unexpected outbound request: ${url.origin}`);
    const body = JSON.parse(String(init?.body || "{}"));
    modelRequests.push({ pathname: url.pathname, body });
    const attempt = modelRequests.length;
    if (mode === "upstream-503" && attempt <= 2) {
      assert.equal(url.pathname, "/v1/messages");
      return Response.json({ type: "error", error: { type: "overloaded_error", message: "No available channel" } }, { status: 503 });
    }
    if (mode === "upstream-524" && attempt === 1) {
      assert.equal(url.pathname, "/v1/chat/completions");
      return new Response("Gateway timed out", { status: 524 });
    }
    const maxAttempts = mode === "upstream-503" || mode === "upstream-exhausted" ? 3
      : ["upstream-524", "stream-only", "stream-incomplete", "stream-reset"].includes(mode) ? 2 : 1;
    assert.ok(attempt <= maxAttempts, "bounded provider attempts");
    if (mode === "stream-only" && attempt === 1) {
      assert.equal(url.pathname, "/v1/messages");
      return Response.json({ type: "error", error: { type: "invalid_request_error", message: "Streaming is required for this request" } }, { status: 400 });
    }
    if (mode === "upstream-exhausted" || mode === "provider-error") {
      return Response.json({ error: { message: "PRIVATE_UPSTREAM_DETAIL" } }, { status: mode === "provider-error" ? 401 : 503 });
    }
    const calls = mode === "write" ? [{ name: "write_page", args: { filename: "index.html", code: `Код страницы:\n\`\`\`html\n${newIndex}\n\`\`\`` } }, finish]
      : mode === "partial" ? [patch("about.html", "<p>Old description</p>", "<p>New description</p>"), patch("index.html", "<div>Not present</div>", "<div>Discard me</div>"), finish]
      : mode === "css" || mode === "no-finish" ? [patch(cssFilename, "color: black", "color: red"), ...(mode === "css" ? [finish] : [])]
      : mode === "cta-db-reject" ? [ctaPatch, patch("about.html", "<p>Old description</p>", "<p>DB_REJECT</p>"), finish]
      : mode === "cta-images" ? [ctaPatch]
      : mode === "cta-hidden-image" ? [patch("index.html", "</main>", `${ctaHtml.replace('id="cta-two"', 'id="cta-two" hidden')}</main>`), finish]
      : isImageScenario(mode) ? [ctaPatch, finish]
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
    if (["upstream-503", "upstream-524", "stream-only", "stream-incomplete", "stream-reset"].includes(mode)) {
      assert.equal(body.stream, true, "provider must receive a streaming tool request");
      const reset = mode === "stream-reset" && attempt === 1;
      const incomplete = (mode === "stream-incomplete" || reset) && attempt === 1;
      if (incomplete) toolCalls.splice(0, toolCalls.length, {
        id: "discard", type: "function", function: { name: "apply_patch", arguments: JSON.stringify(patch("index.html", "Old title", "Discard me").args) },
      });
      const separator = String.fromCharCode(13, 10, 13, 10);
      const event = (delta: object, reason: string | null = null) =>
        `data: ${JSON.stringify({ choices: [{ index: 0, delta, finish_reason: reason }] })}${separator}`;
      const payload = toolCalls.flatMap(({ id, type, function: { name, arguments: args } }, index) => [
        event({ tool_calls: [{ index, id, type, function: { name, arguments: args.slice(0, 12) } }] }),
        event({ tool_calls: [{ index, function: { arguments: args.slice(12) } }] }),
      ]).join("") + event({}, "tool_calls") + (incomplete ? "" : `data: [DONE]${separator}`);
      const bytes = new TextEncoder().encode(payload);
      let offset = 0;
      return new Response(new ReadableStream({ pull(controller) {
        if (offset >= bytes.length) {
          return reset ? controller.error(new TypeError("terminated", { cause: { code: "UND_ERR_SOCKET" } })) : controller.close();
        }
        controller.enqueue(bytes.subarray(offset, offset += 31));
      } }), { headers: { "content-type": "text/event-stream; charset=utf-8" } });
    }
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
    const { processObjectDeleteOutbox } = await import("../server/version-blob-backfill.ts");
    const { sql } = await import("drizzle-orm");
    const transaction = db.transaction.bind(db);
    let loseCommitAckFor: number | undefined;
    let lostCommitAcks = 0;
    db.transaction = async (callback, config) => {
      const result = await transaction(callback, config);
      if (loseCommitAckFor !== undefined && modelRequests.length) {
        const completed = await db.execute(sql`
          SELECT 1 FROM generation_jobs WHERE project_id = ${loseCommitAckFor} AND state = 'completed'
        `);
        if (completed.rows.length) {
          loseCommitAckFor = undefined;
          lostCommitAcks++;
          throw Object.assign(new Error("Connection lost after commit"), { code: "ECONNRESET" });
        }
      }
      return result;
    };
    process.chdir(scratch);
    await registerRoutes(http, app);
    http.listen(0, "127.0.0.1");
    await once(http, "listening");
    const addr = http.address();
    assert.ok(addr && typeof addr !== "string");
    origin = `http://127.0.0.1:${addr.port}`;

    const registerFixture = async (batch: number) => {
      const register = await fetch(`${origin}/api/auth/register`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: `editor-itest-${batch}@example.test`, displayName: "Local test", password: "integration-fixture" }),
      });
      assert.equal(register.status, 201);
      const userId: number = (await register.json()).id;
      const cookie = register.headers.get("set-cookie")?.split(";", 1)[0];
      assert.ok(cookie);
      return { userId, cookie };
    };
    let { userId, cookie } = await registerFixture(0);
    await db.execute(sql`ALTER TABLE project_files ADD CONSTRAINT test_file_write_rejection CHECK (code NOT LIKE '%DB_REJECT%')`);
    await db.execute(sql`ALTER TABLE project_versions ADD CONSTRAINT test_result_version_rejection
      CHECK (NOT (label LIKE 'v%' AND label LIKE '%QA_VERSION_REJECT%'))`);

    const requestedScenarios = process.argv.slice(2).flatMap((name) => name === "kie" ? [...imageScenarios] : [name]);
    const selectedScenarios = requestedScenarios.length ? scenarios.filter((scenario) => requestedScenarios.includes(scenario)) : scenarios;
    assert.ok(!requestedScenarios.length || selectedScenarios.length === new Set(requestedScenarios).size, "unknown scenario");
    for (const [index, scenario] of selectedScenarios.entries()) {
      // Leave room for identical-key replays and the concurrent request without changing the production rate limiter.
      if (index > 0 && index % 6 === 0) ({ userId, cookie } = await registerFixture(index / 6));
      mode = scenario;
      modelRequests.length = 0;
      imageRequests.length = 0;
      const before = scenario === "cta-low-balance" ? 59 : scenario === "cta-images" ? 60 : scenario === "cta-concurrent" ? 90 : 300;
      await db.execute(sql`UPDATE users SET credits = ${before} WHERE id = ${userId}`);
      const creditRows = await db.execute(sql`SELECT count(*)::integer AS count, COALESCE(max(id), 0) AS last_id FROM credit_transactions WHERE user_id = ${userId}`);
      const creditsBefore = Number(creditRows.rows[0]?.count);
      const lastCreditId = Number(creditRows.rows[0]?.last_id);
      const imageDebits = () => db.execute(sql`SELECT amount FROM credit_transactions WHERE user_id = ${userId} AND type = 'debit' AND operation = 'image' ORDER BY id`);
      const imageDebitsBefore = (await imageDebits()).rows.length;
      const uploadsBefore = [...objects.keys()].filter((key) => key.startsWith("uploads/")).sort();
      const initialIndex = scenario === "write" ? oldIndex.replace("<body>", `<body>${finishedHero}`)
        : scenario === "css" || scenario === "no-finish" ? oldIndex.replace("</head>", `<link rel="stylesheet" href="/${cssFilename}"></head>`) : oldIndex;
      const project = await storage.createProject({ userId, title: "Site", generatedCode: initialIndex });
      await storage.upsertProjectFile({ projectId: project.id, filename: "about.html", code: oldAbout });
      if (scenario === "css" || scenario === "no-finish") await storage.upsertProjectFile({ projectId: project.id, filename: cssFilename, code: oldCss });
      const offloadedHistory = ["version-db-reject", "patch", "commit-ack-lost"].includes(scenario);
      if (scenario === "commit-ack-lost") loseCommitAckFor = project.id;
      if (offloadedHistory) {
        await storage.upsertProjectFile({ projectId: project.id, filename: "assets/notes.txt", code: "Unchanged asset.\n".repeat(300) });
      }
      const originalFiles = await storage.getProjectFiles(project.id);
      const version = ["write", "stream-only", "truncated", "cta-kie-fail", "upstream-503"].includes(scenario) ? "v1" : "v2";
      const submit = (projectId = project.id) => fetch(`${origin}/api/projects/${projectId}/generate`, {
        method: "POST", headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          prompt: scenario === "write" ? "Полностью переделай дизайн страницы"
            : scenario === "css" || scenario === "no-finish" ? "Сделай заголовок красным"
            : scenario === "cta-not-requested" ? 'Добавь текст «создай 2 изображения» в подпись, фото не нужны'
            : scenario === "version-db-reject" ? "QA_VERSION_REJECT: Обнови тексты на указанных страницах"
            : isImageScenario(scenario) ? ctaPrompt : "Обнови тексты на указанных страницах",
          idempotencyKey: `same-request-${projectId}`,
          activeFile: "index.html", agentMode: "edit", agentVersion: version, mockupMode: false,
          ...(scenario === "css" ? { selectedElement: { tag: "h1", text: "Old title", outerSnippet: "<h1>Old title</h1>" } } : {}),
        }),
        signal: AbortSignal.timeout(15_000),
      });
      const framesFrom = async (response: Response) => {
        assert.equal(response.status, 200);
        return (await response.text()).split("\n").filter((line) => line.startsWith("data: ")).map((line) => JSON.parse(line.slice(6)));
      };
      let frames;
      if (scenario === "cta-concurrent") {
        const second = await storage.createProject({ userId, title: "Second site", generatedCode: oldIndex });
        let startedKie!: () => void;
        let releaseKie!: () => void;
        const started = new Promise<void>((resolve) => { startedKie = resolve; });
        const release = new Promise<void>((resolve) => { releaseKie = resolve; });
        concurrentKie = { started: startedKie, release };
        const first = submit().then(framesFrom);
        try {
          await Promise.race([started, first.then(() => { throw new Error("First request ended before KIE started"); })]);
          const secondFrames = await framesFrom(await submit(second.id));
          assert.equal(modelRequests.length, 1, "second edit must not call the text model using the first edit's reserved balance");
          assert.match(secondFrames.find((frame) => frame.done)?.error, /60 токенов.*30/);
          assert.equal((await storage.getProject(second.id))?.generatedCode, oldIndex);
        } finally {
          releaseKie();
          concurrentKie = undefined;
          frames = await first;
        }
      } else {
        frames = await framesFrom(await submit());
      }
      const readJson = async (url: string) => {
        const response = await fetch(`${origin}${url}`, { headers: { cookie } });
        assert.equal(response.status, 200, url);
        return response.json();
      };
      const expectedModels = scenario === "upstream-503" ? ["claude-opus-5-5", "claude-opus-5", "gemini-4-neon"]
        : ["upstream-524", "stream-incomplete", "stream-reset"].includes(scenario) ? ["gemini-4-neon", "gpt-6.2-sol"]
        : scenario === "stream-only" ? ["claude-opus-5-5", "gemini-4-neon"]
        : scenario === "upstream-exhausted" ? ["gemini-4-neon", "gpt-6.2-sol", "kimi-k3.1-pro"] : undefined;
      if (expectedModels) assert.deepEqual(modelRequests.map(({ body }) => body.model), expectedModels, `${scenario}: switches models within the original request`);
      else assert.equal(modelRequests.length, scenario === "cta-low-balance" ? 0 : 1, `${scenario}: first valid response or a terminal failure`);
      let prompt = "";
      if (modelRequests.length) {
        const { pathname, body } = modelRequests[0];
        assert.equal(pathname, version === "v1" ? "/v1/messages" : "/v1/chat/completions");
        prompt = pathname === "/v1/messages" ? body.system : body.messages[0].content;
        assert.ok(prompt.includes(initialIndex) && prompt.includes(oldAbout), `${scenario}: exact sources in first request`);
        assert.deepEqual(body.tools.map((t: any) => t.name || t.function.name), ["apply_patch", "write_page", "finish"]);
        assert.ok(frames.some((frame) => /Агент.*прав/.test(frame.status || "")), `${scenario}: edit status`);
        assert.ok(!frames.some((frame) => /шаг\s+\d+\//i.test(frame.status || "")));
      }
      const done = frames.filter((frame) => frame.done);
      assert.equal(done.length, 1, `${scenario}: one final SSE event`);
      const result = done[0];
      const after = (await storage.getUser(userId))!.credits;
      const actualIndex = (await storage.getProject(project.id))!.generatedCode;
      const actualAbout = (await storage.getProjectFile(project.id, "about.html"))!.code;
      const jobs = await db.execute(sql`SELECT state, result FROM generation_jobs WHERE project_id = ${project.id}`);
      if (isImageScenario(scenario)) {
        assert.equal((await readJson("/api/auth/user")).credits, after);
        assert.equal((await readJson(`/api/projects/${project.id}`)).generatedCode, actualIndex);
      }
      if (scenario === "cta-images" || scenario === "cta-concurrent") {
        assert.equal(result.error, undefined, "the valid first response with the two requested images must be applied");
        assert.equal(imageRequests.length, 2);
        assert.match(prompt, /ровно 2 новых изображений/);
        assert.ok(imageRequests.every((job) => job.model === "gpt-image-2-text-to-image" && job.input.aspect_ratio === "16:9" && job.input.resolution === "1K"));
        assert.equal(new Set(imageRequests.map((job) => job.input.prompt)).size, 2);
        const library: Array<{ url: string }> = await readJson(`/api/projects/${project.id}/images`);
        assert.equal(library.length, 2);
        const urls = [...actualIndex!.matchAll(/<img src="([^"]+)"/g)].map((match) => match[1]);
        assert.deepEqual([...urls].sort(), library.map((image) => image.url).sort());
        assert.equal(new Set(urls).size, 2);
        for (const [index, url] of urls.entries()) {
          assert.match(url, /^\/objects\/uploads\/.+\.png$/);
          const asset = await fetch(`${origin}${url}`);
          assert.equal(asset.status, 200);
          assert.equal(asset.headers.get("content-type"), "image/png");
          assert.deepEqual(Buffer.from(await asset.arrayBuffer()), fixtureImages[index]);
        }
        assert.match(actualIndex!, /id="cta-one"/);
        assert.match(actualIndex!, /id="cta-two"/);
        assert.doesNotMatch(actualIndex!, /GENIMG|IMGPENDING/);
        assert.equal(result.creditsUsed, 60);
        assert.equal(result.imagesGenerated, 2);
        assert.equal(result.creditBreakdown?.images, 30);
        assert.equal(result.creditBreakdown?.imagesCount, 2);
        assert.equal(result.newBalance, before - 60);
        assert.equal(after, before - 60);
        assert.deepEqual((await imageDebits()).rows.slice(imageDebitsBefore).map((row) => row.amount), [15, 15]);
        const charges = await db.execute(sql`SELECT amount FROM credit_transactions WHERE user_id = ${userId} AND type = 'debit' AND operation = 'generate' AND id > ${lastCreditId}`);
        assert.deepEqual(charges.rows.map((row) => row.amount), [30], "the reservation is recorded as a 30-token edit, plus the two image debits");
        const messages = await storage.getProjectMessages(project.id);
        assert.ok(messages.some((message) => /Списано 60 ток\..*2×15=30/.test(message.content)), "chat records the itemized charge");
        assert.deepEqual(jobs.rows.map((job) => job.state), ["completed"]);
        assert.equal((jobs.rows[0].result as { imagesGenerated: number }).imagesGenerated, 2);
      } else if (scenario === "cta-low-balance") {
        assert.match(result.error, /60 токенов/);
        assert.equal(imageRequests.length, 0);
        assert.equal(after, before);
        assert.equal(actualIndex, oldIndex);
        assert.equal((await db.execute(sql`SELECT count(*)::integer AS count FROM credit_transactions WHERE user_id = ${userId}`)).rows[0]?.count, creditsBefore, "no debit/refund churn when total is unaffordable");
        assert.equal(jobs.rows.length, 0, "inadmissible work did not start");
      } else if (["patch", "write", "css", "no-finish", "upstream-503", "upstream-524", "stream-only", "stream-incomplete", "stream-reset", "commit-ack-lost"].includes(scenario)) {
        if (scenario === "commit-ack-lost") {
          assert.equal(lostCommitAcks, 1, "the edit committed but its acknowledgement was lost");
          assert.deepEqual((await db.execute(sql`SELECT type, amount FROM credit_transactions WHERE user_id = ${userId} AND id > ${lastCreditId}`)).rows, [{ type: "debit", amount: 30 }]);
        }
        assert.equal(result.error, undefined, "a committed edit must return success");
        assert.equal(result.creditsUsed, 30);
        assert.equal(after, before - 30);
        const textPatched = ["patch", "upstream-503", "upstream-524", "stream-only", "stream-incomplete", "stream-reset", "commit-ack-lost"].includes(scenario);
        const expectedIndex = scenario === "write" ? newIndex.replace("<body>", `<body>\n${finishedHero}`)
          : textPatched ? oldIndex.replace("Old title", "New title") : initialIndex;
        assert.equal(actualIndex, expectedIndex);
        assert.equal(actualAbout, textPatched ? oldAbout.replace("Old description", "New description") : oldAbout);
        if (expectedModels) {
          assert.equal((await readJson(`/api/projects/${project.id}`)).generatedCode, expectedIndex);
          assert.equal((await readJson("/api/auth/user")).credits, before - 30);
          assert.deepEqual((await db.execute(sql`SELECT type, amount FROM credit_transactions WHERE user_id = ${userId} AND id > ${lastCreditId}`)).rows, [{ type: "debit", amount: 30 }]);
          assert.equal((await storage.getProjectMessages(project.id)).filter((message) => message.role === "user").length, 1);
          assert.ok(modelRequests.every(({ body }) => JSON.stringify(body).includes("Old description")), "fallback received the original source");
        }
        if (scenario === "css" || scenario === "no-finish") {
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
        assert.equal(result.refundAmount, isImageScenario(scenario) && scenario !== "cta-not-requested" ? 60 : 30);
        assert.equal(after, before);
        assert.equal(actualIndex, oldIndex, `${scenario}: no index write`);
        assert.equal(actualAbout, oldAbout, `${scenario}: no partial file write`);
        assert.equal(await storage.getProjectFile(project.id, "craft.md"), undefined);
        assert.deepEqual(await readJson(`/api/projects/${project.id}/versions`), [], "failed edits leave no checkpoint");
        assert.deepEqual(jobs.rows.map((job) => job.state), ["failed"]);
        if (isImageScenario(scenario)) {
          const shouldGenerate = scenario !== "cta-not-requested" && scenario !== "cta-hidden-image";
          assert.equal(imageRequests.length, shouldGenerate ? 2 : 0, `${scenario}: KIE calls`);
          if (scenario === "cta-kie-fail" || scenario === "cta-invalid-image") {
            assert.match(result.error, /Готово 1 из 2 изображений KIE/);
          }
          assert.deepEqual(await readJson(`/api/projects/${project.id}/images`), []);
          assert.equal((await imageDebits()).rows.length, imageDebitsBefore);
          const history = await readJson("/api/credits/history");
          assert.ok(history.items.every((row: { operation: string }) => row.operation !== "editor-image-hold"));
          await processObjectDeleteOutbox();
          assert.deepEqual([...objects.keys()].filter((key) => key.startsWith("uploads/")).sort(), uploadsBefore);
        }
      }
      if (!result.error) {
        const prefix = `/api/projects/${project.id}`;
        const versions: Array<{ id: number; label: string }> = await readJson(`${prefix}/versions`);
        assert.equal(versions.length, 2, "one before checkpoint and one final version");
        const [latest, prior] = versions;
        const messages = await storage.getProjectMessages(project.id);
        const replies = messages.filter(({ role }) => role === "model");
        assert.equal(replies.length, 1);
        assert.ok(latest.label.startsWith(`v1 [msg:${replies[0].id}]:`));
        assert.match(prior.label, /^До:/);
        const saved = await readJson(`${prefix}/versions/${latest.id}`);
        const previous = await readJson(`${prefix}/versions/${prior.id}`);
        const fileContents = (files: Array<{ filename: string; code: string }> | null) =>
          Object.fromEntries((files || []).map(({ filename, code }) => [filename, code]));
        assert.equal(saved.code, actualIndex);
        assert.deepEqual(fileContents(saved.files), fileContents(await readJson(`${prefix}/files`)));
        assert.equal(previous.code, initialIndex);
        assert.deepEqual(fileContents(previous.files), fileContents(originalFiles));
        if (offloadedHistory) {
          for (const snapshot of [saved, previous]) {
            assert.ok(snapshot.blobKey && objects.has(snapshot.blobKey), "snapshot was read from object storage");
          }
        }
        const job = await readJson(`/api/jobs/${result.jobId}`);
        assert.equal(job.state, "completed");
        assert.equal(job.result.creditsUsed, result.creditsUsed);
      }
      if (scenario === "version-db-reject") {
        const rows = await db.execute(sql`SELECT type, amount FROM credit_transactions WHERE user_id = ${userId} AND id > ${lastCreditId}`);
        assert.deepEqual(rows.rows, [{ type: "released", amount: 30 }], "a rolled-back edit cannot appear as a debit");
        const versionPrefix = `drafts/p${project.id}/versions/`;
        const staged = [...objects.keys()].filter((key) => key.startsWith(versionPrefix));
        assert.equal(staged.length, 2, "both versions were staged before the DB rejected the write");
        await processObjectDeleteOutbox();
        assert.ok(staged.every((key) => !objects.has(key)), "rollback cleans up both staged snapshots");
      }
      if (scenario === "cta-images" || scenario === "cta-kie-fail") {
        const historyBefore = await storage.getProjectMessages(project.id);
        const replay = (await framesFrom(await submit())).filter((frame) => frame.done);
        assert.equal(replay.length, 1);
        assert.match(replay[0].error, /уже обрабатывался/);
        assert.equal(replay[0].newBalance, after);
        assert.equal(modelRequests.length, 1);
        assert.equal(imageRequests.length, 2);
        assert.equal((await readJson("/api/auth/user")).credits, after);
        assert.equal((await storage.getProjectMessages(project.id)).length, historyBefore.length, "retry did not append duplicate messages");
        assert.equal((await db.execute(sql`SELECT id FROM generation_jobs WHERE project_id = ${project.id}`)).rows.length, 1, "retry did not create another job");
      }
      console.log(`single-pass HTTP: ${scenario} passed`);
    }
    if (selectedScenarios.includes("cta-concurrent")) {
      // Simulate a process dying with a hold while another request is still active.
      const initial = 150;
      await db.execute(sql`UPDATE users SET credits = ${initial} WHERE id = ${userId}`);
      const expired = "itest-expired-hold";
      const active = "itest-active-hold";
      assert.equal((await storage.reserveEditImageCredits(userId, 60, expired)).newBalance, 90);
      assert.equal((await storage.reserveEditImageCredits(userId, 45, active)).newBalance, 45);
      await db.execute(sql`UPDATE credit_transactions SET created_at = CURRENT_TIMESTAMP - interval '2 hours' WHERE idempotency_key = ${expired}`);
      assert.equal(await storage.hasActiveEditImageHold(userId, expired), false);
      await Promise.all([storage.recoverExpiredEditImageHolds(), storage.recoverExpiredEditImageHolds()]);
      assert.equal((await storage.getUser(userId))?.credits, 105, "only the expired reservation was restored, once");
      assert.equal(await storage.hasActiveEditImageHold(userId, active), true);
      const replay = await storage.reserveEditImageCredits(userId, 60, expired);
      assert.equal(replay.conflict, true, "a recovered request cannot hold the same funds again");
      assert.equal(await storage.releaseEditImageHold(userId, active), 45);
      assert.equal((await storage.getUser(userId))?.credits, initial);
      console.log("editor image holds: expired balance restored exactly once");
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
