---
title: Burp MCP Setup
tags:
  - mcp
  - burp
  - claude-code
---

# Burp MCP + Claude Code

Connect Burp Suite Professional to Claude Code via a custom Go MCP server. Claude gets clean, structured access to Burp's HTTP engine, proxy history, scanner, Repeater, and Intruder — with body limits, auto HTTP/2 detection, and no blob responses.

## Architecture

```
Claude Code  -->  stdio  -->  burp-mcp-server (Go)  -->  SSE  -->  Burp Extension (port 9876)
```

The Go binary acts as:
- **MCP server** (stdio) to Claude Code — exposes 7 clean tools
- **MCP client** (SSE) to Burp's native MCP extension — calls Burp's 14+ raw tools

This replaces the old `mcp-proxy.jar` (Java stdio proxy) which returned verbose `HttpRequestResponse{...}` blobs with no body limits.

## What You Get

- 7 clean tools replacing Burp's 14+ verbose ones
- Auto HTTP/2 detection (tries HTTP/2 first, falls back to HTTP/1.1 on timeout/502)
- 2KB default body limit (configurable) — no more 873KB response blobs
- Structured JSON responses: `{statusCode, headers, body, bodySize, truncated}`
- Proxy history with regex filter and lean summaries
- Scanner findings as structured `{name, severity, confidence, url, issueDetail}`

## Prerequisites

- Burp Suite Professional (Community has limited MCP support)
- Go 1.21+ (for building the binary)
- Claude Code CLI

## Installation

### 1. Install Burp MCP Extension

In Burp: **Extensions** > **BApp Store** > search **"MCP Server"** > Install

### 2. Enable MCP Server

Navigate to the **MCP** tab in Burp's top navigation:
- Toggle **Enabled**
- Default address: `127.0.0.1:9876`
- **Uncheck** "Require approval for history access" (recommended for CTF/testing)

### 3. Build the Custom MCP Server

```bash
cd ~/Documents/burp-mcp-server
go build -o burp-mcp-server .
```

The source is at `~/Documents/burp-mcp-server/`. Structure:

```
burp-mcp-server/
├── cmd/
│   ├── root.go           # CLI root command + --burp-url flag
│   └── serve.go          # Connect to Burp SSE + start stdio server
├── internal/
│   ├── burp/
│   │   ├── client.go     # SSE client wrapper with timeouts
│   │   └── parser.go     # HttpRequestResponse unwrapper + HTTP parser
│   └── tools/
│       ├── send_request.go        # Unified send (HTTP/1.1 + HTTP/2)
│       ├── get_proxy_history.go   # Proxy history with regex filter
│       ├── get_scanner_issues.go  # Structured scanner findings
│       ├── create_repeater_tab.go # Stage in Repeater
│       ├── send_to_intruder.go    # Send to Intruder
│       └── encode.go              # URL + Base64 encode/decode
├── main.go
└── go.mod
```

### 4. Configure Claude Code

Edit `~/.mcp.json`:

```json
{
  "mcpServers": {
    "burp": {
      "command": "/Users/YOU/Documents/burp-mcp-server/burp-mcp-server",
      "args": ["serve"],
      "env": {
        "BURP_MCP_URL": "http://127.0.0.1:9876/sse"
      }
    }
  }
}
```

### 5. Verify

```bash
# Check Burp SSE is running
curl -N http://127.0.0.1:9876/sse
# Should return: data: /message?sessionId=...

# Restart Claude Code
claude -c
```

You should see `burp_send_request`, `burp_get_proxy_history`, etc. in available tools.

## Available Tools

| Tool | Description | Key Params |
|------|-------------|------------|
| `burp_send_request` | Send HTTP request, auto HTTP/2 detection | `raw`, `host`, `port`, `tls`, `bodyLimit`, `bodyOffset` |
| `burp_get_proxy_history` | Proxy history with optional regex | `count`, `offset`, `regex` |
| `burp_get_scanner_issues` | Structured scanner findings | `count`, `offset` |
| `burp_create_repeater_tab` | Stage request in Repeater | `raw`, `host`, `port`, `tls`, `tabName` |
| `burp_send_to_intruder` | Send to Intruder | `raw`, `host`, `port`, `tls`, `tabName` |
| `burp_encode` | URL or Base64 encode | `content`, `type` (url/base64) |
| `burp_decode` | URL or Base64 decode | `content`, `type` (url/base64) |

## Example: CTF in 3 Requests

```
1. burp_send_request  →  GET /  →  identify Express SPA
2. burp_send_request  →  POST /api/register  →  get JWT with role:"user"
3. burp_send_request  →  GET /api/admin/flag  →  BAC, no role check → flag
```

Response format (clean JSON, not blobs):
```json
{
  "statusCode": 200,
  "headers": {
    "Content-Type": "application/json; charset=utf-8",
    "X-Powered-By": "Express"
  },
  "body": "{\"flag\":\"bug{...}\"}",
  "bodySize": 48,
  "truncated": false
}
```

## Custom vs mcp-proxy.jar

| | Custom Go Binary | mcp-proxy.jar |
|--|-----------------|---------------|
| Response format | Clean JSON | `HttpRequestResponse{...}` blob |
| Body limits | 2KB default | None (873KB+ responses) |
| HTTP version | Auto-detect with fallback | Separate tools, 502 errors |
| Tool count | 7 | 14+ |
| Dependencies | Single Go binary | Java 21+ |
| Timeouts | 15s HTTP/2, 30s default | None (hangs forever) |

## Troubleshooting

**Tools not appearing after restart:**
The Go binary might be failing to connect. Test manually:
```bash
BURP_MCP_URL="http://127.0.0.1:9876/sse" ./burp-mcp-server serve < /dev/null 2>&1
```
Should print: `Connecting... Connected... ready (stdio)`

**Request hangs / AbortError:**
The HTTP/2 attempt may timeout on HTTP/1.1-only targets. The 15s timeout + fallback handles this automatically. If it persists, check Burp's MCP tab is enabled.

**Rebuilding after changes:**
```bash
cd ~/Documents/burp-mcp-server && go build -o burp-mcp-server .
# Then restart Claude Code
```

---

## General Burp Tips

### Request Visibility

| Burp Tab | MCP `send_request`? | `create_repeater_tab`? |
|----------|-------|------|
| Proxy > HTTP history | No (bypasses proxy) | No |
| Repeater | No | Yes (creates tab) |
| Logger/Logger++ | Yes | No |
| Target > Site map | Yes | No |

### Essential BApp Extensions

**Must-have:** Autorize, Active Scan++, Param Miner, Backslash Powered Scanner, Logger++, Hackvertor, JSON Web Tokens, JS Link Finder

**Nice-to-have:** Collaborator Everywhere, Server-Side Prototype Pollution, GAP, Sensitive Discoverer

### Autorize (IDOR/BAC Testing)
1. Copy cookies from low-priv user, paste in Autorize
2. Set scope filters
3. Toggle Autorize ON
4. Navigate as high-priv user — Autorize replays with low-priv cookies

### Collaborator Alternatives
interactsh.com, ceye.io, requestcatcher.com, canarytokens.org, webhook.site, ngrok.com, beeceptor.com

### Noise Reduction (TLS Pass Through)
```
.*\.google\.com
.*\.gstatic\.com
.*\.googleapis\.com
.*\.pki\.goog
.*\.mozilla\.com
```

### Remote Burp (VPS to Local)
```bash
# On local machine — tunnel VPS port 8080 to local Burp proxy
ssh -R 8080:127.0.0.1:8080 root@VPS_IP -f -N

# On VPS — send traffic through tunnel
curl URL -x http://127.0.0.1:8080
```

### IP Rotation
- [fireprox](https://github.com/ustayready/fireprox) — AWS API Gateway rotation
- [IPRotate Burp Extension](https://github.com/RhinoSecurityLabs/IPRotate_Burp_Extension)

### Streaming Response Fix
If a response breaks or slows Burp:
Project Options > HTTP > Streaming Responses > Add URL, uncheck "Store streaming responses"
