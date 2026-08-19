#!/usr/bin/env python3
"""Deploy Craft AI to Amvera from the current checkout.

Policy: run this from an up-to-date `main` after PRs are merged.
Requires AMVERA_TOKEN and /tmp/amvera_mcp.py (or AMVERA_MCP_PATH).
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SLUG = os.environ.get("AMVERA_SLUG", "attached-assets")
def _default_mcp_path() -> Path:
    env = os.environ.get("AMVERA_MCP_PATH")
    if env:
        return Path(env)
    repo_helper = ROOT / "scripts" / "amvera_mcp.py"
    if repo_helper.exists():
        return repo_helper
    return Path("/tmp/amvera_mcp.py")


MCP = _default_mcp_path()

# Core app surfaces that must stay in sync across features.
DEFAULT_FILES = [
    "server/routes.ts",
    "server/geo.ts",
    "server/anthropic.ts",
    "server/taste-skill-prompt.ts",
    "server/taste-skill-loader.ts",
    "server/yookassa.ts",
    "server/auth.ts",
    "server/yc-storage-pools.ts",
    "server/yc-iam.ts",
    "server/yandex-deploy.ts",
    "client/src/lib/auth.tsx",
    "client/src/pages/editor.tsx",
    "shared/schema.ts",
    "server/storage.ts",
    "server/scroll-world.ts",
    "server/site3d-anim.ts",
    "server/motion-reveal.ts",
    "server/animational.ts",
    "server/trigger-look.ts",
    "server/kie-errors.ts",
    "server/kie-jobs.ts",
    "server/agent-runtime.ts",
    "server/resource-guards.ts",
    "server/index.ts",
    "server/db.ts",
    "server/seo-routes.ts",
    "server/telegram-bot-auth.ts",
    "server/url-guard.ts",
    "server/replit_integrations/object_storage/objectStorage.ts",
    "package.json",
    "amvera.yml",
    "amvera.yaml",
    "shared/schema.ts",
    "shared/project-files.ts",
    "client/src/pages/dashboard.tsx",
    "client/src/components/interactive-style-cards.tsx",
    "client/src/pages/editor.tsx",
    "client/src/pages/auth-page.tsx",
    "client/src/pages/landing.tsx",
    "client/src/pages/admin.tsx",
    "client/src/pages/profile.tsx",
    "client/index.html",
    "client/public/llms.txt",
    "client/public/robots.txt",
    "client/public/sitemap.xml",
    "client/public/scroll-world-engine.js",
    "client/public/yandex-suggest-token.html",
    "client/public/videos/trigger-hero-preview.mp4",
    "client/public/videos/motion-hero-preview.mp4",
    "AGENTS.md",
]


def die(msg: str, code: int = 1) -> None:
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(code)


def git(*args: str) -> str:
    return subprocess.check_output(["git", *args], cwd=ROOT, text=True).strip()


def require_main() -> None:
    branch = git("rev-parse", "--abbrev-ref", "HEAD")
    if branch != "main" and os.environ.get("AMVERA_ALLOW_NON_MAIN") != "1":
        die(
            f"Refusing to deploy from branch '{branch}'. "
            "Merge to main first, or set AMVERA_ALLOW_NON_MAIN=1 for emergencies."
        )
    # Warn if local main is behind origin/main
    try:
        git("fetch", "origin", "main")
        behind = git("rev-list", "--count", "HEAD..origin/main")
        if behind != "0":
            die(f"Local main is {behind} commit(s) behind origin/main. Pull first.")
    except subprocess.CalledProcessError:
        print("WARN: could not fetch origin/main — continuing with local tip")


def mcp_call(name: str, args: dict, attempts: int = 5) -> dict:
    if not MCP.exists():
        die(f"Amvera MCP helper not found at {MCP}")
    if not os.environ.get("AMVERA_TOKEN"):
        die("AMVERA_TOKEN is not set")
    args_path = Path("/tmp/amvera_deploy_args.json")
    args_path.write_text(json.dumps(args, ensure_ascii=False), encoding="utf-8")
    script = f"""
import json
exec(open({str(MCP)!r}).read().split("def main")[0])
rpc("initialize", {{"protocolVersion":"2024-11-05","capabilities":{{}},"clientInfo":{{"name":"deploy-amvera","version":"1"}}}})
rpc("notifications/initialized", notify=True)
args = json.load(open({str(args_path)!r}))
r = tool({name!r}, args)
print(json.dumps(r, ensure_ascii=False))
"""
    last_err: Exception | None = None
    for i in range(attempts):
        try:
            out = subprocess.check_output(
                ["python3", "-c", script], text=True, timeout=600
            )
            return json.loads(out)
        except Exception as e:  # noqa: BLE001 — network/timeouts from Amvera MCP
            last_err = e
            wait = 4 * (2**i)
            print(f"  mcp_call {name} failed (try {i + 1}/{attempts}): {e}")
            time.sleep(wait)
    die(f"mcp_call {name} failed after {attempts} attempts: {last_err}")
    raise RuntimeError("unreachable")


BINARY_SUFFIXES = {
    ".mp4",
    ".webm",
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".webp",
    ".ico",
    ".woff",
    ".woff2",
    ".ttf",
    ".otf",
    ".pdf",
    ".zip",
}


def upload_file(rel: str) -> None:
    abs_path = ROOT / rel
    if not abs_path.exists():
        print(f"skip missing {rel}")
        return
    parent = Path(rel).parent
    # Amvera rejects null/empty path — use "/" for repo root.
    path = "/" if str(parent) in (".", "") else str(parent).replace("\\", "/")
    filename = Path(rel).name
    is_binary = abs_path.suffix.lower() in BINARY_SUFFIXES
    if is_binary:
        import base64

        raw = abs_path.read_bytes()
        file_text = ""
        file_b64 = base64.b64encode(raw).decode("ascii")
        print(f"upload {rel} ({len(raw)} bytes base64)…")
    else:
        file_text = abs_path.read_text(encoding="utf-8")
        file_b64 = ""
        print(f"upload {rel} ({len(file_text)} chars)…")
    last: dict = {}
    for attempt in range(6):
        r = mcp_call(
            "uploadFiles",
            {
                "slug": SLUG,
                "filePath": "",
                "fileText": file_text,
                "fileBase64": file_b64,
                "filename": filename,
                "path": path,
                "commitMessage": f"Deploy from main: {rel}",
                "branch": "master",
            },
        )
        last = r
        content = (((r.get("result") or {}).get("content") or [{}])[0].get("text") or "")
        if not r.get("result", {}).get("isError") and "Uploaded" in content:
            print(" ", content[:200])
            time.sleep(0.8)
            return
        wait = 4 * (2**attempt)
        print(f"  upload response failed (try {attempt + 1}/6): {content[:300] or r}")
        time.sleep(wait)
    print(json.dumps(last, ensure_ascii=False)[:800])
    die(f"upload failed for {rel}")


def wait_running(timeout_s: int = 900) -> None:
    print("rebuild…")
    r = mcp_call("rebuildProject", {"slug": SLUG})
    print((((r.get("result") or {}).get("content") or [{}])[0].get("text") or r)[:300])
    deadline = time.time() + timeout_s
    last = ""
    while time.time() < deadline:
        time.sleep(15)
        info = mcp_call("getProject", {"slug": SLUG})
        text = (((info.get("result") or {}).get("content") or [{}])[0].get("text") or "")
        last = text
        status_line = next((ln for ln in text.splitlines() if ln.startswith("Status:")), text[:120])
        print(status_line)
        if "Status: RUNNING" in text:
            print("OK: Amvera RUNNING")
            return
        if "Status: ERROR" in text or "Status: FAILED" in text or "BUILD_ERROR" in text:
            die(f"Amvera failed:\n{text}")
    die(f"Timed out waiting for RUNNING.\n{last}")


def main() -> None:
    os.chdir(ROOT)
    require_main()
    tip = git("rev-parse", "--short", "HEAD")
    full = git("rev-parse", "HEAD")
    print(f"Deploying {SLUG} from {git('rev-parse', '--abbrev-ref', 'HEAD')} @ {tip}")
    # Stamp so /api/health can report which main tip is live.
    meta = ROOT / "server" / "deploy-meta.json"
    meta.write_text(
        json.dumps({"gitSha": tip, "gitShaFull": full, "deployedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}, indent=2)
        + "\n",
        encoding="utf-8",
    )
    files = sys.argv[1:] if len(sys.argv) > 1 else list(DEFAULT_FILES)
    if "server/deploy-meta.json" not in files:
        files.append("server/deploy-meta.json")
    if "amvera.yaml" not in files:
        files.append("amvera.yaml")
    if "amvera.yml" not in files:
        files.append("amvera.yml")
    for rel in files:
        upload_file(rel)
    wait_running()


if __name__ == "__main__":
    main()
