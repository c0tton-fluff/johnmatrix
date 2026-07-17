---
title: SentinelOne MCP Server
tags:
  - mcp
  - sentinelone
  - claude-code
  - go
  - dfir
aliases:
  - "/Brain-Sharing/MCP-Setup/SentinelOne-MCP-Server"
---
MCP server for SentinelOne EDR. Query threats, manage agents, run Deep Visibility hunts, and check hash reputation from AI assistants. Stdlib-only Go binary - zero external dependencies.

Source: [c0tton-fluff/sentinelone-mcp-server](https://github.com/c0tton-fluff/sentinelone-mcp-server)

## Architecture

```
Claude Code  -->  stdio  -->  sentinelone-mcp-server (Go)  -->  REST API  -->  SentinelOne Console
```

Single binary, no SDK dependencies. Uses Go stdlib `net/http` + `encoding/json` for all API communication.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/c0tton-fluff/sentinelone-mcp-server/main/install.sh | bash
```

Or build from source:

```bash
git clone https://github.com/c0tton-fluff/sentinelone-mcp-server.git
cd sentinelone-mcp-server
go build -ldflags "-X main.version=$(git describe --tags)" -o sentinelone-mcp-server .
```

Requires Go 1.26+.

## Auth

Set two environment variables:

- `SENTINELONE_API_KEY` -- API token from Settings > Users > API Token
- `SENTINELONE_API_BASE` -- console URL (e.g., `https://usea1-partners.sentinelone.net`)

## Claude Code Config

```json
{
  "mcpServers": {
    "sentinelone": {
      "command": "sentinelone-mcp-server",
      "args": ["serve"],
      "env": {
        "SENTINELONE_API_KEY": "your-api-token",
        "SENTINELONE_API_BASE": "https://your-console.sentinelone.net"
      }
    }
  }
}
```

## Tools (14)

### Threat Management

| Tool | What it does |
|------|-------------|
| `s1_list_threats` | List threats with filters (status, classification, time range) |
| `s1_get_threat` | Threat details by ID |
| `s1_mitigate_threat` | Execute mitigation action (kill, quarantine, remediate, rollback) |
| `s1_investigate_threat` | Full threat context -- process tree, indicators, timeline |
| `s1_set_analyst_verdict` | Set verdict (true_positive, false_positive, suspicious, undefined) |
| `s1_set_incident_status` | Update incident status (in_progress, resolved, unresolved) |

### Agent Management

| Tool | What it does |
|------|-------------|
| `s1_list_agents` | List agents with filters (OS, status, infection status) |
| `s1_get_agent` | Agent details by ID |
| `s1_isolate_agent` | Network isolate an endpoint |
| `s1_reconnect_agent` | Remove network isolation |

### Alerts & Intelligence

| Tool | What it does |
|------|-------------|
| `s1_list_alerts` | List alerts with severity/type filters |
| `s1_hash_reputation` | Check file hash reputation (SHA1) |

### Deep Visibility (Threat Hunting)

| Tool | What it does |
|------|-------------|
| `s1_dv_query` | Create Deep Visibility query (process, file, network, registry events) |
| `s1_dv_get_events` | Get query results with pagination |

## Use Cases

**Incident triage**: "Show me unresolved threats from the last 24 hours, investigate the highest severity one, and isolate the affected endpoint."

**Threat hunting**: "Run a Deep Visibility query for processes spawning cmd.exe with encoded PowerShell arguments across all Windows agents."

**Hash lookup**: "Check if this SHA1 hash is known malicious and list any agents where it was detected."

## Design

- Zero external dependencies -- stdlib `net/http` only
- Structured JSON responses with consistent error format
- Pagination support on list operations
- Input validation with length limits
- API key never logged or exposed in tool output
