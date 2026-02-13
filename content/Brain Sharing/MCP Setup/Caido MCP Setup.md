---
title: Caido MCP Setup
tags:
  - mcp
  - caido
  - claude-code
---

# Caido MCP + Claude Code

Connect Caido proxy to Claude Code via a custom Go MCP server. Claude gets structured access to Caido's proxy history, replay, automate (fuzzing), findings, sitemap, and scopes — all through HTTPQL-filtered, paginated, body-limited responses.

## Architecture

```
Claude Code  -->  stdio  -->  caido-mcp-server (Go)  -->  GraphQL  -->  Caido (port 8080)
```

The Go binary acts as:
- **MCP server** (stdio) to Claude Code — exposes 14 clean tools
- **GraphQL client** to Caido — queries Caido's API with OAuth token refresh

## What You Get

- 14 tools covering proxy history, replay, fuzzing, findings, sitemap, scopes
- HTTPQL filtering on proxy history (`req.host.eq:"example.com"`)
- Body limits with offset support — no multi-MB response blobs
- OAuth authentication with automatic token refresh
- Structured JSON responses with pagination cursors

## Prerequisites

- Caido (free or Pro) running locally
- Go 1.21+ (only if building from source)
- Claude Code CLI

## Installation

### Option A: Install Script (Recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/c0tton-fluff/caido-mcp-server/main/install.sh | bash
```

Or download from [Releases](https://github.com/c0tton-fluff/caido-mcp-server/releases).

### Option B: Build from Source

```bash
git clone https://github.com/c0tton-fluff/caido-mcp-server.git
cd caido-mcp-server
go build -o caido-mcp-server .
```

## Setup

### 1. Start Caido

Launch Caido and note the listening address (default `http://localhost:8080`).

### 2. Authenticate

```bash
CAIDO_URL=http://localhost:8080 ./caido-mcp-server login
```

This opens a browser for Caido authentication and saves the token to `~/.caido-mcp/token.json`.

### 3. Configure Claude Code

Add to `~/.mcp.json`:

```json
{
  "mcpServers": {
    "caido": {
      "command": "/path/to/caido-mcp-server",
      "args": ["serve"],
      "env": {
        "CAIDO_URL": "http://127.0.0.1:8080"
      }
    }
  }
}
```

### 4. Verify

Restart Claude Code and check that `caido` appears as a connected MCP server. Try:
- `caido_list_requests` — should return proxied traffic (empty if no browser traffic yet)
- `caido_send_request` — send a raw HTTP request through Caido's replay

## Available Tools

### Proxy History

| Tool | Description | Key Params |
|------|-------------|------------|
| `caido_list_requests` | List requests with HTTPQL filter | `httpql`, `limit`, `after` |
| `caido_get_request` | Get request details (headers, body, response) | `ids`, `include`, `bodyLimit`, `bodyOffset` |

### Replay

| Tool | Description | Key Params |
|------|-------------|------------|
| `caido_send_request` | Send raw HTTP request | `raw`, `host`, `port`, `tls`, `sessionId` |
| `caido_list_replay_sessions` | List Replay sessions | — |
| `caido_get_replay_entry` | Get Replay entry with request/response | `id` |

### Automate (Fuzzing)

| Tool | Description | Key Params |
|------|-------------|------------|
| `caido_list_automate_sessions` | List fuzzing sessions | — |
| `caido_get_automate_session` | Get session details and entry list | `id` |
| `caido_get_automate_entry` | Get fuzz results with payloads | `id`, `limit`, `after` |

### Findings & Scope

| Tool | Description | Key Params |
|------|-------------|------------|
| `caido_list_findings` | List security findings | `limit`, `after`, `filter` |
| `caido_create_finding` | Create finding for a request | `requestId`, `title`, `description` |
| `caido_get_sitemap` | Browse discovered endpoints | `parentId` |
| `caido_list_scopes` | List target scopes | — |
| `caido_create_scope` | Create new scope | `name`, `allowlist`, `denylist` |

## Example: CTF in 3 Requests

```
1. caido_send_request  →  GET /  →  identify tech stack, discover endpoints
2. caido_send_request  →  POST /api/login  →  authenticate, get session token
3. caido_send_request  →  GET /api/admin/users  →  test access controls
```

## Caido vs Burp MCP Comparison

| Feature | Caido MCP | Burp MCP |
|---------|-----------|----------|
| Architecture | Go → GraphQL → Caido | Go → SSE → Burp Extension |
| Tools | 14 | 7 (consolidated from 14+) |
| Filtering | HTTPQL (`req.host.eq:"..."`) | Regex on proxy history |
| Fuzzing | Automate sessions + entries | Send to Intruder |
| Scanner | No built-in scanner | `get_scanner_issues` |
| Findings | Create + list via API | Read scanner findings |
| Auth | OAuth with token refresh | None (localhost only) |
| Body limits | Built into `get_request` | Built into `send_request` |

**Use Caido for**: daily proxy browsing, quick replay, HTTPQL filtering, fuzzing with Automate, lightweight CTFs.

**Use Burp for**: active scanning, Collaborator/blind testing, extension ecosystem (Autorize, Param Miner), scanner findings.

## Proxy Port Notes

- Caido default proxy: `127.0.0.1:8080`
- Burp default proxy: `127.0.0.1:8080` (conflict!)
- **Solution**: Change one proxy port (e.g., Caido to `127.0.0.1:1234`)
- MCP servers use different ports: Caido GraphQL (8080) vs Burp SSE (9876) — no conflict

## Troubleshooting

**Tools not appearing after restart:**
Check that the binary path in `~/.mcp.json` is correct and the binary is executable.

**`Invalid token` error:**
Run `caido-mcp-server login` again to re-authenticate.

**Empty proxy history:**
`caido_list_requests` only shows traffic proxied through Caido. Browse through Caido's proxy first.

**Parameter errors (`sessionId required`, `depth required`):**
Check the tool reference above for correct parameter names.

**Rebuilding after changes:**
```bash
cd ~/Documents/Caido-Repo && go build -o caido-mcp-server .
# Then restart Claude Code
```

Check MCP logs: `~/.cache/claude-cli-nodejs/*/mcp-logs-caido/`
