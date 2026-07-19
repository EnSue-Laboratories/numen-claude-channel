#!/usr/bin/env python3
"""Call a numen-mcp tool. Usage: numen.py <tool> ['<json-args>']
Endpoint defaults to http://127.0.0.1:8765/mcp; override with NUMEN_MCP_URL."""
import json, os, sys, urllib.request

tool = sys.argv[1]
args = json.loads(sys.argv[2]) if len(sys.argv) > 2 else {}
payload = {"jsonrpc": "2.0", "id": 1, "method": "tools/call",
           "params": {"name": tool, "arguments": args}}
req = urllib.request.Request(
    os.environ.get("NUMEN_MCP_URL", "http://127.0.0.1:8765/mcp"),
    data=json.dumps(payload).encode(),
    headers={"Content-Type": "application/json",
             "Accept": "application/json, text/event-stream"})
resp = json.loads(urllib.request.urlopen(req, timeout=300).read())
for c in resp.get("result", {}).get("content", []):
    print(c.get("text", c))
if "error" in resp:
    print("ERROR:", resp["error"])
