---
title: HackerOne MCP Server
tags:
  - mcp
  - hackerone
  - claude-code
  - go
  - vdp
aliases:
  - "/Brain-Sharing/MCP-Setup/HackerOne-MCP"
  - "/brain-sharing/mcp-setup/hackerone-mcp/"
---
MCP server for HackerOne triage teams. Full read/write access to reports, triage workflows, severity ratings, assignments, and program management -- all from your AI assistant. Single Go binary, zero external dependencies.

Source: [c0tton-fluff/hackerone-mcp](https://github.com/c0tton-fluff/hackerone-mcp)

## Architecture

```
Claude Code  -->  stdio  -->  h1-client (Go)  -->  REST API v1  -->  HackerOne
```

Single binary. Handles pagination, rate limiting, and API authentication internally.

## Install

```bash
go install github.com/c0tton-fluff/hackerone-mcp/cmd/h1-client@latest
```

Or build from source:

```bash
git clone https://github.com/c0tton-fluff/hackerone-mcp.git
cd hackerone-mcp
go build -o h1-client ./cmd/h1-client
```

## Auth

| Variable | Required | Description |
|----------|----------|-------------|
| `HACKERONE_API_ID` | Yes | API username (Settings > API Token) |
| `HACKERONE_API_TOKEN` | Yes | API token |
| `HACKERONE_PROGRAM` | No | Default program handle |

### macOS Keychain (recommended)

Store credentials securely and use the included `launch.sh` wrapper:

```bash
security add-generic-password -s hackerone-api-id -a hackerone -w "your-api-id"
security add-generic-password -s hackerone-api-token -a hackerone -w "your-api-token"
security add-generic-password -s hackerone-program -a hackerone -w "your-program-handle"
```

## Claude Code Config

```json
{
  "mcpServers": {
    "hackerone": {
      "command": "h1-client",
      "args": [],
      "env": {
        "HACKERONE_API_ID": "your-api-id",
        "HACKERONE_API_TOKEN": "your-api-token",
        "HACKERONE_PROGRAM": "your-program-handle"
      }
    }
  }
}
```

## Tools (14)

### Read

| Tool | What it does |
|------|-------------|
| `h1_list_programs` | List accessible programs |
| `h1_list_reports` | List/filter reports (state, severity, reporter, assignee, dates, keyword, sort) |
| `h1_get_report` | Full report details with timeline and attachments |
| `h1_get_scope` | Program scope and policy |
| `h1_list_members` | Program team members |
| `h1_report_summary` | Aggregate stats by state/severity/bounty |
| `h1_download_attachment` | Download report attachments |
| `h1_incremental_activities` | Recent activity feed across reports |

### Triage

| Tool | What it does |
|------|-------------|
| `h1_add_comment` | Add internal or public comment |
| `h1_update_state` | Change report state (triage, resolve, close, duplicate) |
| `h1_update_severity` | Set CVSS rating |
| `h1_assign_report` | Assign to team member |
| `h1_add_summary` | Add or update report summary |
| `h1_update_title` | Update report title |

## Use Cases

**Daily triage**: "Show me new reports from the last 24 hours, sorted by severity. Triage the critical ones and assign to the right team member."

**Duplicate detection**: "Get the details on report #12345. Search for similar reports about XSS on the login page. If it's a duplicate, close it with a reference to the original."

**Program health**: "Give me a summary of our program -- open reports by severity, average time to triage, and bounty spend this month."

**Bulk operations**: "List all reports assigned to the person who just left the team and reassign them to me."

## Design

- Zero external dependencies -- stdlib `net/http` only
- Built-in pagination for list operations
- Rate limit handling with automatic backoff
- Structured JSON responses with consistent error format
- Keychain-based credential storage for macOS
