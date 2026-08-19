import base64
import json
import os
from pathlib import Path

import requests


ENDPOINT = "https://openmcp.msk0.amvera.ru/mcp"
TOKEN = os.environ["AMVERA_TOKEN"]
HEADERS = {
    "Authorization": f"Bearer {TOKEN}",
    "Accept": "application/json, text/event-stream",
    "Content-Type": "application/json",
}


def parse_response(response: requests.Response):
    response.raise_for_status()
    text = response.text
    if "text/event-stream" in response.headers.get("content-type", ""):
        payloads = []
        for line in text.splitlines():
            if line.startswith("data:"):
                payloads.append(json.loads(line[5:].strip()))
        if not payloads:
            raise RuntimeError("Empty MCP event stream")
        return payloads[-1]
    return response.json()


init = parse_response(
    requests.post(
        ENDPOINT,
        headers=HEADERS,
        json={
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2025-06-18",
                "capabilities": {},
                "clientInfo": {"name": "cursor-local", "version": "1.0"},
            },
        },
        timeout=60,
    )
)
session_id = init.get("result", {}).get("sessionId")
if not session_id:
    # Streamable HTTP implementations commonly return the session in a header.
    probe = requests.post(
        ENDPOINT,
        headers=HEADERS,
        json={
            "jsonrpc": "2.0",
            "id": 2,
            "method": "initialize",
            "params": {
                "protocolVersion": "2025-06-18",
                "capabilities": {},
                "clientInfo": {"name": "cursor-local", "version": "1.0"},
            },
        },
        timeout=60,
    )
    parse_response(probe)
    session_id = probe.headers.get("mcp-session-id")
else:
    probe = None

if not session_id:
    raise RuntimeError("MCP session id was not returned")

session_headers = {**HEADERS, "Mcp-Session-Id": session_id}
requests.post(
    ENDPOINT,
    headers=session_headers,
    json={"jsonrpc": "2.0", "method": "notifications/initialized", "params": {}},
    timeout=30,
).raise_for_status()

targets = [
    "shared/schema.ts",
    "server/seo-media.ts",
]
for index, filename in enumerate(targets, start=10):
    payload = parse_response(
        requests.post(
            ENDPOINT,
            headers=session_headers,
            json={
                "jsonrpc": "2.0",
                "id": index,
                "method": "tools/call",
                "params": {
                    "name": "downloadFiles",
                    "arguments": {
                        "slug": "attached-assets",
                        "branch": "master",
                        "path": "/",
                        "filename": filename,
                    },
                },
            },
            timeout=90,
        )
    )
    result = payload.get("result", {})
    content = result.get("content", [])
    text = "\n".join(str(item.get("text", "")) for item in content if item.get("type") == "text")
    marker = "base64): "
    if marker not in text:
        raise RuntimeError(f"No base64 content returned for {filename}: {text[:200]}")
    encoded = text.split(marker, 1)[1].strip()
    target = Path(filename)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(base64.b64decode(encoded))
    print(f"restored {filename} ({target.stat().st_size} bytes)")
