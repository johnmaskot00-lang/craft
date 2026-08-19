#!/usr/bin/env python3
"""Minimal Amvera MCP (Streamable HTTP) client used by scripts/deploy-amvera.py.

Requires AMVERA_TOKEN. Optional:
  AMVERA_MCP_URL  (default https://openmcp.msk0.amvera.ru/mcp)
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request

MCP_URL = os.environ.get("AMVERA_MCP_URL", "https://openmcp.msk0.amvera.ru/mcp").rstrip("/")
TOKEN = (os.environ.get("AMVERA_TOKEN") or "").strip()
_SESSION: str | None = None
_REQ_ID = 0


def _next_id() -> int:
    global _REQ_ID
    _REQ_ID += 1
    return _REQ_ID


def rpc(method: str, params: dict | None = None, *, notify: bool = False) -> dict:
    """JSON-RPC over Amvera Streamable HTTP MCP transport."""
    global _SESSION
    if not TOKEN:
        raise RuntimeError("AMVERA_TOKEN is not set")

    body: dict = {"jsonrpc": "2.0", "method": method}
    if params is not None:
        body["params"] = params
    if not notify:
        body["id"] = _next_id()

    data = json.dumps(body).encode("utf-8")
    headers = {
        "Authorization": f"Bearer {TOKEN}",
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
    }
    if _SESSION:
        headers["Mcp-Session-Id"] = _SESSION

    req = urllib.request.Request(MCP_URL, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=300) as resp:
            sid = resp.headers.get("Mcp-Session-Id") or resp.headers.get("mcp-session-id")
            if sid:
                _SESSION = sid
            raw = resp.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Amvera MCP HTTP {e.code}: {err_body[:500]}") from e

    if notify:
        return {}

    # SSE-style: lines of "data: {...}"
    payload = None
    if "data:" in raw:
        for line in raw.splitlines():
            line = line.strip()
            if line.startswith("data:"):
                chunk = line[5:].strip()
                if not chunk or chunk == "[DONE]":
                    continue
                try:
                    obj = json.loads(chunk)
                except json.JSONDecodeError:
                    continue
                if isinstance(obj, dict) and ("result" in obj or "error" in obj):
                    payload = obj
        if payload is None:
            # last non-empty data line
            for line in reversed(raw.splitlines()):
                line = line.strip()
                if line.startswith("data:"):
                    payload = json.loads(line[5:].strip())
                    break
    else:
        payload = json.loads(raw) if raw.strip() else {}

    if not isinstance(payload, dict):
        raise RuntimeError(f"Unexpected MCP response: {raw[:300]}")
    if payload.get("error"):
        raise RuntimeError(f"MCP error: {payload['error']}")
    return payload


def tool(name: str, arguments: dict | None = None) -> dict:
    return rpc("tools/call", {"name": name, "arguments": arguments or {}})


def main() -> None:
    if len(sys.argv) < 2:
        print("usage: amvera_mcp.py <toolName> [jsonArgs]", file=sys.stderr)
        sys.exit(2)
    name = sys.argv[1]
    args = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}
    rpc(
        "initialize",
        {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "amvera-mcp-cli", "version": "1"},
        },
    )
    rpc("notifications/initialized", notify=True)
    print(json.dumps(tool(name, args), ensure_ascii=False))


if __name__ == "__main__":
    main()
