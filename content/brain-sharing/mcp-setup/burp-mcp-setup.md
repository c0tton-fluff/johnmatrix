---
title: Burp MCP Server
tags:
  - mcp
  - burp
  - claude-code
  - go
aliases:
  - "/Brain-Sharing/MCP-Setup/Burp-MCP-Setup"
  - "/brain-sharing/mcp-setup/burp-mcp-setup/"
---
MCP server and standalone CLI for Burp Suite Professional. Gives AI assistants structured access to Burp's HTTP engine, proxy history, scanner, Repeater, and Intruder -- with body limits, batch operations, and race condition support.

Source: [c0tton-fluff/burp-mcp-server](https://github.com/c0tton-fluff/burp-mcp-server)

## Architecture

```
Claude Code  -->  stdio  -->  burp-mcp-server (Go)  -->  SSE  -->  Burp Extension (port 9876)
Terminal     -->  burp-cli (Python)  -->  Burp Proxy (8080)  -->  Proxy History
```

Two deployment modes: MCP server for AI assistants (stdio) or standalone CLI for terminal use.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/c0tton-fluff/burp-mcp-server/main/install.sh | bash
```

Or build from source:

```bash
git clone https://github.com/c0tton-fluff/burp-mcp-server.git
cd burp-mcp-server && go build -o burp-mcp-server .
```

## Burp Extension Setup

1. Burp > Extensions > BApp Store > search "MCP Server" > Install
2. MCP tab > toggle Enabled > default `127.0.0.1:9876`
3. Uncheck "Require approval for history access" for CTF/testing

## Claude Code Config

```json
{
  "mcpServers": {
    "burp": {
      "command": "burp-mcp-server",
      "args": ["serve"],
      "env": {
        "BURP_MCP_URL": "http://127.0.0.1:9876/sse"
      }
    }
  }
}
```

## Tools (10)

| Tool | What it does |
|------|-------------|
| `send_request` | Send HTTP request with auto protocol detection |
| `batch_send` | Parallel batch operations (up to 10 concurrent) |
| `race_request` | Single-packet race conditions (up to 50 concurrent, last-byte sync) |
| `get_proxy_history` | Proxy history with regex filter |
| `get_request` | Request details by ID |
| `get_scanner_issues` | Structured scanner findings |
| `create_repeater_tab` | Stage request in Repeater |
| `send_to_intruder` | Send to Intruder |
| `encode` | URL or Base64 encode |
| `decode` | URL or Base64 decode |

## Why This Over Burp's Built-in MCP

| | burp-mcp-server | Burp built-in |
|--|----------------|---------------|
| Responses | Clean JSON, 2KB body limit | `HttpRequestResponse{...}` blobs |
| HTTP version | Auto-detect with fallback | Separate tools, 502 errors |
| Batch/Race | Yes (10 concurrent / 50 race) | No |
| Tool count | 10 consolidated | 14+ overlapping |
| Dependencies | Single Go binary | Java 21+ |
| Header filtering | Security-relevant by default | All headers |

## Troubleshooting

**Tools not appearing:** Test manually:
```bash
BURP_MCP_URL="http://127.0.0.1:9876/sse" burp-mcp-server serve < /dev/null 2>&1
```

**Request hangs:** HTTP/2 attempt may timeout on HTTP/1.1-only targets. The 15s timeout + fallback handles this automatically.

---

## General Burp Tips

### Request Visibility

| Burp Tab | MCP `send_request`? | `create_repeater_tab`? |
|----------|---------------------|------------------------|
| Proxy > HTTP history | No (bypasses proxy) | No |
| Repeater | No | Yes (creates tab) |
| Logger/Logger++ | Yes | No |
| Target > Site map | Yes | No |

### Essential BApps

**Must-have:** Autorize, Active Scan++, Param Miner, Backslash Powered Scanner, Logger++, Hackvertor, JSON Web Tokens, JS Link Finder

### Autorize (IDOR/BAC)
1. Copy cookies from low-priv user, paste in Autorize
2. Set scope filters, toggle ON
3. Navigate as high-priv user -- Autorize replays with low-priv cookies

### Collaborator Alternatives
interactsh.com, ceye.io, requestcatcher.com, canarytokens.org, webhook.site

### Remote Burp (VPS to Local)
```bash
ssh -R 8080:127.0.0.1:8080 root@VPS_IP -f -N
curl URL -x http://127.0.0.1:8080
```
