#!/usr/bin/env python3
"""Deploy Craft AI to Amvera via git push.

Expected workflow:
1. Merge feature work into local `main`
2. Ensure local `main` is committed and up to date with `origin/main`
3. Push `main` to the Amvera git remote as `master`

This follows Amvera's recommended git-based deploy flow and avoids flaky
per-file MCP uploads.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
AMVERA_REMOTE = os.environ.get("AMVERA_REMOTE", "amvera")
AMVERA_REMOTE_URL = os.environ.get(
    "AMVERA_REMOTE_URL",
    "https://git.amvera.ru/johnmaskot/attached-assets",
)
SOURCE_BRANCH = os.environ.get("AMVERA_SOURCE_BRANCH", "main")
TARGET_BRANCH = os.environ.get("AMVERA_TARGET_BRANCH", "master")
ALLOW_DIRTY = os.environ.get("AMVERA_ALLOW_DIRTY") == "1"


def die(msg: str, code: int = 1) -> None:
    print(f"ERROR: {msg}", file=sys.stderr)
    sys.exit(code)


def git(*args: str, check: bool = True) -> str:
    proc = subprocess.run(
        ["git", *args],
        cwd=ROOT,
        text=True,
        capture_output=True,
    )
    if check and proc.returncode != 0:
        raise subprocess.CalledProcessError(proc.returncode, proc.args, proc.stdout, proc.stderr)
    return (proc.stdout or "").strip()


def ensure_remote() -> None:
    remotes = git("remote").splitlines()
    if AMVERA_REMOTE in remotes:
        current_url = git("remote", "get-url", AMVERA_REMOTE)
        if current_url != AMVERA_REMOTE_URL:
            die(
                f"Remote '{AMVERA_REMOTE}' points to {current_url!r}, expected {AMVERA_REMOTE_URL!r}. "
                "Fix the remote or set AMVERA_REMOTE_URL explicitly."
            )
        return
    git("remote", "add", AMVERA_REMOTE, AMVERA_REMOTE_URL)
    print(f"Added remote {AMVERA_REMOTE}: {AMVERA_REMOTE_URL}")


def require_main() -> None:
    branch = git("rev-parse", "--abbrev-ref", "HEAD")
    if branch != SOURCE_BRANCH and os.environ.get("AMVERA_ALLOW_NON_MAIN") != "1":
        die(
            f"Refusing to deploy from branch {branch!r}. "
            f"Merge to {SOURCE_BRANCH!r} first, or set AMVERA_ALLOW_NON_MAIN=1 for emergencies."
        )


def require_up_to_date() -> None:
    try:
        git("fetch", "origin", SOURCE_BRANCH)
        behind = git("rev-list", "--count", f"HEAD..origin/{SOURCE_BRANCH}")
        if behind != "0":
            die(f"Local {SOURCE_BRANCH} is {behind} commit(s) behind origin/{SOURCE_BRANCH}. Pull first.")
    except subprocess.CalledProcessError:
        print(f"WARN: could not fetch origin/{SOURCE_BRANCH}; continuing with local tip")


def require_clean_tree() -> None:
    status = git("status", "--porcelain")
    if status and not ALLOW_DIRTY:
        die(
            "Working tree is dirty. Commit your changes first so Amvera receives a reproducible deploy. "
            "Set AMVERA_ALLOW_DIRTY=1 only for emergencies."
        )


def check_deploy_meta(head_short: str, head_full: str) -> None:
    meta = ROOT / "server" / "deploy-meta.json"
    if not meta.exists():
        print("WARN: server/deploy-meta.json is missing; /api/health may report stale gitSha.")
        return
    try:
        data = json.loads(meta.read_text(encoding="utf-8"))
    except Exception:
        print("WARN: server/deploy-meta.json is invalid JSON; /api/health may report stale gitSha.")
        return
    if data.get("gitSha") != head_short or data.get("gitShaFull") != head_full:
        print(
            "WARN: server/deploy-meta.json does not match HEAD. "
            "If you want /api/health to show the live SHA, update and commit that file before deploy."
        )


def push_deploy() -> None:
    print(f"Pushing {SOURCE_BRANCH} -> {AMVERA_REMOTE}/{TARGET_BRANCH} ...")
    subprocess.run(
        ["git", "push", AMVERA_REMOTE, f"{SOURCE_BRANCH}:{TARGET_BRANCH}"],
        cwd=ROOT,
        check=True,
    )


def main() -> None:
    os.chdir(ROOT)
    ensure_remote()
    require_main()
    require_up_to_date()
    require_clean_tree()
    head_short = git("rev-parse", "--short", "HEAD")
    head_full = git("rev-parse", "HEAD")
    print(f"Deploying {SOURCE_BRANCH} @ {head_short} via remote {AMVERA_REMOTE}")
    check_deploy_meta(head_short, head_full)
    push_deploy()
    print("Push sent to Amvera. The platform should start a build automatically from master.")
    print("Check build/run status in Amvera logs if startup takes a while.")


if __name__ == "__main__":
    main()
