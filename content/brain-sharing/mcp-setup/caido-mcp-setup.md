---
title: Caido MCP Server
tags:
  - mcp
  - caido
  - claude-code
  - go
aliases:
  - "/Brain-Sharing/MCP-Setup/Caido-MCP-Setup"
---
MCP server and CLI for the Caido web proxy. Browse, replay, and analyze HTTP traffic from AI assistants or your terminal. Built on the community [Go SDK](/brain-sharing/mcp-setup/caido-sdk-go/) with OAuth + PAT auth, HTTPQL filtering, session cookie jars, batch operations, and 60 tools + 4 read-only resources.

Source: [c0tton-fluff/caido-mcp-server](https://github.com/c0tton-fluff/caido-mcp-server)

## Architecture

```
Claude Code  -->  stdio  -->  caido-mcp-server (Go)  -->  GraphQL  -->  Caido (port 8080)
Terminal     -->  caido-cli  -->  same GraphQL API
```

Both MCP and CLI share internal packages. Uses [caido-community/sdk-go](https://github.com/caido-community/sdk-go) for type-safe GraphQL communication.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/c0tton-fluff/caido-mcp-server/main/install.sh | bash
```

Pre-built binaries available on [Releases](https://github.com/c0tton-fluff/caido-mcp-server/releases) (macOS, Linux, Windows - amd64/arm64).

Or build from source:

```bash
git clone https://github.com/c0tton-fluff/caido-mcp-server.git
cd caido-mcp-server
go build -ldflags "-X main.version=$(git describe --tags)" -o caido-mcp-server ./cmd/mcp
```

## Auth

Two options:

**Personal Access Token (recommended):**
Generate in Caido (Settings > Developer > Personal Access Tokens). Set `CAIDO_PAT` environment variable.

**OAuth device flow:**
```bash
CAIDO_URL=http://localhost:8080 caido-mcp-server login
```
Opens browser, saves token to `~/.caido-mcp/token.json`. Auto-refreshes mid-session.

## Claude Code Config

```json
{
  "mcpServers": {
    "caido": {
      "command": "caido-mcp-server",
      "args": ["serve"],
      "env": {
        "CAIDO_URL": "http://127.0.0.1:8080",
        "CAIDO_PAT": "your-personal-access-token"
      }
    }
  }
}
```

## Tools (42)

### Proxy & Replay

| Tool | What it does |
|------|-------------|
| `list_requests` | Proxy history with HTTPQL filter and pagination |
| `get_request` | Request details with configurable body limit + offset |
| `send_request` | Send HTTP via Replay with auto cookie jar injection. Polls up to 10s |
| `batch_send` | Parallel requests (BAC sweeps, param fuzzing, endpoint sweeps). Up to 50 per batch |
| `create_replay_session` | Create named replay session, optionally seed with a request |
| `list_replay_sessions` | List replay sessions |
| `get_replay_entry` | Get replay entry with request/response |
| `clear_session_cookies` | Wipe in-memory cookie jar for a session |
| `get_session_cookies` | List cookie metadata stored in a session jar (values not returned) |

### Automate (Fuzzing)

| Tool | What it does |
|------|-------------|
| `list_automate_sessions` | List fuzzing sessions |
| `get_automate_session` | Session details + entry list |
| `get_automate_entry` | Fuzz results with payloads |
| `automate_task_control` | Start/pause/resume/cancel fuzzing tasks |

### Findings & Discovery

| Tool | What it does |
|------|-------------|
| `list_findings` | List security findings |
| `create_finding` | Create finding linked to a request |
| `delete_findings` | Delete findings by ID or reporter name |
| `export_findings` | Export findings for reporting |
| `get_sitemap` | Browse discovered endpoint hierarchy |
| `list_scopes` / `create_scope` | Target scope management |

### Workflows & Intercept

| Tool | What it does |
|------|-------------|
| `list_workflows` / `run_workflow` / `toggle_workflow` | Workflow automation |
| `intercept_status` / `intercept_control` | Intercept toggle |
| `list_intercept_entries` / `forward_intercept` / `drop_intercept` | Intercept queue |
| `list_tamper_rules` / `create_tamper_rule` / `update_tamper_rule` / `toggle_tamper_rule` / `delete_tamper_rule` | Match & Replace (full CRUD) |
| `list_environments` / `select_environment` | Environment variables |
| `list_projects` / `select_project` | Project switching |
| `list_filters` | Saved HTTPQL filter presets |
| `list_hosted_files` | Hosted payload files |
| `list_tasks` / `cancel_task` | Background task management |
| `list_plugins` | Installed plugin packages |
| `get_instance` | Caido version and platform info |

## MCP Resources (4)

Read-only data exposed via the MCP resources protocol. Agents can read these without consuming tool calls.

| URI | Description |
|-----|-------------|
| `caido://requests/{id}` | Full HTTP request and response for a given request ID |
| `caido://replay-sessions/{id}` | Replay session details with entry list |
| `caido://sitemap` | Root domains from the sitemap |
| `caido://findings` | Security finding summaries (up to 100) |

## Session Cookie Jar

The server maintains an RFC 6265-compliant in-memory cookie jar per replay session. Any `Set-Cookie` from a response is stored and auto-injected into subsequent requests targeting the same domain/path.

Key behaviours:
- Pass `useCookieJar: false` on a single call to disable injection (useful for session-fixation testing or verifying auth gates)
- `clear_session_cookies` wipes the jar between test runs
- `get_session_cookies` introspects stored cookies (metadata only, values not returned)
- Each `send_request` response includes a `cookieJar` block showing what was injected and what was captured

This means multi-step authenticated flows work out of the box -- login once, subsequent requests carry the session automatically.

## Built-in Protections

- Credential redaction -- Authorization, Cookie, and API key headers stripped from tool output
- Adaptive body limits -- JSON gets 4KB, HTML 3KB, binary 200B (override with explicit `bodyLimit`)
- Response fingerprinting -- auto-detects content kind (json/html/xml/text/binary)
- Response diff -- repeated identical responses collapse to a one-line summary, saving tokens
- Input validation with length limits on all string inputs
- Token auto-refresh for expired OAuth tokens mid-session

## Caido vs Burp MCP

| Feature | Caido MCP | Burp MCP |
|---------|-----------|----------|
| Transport | Go > GraphQL | Go > SSE |
| Tools | 42 + 4 resources | 10 |
| Filtering | HTTPQL (`req.host.eq:"..."`) | Regex |
| Batch ops | `batch_send` (50 parallel) | `batch_send` (10 parallel) |
| Cookie jar | RFC 6265 per-session | No |
| Fuzzing | Automate sessions | Send to Intruder |
| Scanner | No built-in | `get_scanner_issues` |
| Match & Replace | Full CRUD (5 tools) | No |
| Intercept | Full control | No |
| Auth | OAuth + PAT | None (localhost) |

**Use Caido for**: daily proxy work, HTTPQL filtering, multi-step authenticated flows, fuzzing with Automate, workflow automation, batch testing, intercept control.

**Use Burp for**: active scanning, Collaborator/blind testing, extension ecosystem (Autorize, Param Miner).

## Port Notes

- Caido default proxy: `127.0.0.1:8080`
- Burp default proxy: `127.0.0.1:8080` (conflict)
- Change one (e.g., Caido to `127.0.0.1:1234`)
- MCP servers use different ports: Caido GraphQL (8080) vs Burp SSE (9876) -- no conflict
