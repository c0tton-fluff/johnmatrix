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
MCP server and CLI for the [Caido](https://caido.io) web proxy. Browse, replay, and analyze HTTP traffic from AI assistants or your terminal. Built on the community [Go SDK](/brain-sharing/mcp-setup/caido-sdk-go/) with 66 tools and 6 read-only resources, OAuth + static token auth, HTTPQL filtering, session cookie jars, batch operations, WebSocket inspection, race condition testing, and full Caido feature coverage.

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

Pre-built binaries on [Releases](https://github.com/c0tton-fluff/caido-mcp-server/releases) (macOS, Linux, Windows - amd64/arm64).

Build from source:

```bash
git clone https://github.com/c0tton-fluff/caido-mcp-server.git
cd caido-mcp-server
go build -ldflags "-X main.version=$(git describe --tags)" -o caido-mcp-server ./cmd/mcp
```

## Auth

**Option A: Static access token (recommended)**

This server talks to the local Caido app's GraphQL API, which authenticates with the access token from your Caido login session -- not a Caido Cloud Personal Access Token. A Cloud PAT (prefixed `caido_`) is for the cloud/dashboard API and will not work.

Grab the access token from the Caido GUI: open developer tools (`CTRL`+`SHIFT`+`I`) and run in the Console:

```js
JSON.parse(localStorage.CAIDO_AUTHENTICATION).accessToken
```

Pass it via `CAIDO_ACCESS_TOKEN`. The older `CAIDO_PAT` variable is accepted as a deprecated alias.

> This token expires after ~7 days. For long-lived setups, use Option B (OAuth auto-refreshes).

**Option B: OAuth device flow**

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
        "CAIDO_ACCESS_TOKEN": "your-caido-access-token"
      }
    }
  }
}
```

For authorized engagements where you need real credential values in tool output (to replay captured authenticated requests or produce working curl PoCs), add `"CAIDO_ALLOW_SENSITIVE_HEADERS": "true"`. Without it, sensitive headers (Authorization, Cookie, Set-Cookie, API keys) are replaced with `[REDACTED]` in all tool output.

## MCP Tools (66)

### Proxy History & Replay

| Tool | What it does |
|------|-------------|
| `list_requests` | Proxy history with HTTPQL filter and pagination |
| `get_request` | Request details (metadata, headers, body) with configurable limit + offset |
| `diff_responses` | Structural diff of two responses by request ID: status/size change flags, compact body/header summary |
| `send_request` | Send HTTP via Replay. Auto-injects session cookies, persists `Set-Cookie`, polls up to 10s. Supports `marker` for response reflection detection |
| `batch_send` | Parallel requests (BAC sweeps, param fuzzing, endpoint sweeps). Max 50 per batch |
| `edit_request` | Modify and resend an existing request. Preserves auth/cookies while changing method, path, headers, or body |
| `export_curl` | Convert a request to an executable curl command for PoC reports |

### Replay Sessions & Collections

| Tool | What it does |
|------|-------------|
| `create_replay_session` | Create named replay session, optionally seed with a request |
| `list_replay_sessions` | List replay sessions |
| `delete_replay_sessions` | Bulk delete replay sessions by ID |
| `move_replay_session` | Move a session to a different collection |
| `get_replay_entry` | Get replay entry with request/response |
| `clear_session_cookies` | Wipe in-memory cookie jar for a session |
| `get_session_cookies` | List cookie metadata stored in a session jar (values not returned) |
| `list_replay_collections` | List replay session collections |
| `create_replay_collection` | Create a named replay collection |
| `rename_replay_collection` | Rename a replay collection |
| `delete_replay_collection` | Delete a replay collection |

### Automate (Fuzzing)

| Tool | What it does |
|------|-------------|
| `list_automate_sessions` | List fuzzing sessions |
| `get_automate_session` | Session details with entry list |
| `get_automate_entry` | Fuzz results with payloads |
| `automate_task_control` | Start/pause/resume/cancel fuzzing tasks |

### Findings

| Tool | What it does |
|------|-------------|
| `list_findings` | List security findings |
| `create_finding` | Create finding linked to a request |
| `delete_findings` | Delete findings by IDs or reporter name |
| `export_findings` | Export findings for reporting |

### Sitemap & Scopes

| Tool | What it does |
|------|-------------|
| `get_sitemap` | Browse discovered endpoint hierarchy |
| `list_scopes` | List target scopes |
| `is_in_scope` | Check if a host/URL is in project scope; returns matching scope and allow/deny rule |
| `create_scope` | Create scope with allow/deny lists |
| `rename_scope` | Rename a scope |
| `delete_scope` | Delete a scope |

### Projects

| Tool | What it does |
|------|-------------|
| `list_projects` | List projects, marks current |
| `select_project` | Switch active project |
| `create_project` | Create a new project |
| `rename_project` | Rename a project |
| `delete_project` | Delete a project |

### Workflows

| Tool | What it does |
|------|-------------|
| `list_workflows` | List automation workflows |
| `run_workflow` | Execute an active or convert workflow |
| `toggle_workflow` | Enable or disable a workflow |

### Tamper Rules (Match & Replace)

| Tool | What it does |
|------|-------------|
| `list_tamper_rules` | List Match & Replace rule collections |
| `create_tamper_rule` | Create a tamper rule in a collection |
| `update_tamper_rule` | Update an existing tamper rule |
| `toggle_tamper_rule` | Enable or disable a tamper rule |
| `delete_tamper_rule` | Delete a tamper rule |

### Intercept

| Tool | What it does |
|------|-------------|
| `intercept_status` | Get intercept status (PAUSED/RUNNING) |
| `intercept_control` | Pause or resume intercept |
| `list_intercept_entries` | List queued intercept entries with HTTPQL filtering |
| `forward_intercept` | Forward intercepted request, optionally with modifications |
| `drop_intercept` | Drop intercepted request |

### Environments

| Tool | What it does |
|------|-------------|
| `list_environments` | List environments and their variables |
| `select_environment` | Switch active environment |
| `create_environment` | Create a new environment |
| `delete_environment` | Delete an environment |

### Filters

| Tool | What it does |
|------|-------------|
| `list_filters` | List saved HTTPQL filter presets |
| `create_filter` | Save an HTTPQL query as a named filter preset |
| `delete_filter` | Delete a filter preset |

### WebSocket

| Tool | What it does |
|------|-------------|
| `list_ws_streams` | List WebSocket streams (connections) from the WebSocket tab |
| `list_ws_messages` | List WebSocket frames for a stream (direction, format, decoded body) |

### Utilities

| Tool | What it does |
|------|-------------|
| `convert_body` | Convert a request body between JSON, form-urlencoded, XML, and multipart |
| `race_window_send` | Fire raw HTTP/1.1 requests with synchronized last-byte send for race-condition testing (bypasses Caido proxy) |
| `get_instance` | Get Caido version and platform info |

### Admin

| Tool | What it does |
|------|-------------|
| `list_hosted_files` | List hosted payload files |
| `list_tasks` | List running background tasks |
| `cancel_task` | Cancel a running task by ID |
| `list_plugins` | List installed plugin packages |

## MCP Resources (6)

Read-only data exposed via the MCP resources protocol. Agents can read these without consuming tool calls.

| URI | Description |
|-----|-------------|
| `caido://requests/{id}` | Full HTTP request and response for a given request ID |
| `caido://replay-sessions/{id}` | Replay session details with entry list |
| `caido://sitemap` | Root domains from the sitemap |
| `caido://findings` | Security finding summaries (up to 100) |
| `caido://scopes` | All target scopes with their allow/deny rules |
| `caido://project` | Current project, instance version, and connection status |

## Session Cookie Jar

The server maintains an RFC 6265-compliant in-memory cookie jar per replay session. Any `Set-Cookie` from a response is stored and auto-injected into subsequent requests targeting the same domain/path.

Key behaviours:
- Pass `useCookieJar: false` on a single call to disable injection (useful for session-fixation testing or verifying auth gates)
- `clear_session_cookies` wipes the jar between test runs
- `get_session_cookies` introspects stored cookies (metadata only, values not returned)
- Each `send_request` response includes a `cookieJar` block showing `injectedCookies` (names sent) and `storedCookies` (names captured)

Multi-step authenticated flows work out of the box -- login once, subsequent requests carry the session automatically.

## Built-in Protections

- **Credential redaction** -- Authorization, Cookie, Set-Cookie, Proxy-Authorization, and API key headers replaced with `[REDACTED]` in all tool output (opt out with `CAIDO_ALLOW_SENSITIVE_HEADERS`)
- **Tool annotations** -- every tool declares `readOnlyHint`/`destructiveHint`/`idempotentHint`/`openWorldHint` so MCP clients distinguish read-only, destructive, and external-network tools
- **Adaptive body limits** -- JSON gets 4KB, HTML 3KB, binary 200B (override with explicit `bodyLimit`)
- **Response fingerprinting** -- auto-detects content kind (json/html/xml/text/binary)
- **Response diff** -- repeated identical responses in the same session collapse to a one-line summary, saving tokens
- **Input validation** -- length limits on all string inputs to prevent context flooding
- **Token auto-refresh** -- expired OAuth tokens refresh mid-session automatically
- **Session reuse** -- single replay session per server lifetime, no sprawl

## CLI

Standalone terminal client for Caido. No MCP required.

```bash
# Install
curl -fsSL https://raw.githubusercontent.com/c0tton-fluff/caido-mcp-server/main/install.sh | TOOL=cli bash

# Check connection
caido-cli status -u http://localhost:8080

# Send structured requests
caido-cli send GET https://target.com/api/users
caido-cli send POST https://target.com/api/login -j '{"user":"admin","pass":"test"}'
caido-cli send PUT https://target.com/api/profile -H "Authorization: Bearer tok" -j '{"role":"admin"}'

# Send raw HTTP
caido-cli raw 'GET /api/users HTTP/1.1\r\nHost: target.com\r\n\r\n'
caido-cli raw -f request.txt --host target.com --port 8443

# Parallel requests (BAC sweeps, param fuzzing, endpoint sweeps)
caido-cli batch sweep https://target.com/api/profile -t "owner=eyJ1...,cross=eyJ2...,noauth=eyJ3"
caido-cli batch fuzz "https://target.com/api/search?q=test" -p q -v "test,test',1 OR 1=1"
caido-cli batch ep -t eyJ... https://target.com/dashboard https://target.com/admin

# Browse proxy history
caido-cli history
caido-cli history -f 'req.host.eq:"target.com"' -n 20

# Get full request/response
caido-cli request 12345

# Encode/decode
caido-cli encode base64 "hello world"
caido-cli decode url "%3Cscript%3E"
```

## Caido vs Burp MCP

| Feature | Caido MCP | Burp MCP |
|---------|-----------|----------|
| Transport | Go > GraphQL | Go > SSE |
| Tools | 66 + 6 resources | 10 |
| Filtering | HTTPQL (`req.host.eq:"..."`) | Regex |
| Batch ops | `batch_send` (50 parallel) | `batch_send` (10 parallel) |
| Cookie jar | RFC 6265 per-session | No |
| Fuzzing | Automate sessions | Send to Intruder |
| Scanner | No built-in | `get_scanner_issues` |
| Match & Replace | Full CRUD (5 tools) | No |
| Intercept | Full control + modifications | No |
| WebSocket | `list_ws_streams` + `list_ws_messages` | No |
| Race conditions | `race_window_send` | No |
| Body conversion | `convert_body` (JSON/form/XML/multipart) | No |
| Projects | Full CRUD | No |
| Scopes | Full CRUD + `is_in_scope` check | No |
| Environments | Full CRUD | No |
| Auth | OAuth + static token | None (localhost) |

**Use Caido for**: daily proxy work, HTTPQL filtering, multi-step authenticated flows, fuzzing with Automate, workflow automation, batch testing, intercept control, WebSocket inspection, race condition testing.

**Use Burp for**: active scanning, Collaborator/blind testing, extension ecosystem (Autorize, Param Miner).

## Port Notes

- Caido default proxy: `127.0.0.1:8080`
- Burp default proxy: `127.0.0.1:8080` (conflict)
- Change one (e.g., Caido to `127.0.0.1:1234`)
- MCP servers use different ports: Caido GraphQL (8080) vs Burp SSE (9876) -- no conflict
