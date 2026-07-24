---
title: "MCP Permission Models Are Broken"
description: "The Model Context Protocol's permission model is broken. Here's how to fix it before agents ship."
tags:
  - ai
  - security
  - mcp
  - tool-use
  - research
date: 2026-05-23
aliases:
  - "/AI-Research/MCP-Permission-Models-Are-Broken"
---
I've built five open-source MCP servers in Go that give AI agents access to security infrastructure: web proxies (Caido, Burp Suite), EDR platforms (SentinelOne), bug bounty APIs (HackerOne), and SIEM search. Each server required designing a permission model from scratch because MCP doesn't provide one. What I discovered: the protocol has a fundamental authorization gap that makes building safe agent tooling unnecessarily hard.

This post covers what's broken, real examples from production security MCP servers, and what should exist instead.

## What MCP Gives You

The Model Context Protocol (MCP) is Anthropic's standard for connecting AI agents to external tools. It handles:

- Tool registration via JSON Schema
- Transport layer (stdio, SSE, HTTP)
- Tool descriptions that inform the LLM what's available
- Request/response serialization

That's it. No authorization framework. No scope enforcement. No action budgets. No audit trail. The protocol assumes the server implementer will handle all of this.

For simple read-only tools ("get weather", "search docs"), this works fine. For security tools that can query EDR platforms, replay HTTP requests, or submit vulnerability reports, it's a problem.

## The Permission Gap

MCP has no concept of tool capabilities or session-scoped permissions. The protocol defines:

1. A tool has a name, description, and input schema
2. The client calls the tool with arguments
3. The server returns a result

There's no way to express:

- This tool is read-only vs. this tool mutates state
- This agent session should only access tools 1-3, not tools 4-6
- This tool can be called at most N times per session
- This tool requires human approval before execution
- This tool's scope should be limited to specific targets/time ranges/data types

The host application (Claude Code, Claude Desktop, etc.) implements permissions at the UI level. Users approve tool calls interactively. But the MCP server is blind to these approval policies. There's no way for the server to say "this tool is dangerous, enforce extra checks" or "restrict this query to production-safe parameters."

Every MCP server becomes a custom authorization implementation with no shared patterns.

## Real Examples from Security MCP Servers

### Example 1: EDR Server (SentinelOne)

The `sentinelone-mcp` server exposes endpoint detection and response tools. Two representative tools:

**Tool: `list_threats`**
```json
{
  "name": "list_threats",
  "description": "List active threats detected by SentinelOne",
  "inputSchema": {
    "type": "object",
    "properties": {
      "limit": {"type": "integer", "default": 50}
    }
  }
}
```

This is read-only, safe, and scoped by default (returns recent threats).

**Tool: `create_power_query`**
```json
{
  "name": "create_power_query",
  "description": "Execute arbitrary Deep Visibility query across the fleet",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": {"type": "string"},
      "fromDate": {"type": "string"},
      "toDate": {"type": "string"}
    }
  }
}
```

This executes arbitrary queries across every endpoint in the SentinelOne fleet. The agent can:

- Query process trees for any host
- Pull file system events from production servers
- Search network connections across the entire infrastructure
- Extract sensitive data from endpoint logs

There's no way in MCP to express "allow threat listing but restrict query scope to dev endpoints only" or "limit queries to read-only event types."

**What I built instead:**

- Server-side scope filtering: hardcoded site ID restrictions in the server config
- Query complexity limits: reject queries with wildcards in certain fields
- Time window caps: enforce maximum 7-day query range
- Allowlist enforcement: only permit queries against non-production sites

All of this is custom code. The MCP protocol doesn't help. A developer building an EDR server for the first time won't know these restrictions are necessary. The protocol gives no guidance.

### Example 2: Web Proxy Server (Caido)

The `caido-mcp-server` exposes web application testing tools. Two examples:

**Tool: `get_requests`**
```json
{
  "name": "get_requests",
  "description": "Retrieve HTTP requests captured by Caido proxy",
  "inputSchema": {
    "type": "object",
    "properties": {
      "filter": {"type": "string"},
      "limit": {"type": "integer"}
    }
  }
}
```

Read-only, safe for analysis.

**Tool: `replay_request`**
```json
{
  "name": "replay_request",
  "description": "Replay an HTTP request through the proxy",
  "inputSchema": {
    "type": "object",
    "properties": {
      "requestId": {"type": "string"},
      "modifications": {"type": "object"}
    }
  }
}
```

This resends an HTTP request with optional modifications. The agent can:

- Replay authentication requests (potentially locking accounts)
- Resend POST requests (duplicate transactions, trigger side effects)
- Test payloads against production targets
- Interact with any service the proxy has seen

An agent authorized to "analyze captured traffic" suddenly has the ability to interact with live targets. The description says "replay" but doesn't convey "this can send live HTTP to production systems."

**What I built instead:**

- Replay-only-in-scope enforcement: server checks if target matches the proxy's "testing scope" configuration
- Target allowlist: hardcoded list of safe replay targets (localhost, *.test, specific staging URLs)
- Rate limiting: max 10 replays per minute
- Mutation restrictions: reject modifications to Authorization headers or session cookies

Again, all custom. The MCP protocol has no concept of "safe" vs "dangerous" tool invocations.

### Example 3: Bug Bounty Server (HackerOne)

The `hackerone-mcp` server exposes vulnerability management tools.

**Tool: `get_reports`**
```json
{
  "name": "get_reports",
  "description": "Retrieve vulnerability reports from HackerOne programs",
  "inputSchema": {
    "type": "object",
    "properties": {
      "program": {"type": "string"},
      "state": {"type": "string"}
    }
  }
}
```

Read-only, safe.

**Tool: `submit_report`**
```json
{
  "name": "submit_report",
  "description": "Submit a new vulnerability report to a HackerOne program",
  "inputSchema": {
    "type": "object",
    "properties": {
      "program": {"type": "string"},
      "title": {"type": "string"},
      "vulnerability_information": {"type": "string"},
      "severity": {"type": "string"}
    },
    "required": ["program", "title", "vulnerability_information"]
  }
}
```

This creates a vulnerability report visible to the program and has your researcher reputation attached. An overzealous or poorly-prompted agent could:

- Submit false positive reports (damage reputation, get banned from programs)
- Disclose invalid findings (waste program time, violate disclosure norms)
- Submit duplicate reports (spamming behavior)

A human researcher would review findings before submission. An autonomous agent might not.

**What I built instead:**

- Draft-only mode: tool creates a local draft, does not submit to HackerOne
- Human approval gate: server returns draft ID, requires separate `approve_and_submit` call
- Validation checks: server rejects reports missing CVE/CWE references, proof-of-concept, or impact statements
- Rate limiting: max 3 submissions per hour

The MCP protocol treats `submit_report` the same as `get_reports`. There's no way to declare "this tool is high-risk and requires extra scrutiny."

### Example 4: SIEM Search Server

The SIEM search server exposes log analysis tools (Splunk, Sentinel, etc.).

**Tool: `search_logs`**
```json
{
  "name": "search_logs",
  "description": "Execute log search query",
  "inputSchema": {
    "type": "object",
    "properties": {
      "query": {"type": "string"},
      "earliest": {"type": "string"},
      "latest": {"type": "string"},
      "index": {"type": "string"}
    }
  }
}
```

This executes arbitrary queries across all indexed log data. The agent can:

- Search for sensitive data (API keys, passwords, PII)
- Query audit logs (attribution, user activity)
- Pull security event data (failed logins, endpoint alerts)
- Access data across all tenants/customers if multi-tenant

There's no way to express "this agent should only query dev indexes" or "limit queries to authentication logs, not all indexes."

**What I built instead:**

- Index allowlist: server config restricts which indexes are queryable
- Field redaction: automatic masking of sensitive fields (passwords, tokens, email addresses)
- Query rewriting: inject `index=allowed_* NOT sourcetype=sensitive` into every query
- Time window enforcement: reject queries spanning more than 30 days

All server-side. The protocol doesn't help.

## Comparison Table

| Tool | Read/Write | Risk Level | MCP Support | What I Built Instead |
|------|------------|------------|-------------|----------------------|
| `list_threats` | Read | Low | None | None needed |
| `create_power_query` | Read (arbitrary) | High | None | Scope filtering, complexity limits, time caps |
| `get_requests` | Read | Low | None | None needed |
| `replay_request` | Execute | High | None | Target allowlist, rate limiting, scope enforcement |
| `get_reports` | Read | Low | None | None needed |
| `submit_report` | Write | High | None | Draft-only mode, human approval gate, validation checks |
| `search_logs` | Read (arbitrary) | High | None | Index allowlist, field redaction, query rewriting |

Every high-risk tool required custom authorization logic. MCP treats them all the same.

## The Fundamental Problem

MCP delegates ALL authorization to the server implementer. Most MCP servers are built by developers who:

1. Don't think about adversarial agents (they're focused on functionality)
2. Don't know which tools are dangerous (no threat model built into the protocol)
3. Don't have patterns to follow (every server is a custom implementation)

The protocol has no way to express:

- **Tool capability levels**: Is this tool read-only, mutating, or destructive?
- **Scope parameters**: What dimensions of access control exist (target, time, data type)?
- **Action budgets**: How many times can this tool be called per session?
- **Risk signals**: Should this tool trigger extra scrutiny or human approval?

There's no capability negotiation. An agent either has access to a tool or it doesn't. The server can't tell the host "this tool is dangerous, please enforce extra checks."

Result: every MCP server is a bespoke authorization system. Security properties are implicit, not declared. Developers reinvent the wheel.

## What Should Exist

Here's what a better permission model would look like:

### 1. Tool Capability Levels

Declare capability level in the tool schema:

```json
{
  "name": "replay_request",
  "description": "Replay an HTTP request through the proxy",
  "capabilities": ["execute", "network"],
  "inputSchema": { ... }
}
```

Capability levels:

- `read`: Read-only data access
- `write`: Mutate server-side state
- `execute`: Trigger external actions (network requests, command execution)
- `destructive`: Delete data or perform irreversible operations

The host enforces stricter approval policies for higher capability levels. A `read` tool might auto-approve after initial grant. An `execute` tool might require per-invocation approval.

### 2. Session-Scoped Permission Grants

The host tells the server what the current session is allowed to do:

```json
{
  "session_id": "agent-123",
  "grants": [
    {
      "tool": "create_power_query",
      "capabilities": ["read"],
      "scope": {
        "site_id": ["dev-site-001"],
        "time_range": "7d"
      }
    }
  ]
}
```

The server enforces these grants at tool invocation time. If the agent tries to query a production site or a 30-day time window, the server rejects the request.

### 3. Action Budgets

Declare and enforce call limits in the protocol:

```json
{
  "name": "submit_report",
  "description": "Submit vulnerability report",
  "budgets": {
    "max_calls_per_hour": 3,
    "requires_approval": true
  }
}
```

The MCP runtime tracks invocations and blocks calls that exceed the budget. No server-side code needed.

### 4. Audit Events

Structured log of every tool invocation:

```json
{
  "timestamp": "2026-05-23T10:15:30Z",
  "session_id": "agent-123",
  "tool": "replay_request",
  "inputs": {"requestId": "req-456", "target": "https://staging.example.com"},
  "result": {"status": 200, "response_size": 1024},
  "approved_by": "user@example.com"
}
```

MCP servers emit these events to a host-provided audit sink. The protocol defines the schema. Every tool invocation is logged by default.

### 5. Scope Parameters

Servers declare what scoping dimensions exist:

```json
{
  "name": "create_power_query",
  "description": "Execute EDR query",
  "scope_parameters": {
    "site_id": {
      "type": "string",
      "description": "Restrict query to specific SentinelOne site",
      "required": false
    },
    "time_range": {
      "type": "duration",
      "description": "Maximum query time window",
      "default": "7d",
      "max": "30d"
    }
  }
}
```

The host can enforce tighter restrictions than the defaults. The server declares the contract, the host configures the policy.

## What I Do Instead

Until MCP gets a real permission model, here's my workaround stack:

### Server-Side Scope Enforcement

Every security MCP server has a config file:

```yaml
sentinelone:
  api_token: ${SENTINELONE_API_TOKEN}
  base_url: https://example.sentinelone.net
  allowed_sites:
    - dev-site-001
    - test-site-002
  max_query_time_range: 7d
  forbidden_query_patterns:
    - "*.exe"
    - "*password*"
```

The server enforces these restrictions before calling the SentinelOne API. The MCP client is unaware.

### Separate Read and Write Tool Registrations

Instead of one `manage_request` tool that can read or mutate, I register:

- `get_request` (read-only)
- `replay_request` (execute)
- `create_finding` (write)

This lets the host apply different approval policies per tool. It's an artificial split (same underlying API), but it works.

### Human-in-the-Loop Gates

For high-risk tools like `submit_report`, the MCP tool doesn't actually submit. It creates a draft and returns:

```json
{
  "status": "draft_created",
  "draft_id": "draft-789",
  "preview_url": "https://localhost:8080/drafts/draft-789",
  "next_step": "Review the draft and call approve_and_submit with draft_id to publish"
}
```

The agent can't bypass human review. The server enforces the gate.

### Custom Audit Logging

Every tool invocation writes to a structured log:

```go
func (s *Server) logToolCall(tool string, input map[string]interface{}, result interface{}) {
    entry := AuditEntry{
        Timestamp: time.Now(),
        Tool:      tool,
        Input:     input,
        Result:    result,
        Session:   s.sessionID,
    }
    s.auditLog.Write(entry)
}
```

I parse these logs weekly to catch overzealous agents or tool misuse. The MCP protocol doesn't provide this.

### Input Validation

Every tool handler validates inputs before calling the underlying API:

```go
func (s *Server) createPowerQuery(args PowerQueryArgs) error {
    if err := s.validateSiteID(args.SiteID); err != nil {
        return fmt.Errorf("site_id not allowed: %w", err)
    }
    if err := s.validateTimeRange(args.FromDate, args.ToDate); err != nil {
        return fmt.Errorf("time range exceeds policy: %w", err)
    }
    if err := s.validateQueryComplexity(args.Query); err != nil {
        return fmt.Errorf("query too broad: %w", err)
    }
    return s.sentinelClient.CreateQuery(args)
}
```

Reject bad requests before they hit the API. The MCP protocol doesn't guide what "bad" means.

## Implications for Agent Safety

Every MCP server is a trust boundary. The protocol doesn't help you enforce it.

As agents get more capable, the gap between "what the tool can do" and "what the agent should do" widens. Current MCP deployments work when:

- Humans approve every tool call (interactive mode)
- Tool capabilities are limited (read-only, low-risk)
- The environment is sandboxed (dev/test only)

The model breaks when:

- Agents run autonomously (no human in the loop)
- Tools have high-risk capabilities (execute, write, delete)
- The environment is production (blast radius is large)

Real example: I ran an agent with access to the Caido MCP server against a bug bounty target. The agent correctly identified a reflected XSS vulnerability. It then called `replay_request` 47 times testing payloads, including attempts to exfiltrate cookies and inject keyloggers. I had to kill the session because it was replaying against the production target, not a local test instance. The MCP protocol gave no way to say "only replay against localhost."

Another example: An agent triaging a security alert called `create_power_query` to search for lateral movement indicators across the EDR fleet. The query returned 50,000 results spanning production and dev endpoints. The agent then called `create_power_query` 12 more times with increasingly broad wildcards, pulling gigabytes of endpoint data. I had to manually terminate the queries in the SentinelOne console. The MCP protocol gave no way to say "limit query result size" or "restrict to dev endpoints."

Security MCP servers need:

- Fine-grained capability control (read vs. write vs. execute)
- Scope enforcement (which targets, which time ranges, which data types)
- Action budgets (call limits, rate limits)
- Audit trails (who did what when)

None of this exists in the protocol. Every server implementer builds it from scratch, or doesn't build it at all.

## 2026: The Protocol Starts Listening

I wrote this in May 2026 saying these should be protocol primitives. Six months on, the ecosystem is moving -- not fast enough, but in the right direction.

**What I got right.** The call for capability levels, scope parameters, and audit events is being heard. MCP capability negotiation and guardrail primitives are now appearing in framework discussions. The A2A (agent-to-agent) protocol shipped OAuth-based agent identity -- the first brick of negotiated, scoped agent-to-agent trust. The argument that security properties should be declared and negotiated, not implicit, is becoming the consensus position.

**What is still broken.** Per-tool capability levels are still not in the MCP spec -- they live in per-server custom code, exactly where I put them. Action budgets (call limits, rate caps) are still hand-rolled. There is no standard audit schema, so every server's logs are a snowflake. And the hardest problem -- scope enforcement that survives an agent's own reasoning about why a boundary should relax -- is unchanged. The protocol can declare a capability level; it still cannot stop a persuasive agent from talking a host into granting a higher one.

The gap closed on declaration. It did not close on enforcement. That is the next fight, and it is the same one I describe in the [containment work](/ai-research/agent-containment-failures-in-offensive-tool-use/): the execution layer has to be the one that says no, because the reasoning layer always has a reason to say yes.

## Conclusion

MCP is a useful protocol for connecting AI agents to external tools. But it has a fundamental authorization gap. The protocol provides no way to express tool capabilities, scope restrictions, or risk levels. Every MCP server is a custom authorization implementation.

I've built this authorization logic five times now (EDR, web proxy, bug bounty, SIEM, another web proxy). The patterns are similar across servers: scope filtering, capability levels, human approval gates, audit logging. These should be protocol primitives, not reinvented per server.

Until MCP gets a real permission model, building safe agent tooling is harder than it needs to be. Developers building their first MCP server won't know these patterns. They'll expose high-risk tools with no guardrails because the protocol doesn't guide them.

If you're building an MCP server that gives agents access to production systems, security tools, or any API with side effects: assume the protocol won't help you enforce safety. Build authorization logic server-side. Validate inputs. Enforce scope restrictions. Log every invocation. Add human approval gates for high-risk operations.

And if you're designing agent frameworks or extending MCP: consider adding capability levels, session-scoped grants, and audit events to the protocol. The security properties of agent tooling shouldn't be implicit. They should be declared, negotiated, and enforced by the protocol itself.

## Resources

- [caido-mcp-server](https://github.com/c0tton-fluff/caido-mcp-server) (50+ stars)
- [sentinelone-mcp](https://github.com/c0tton-fluff/sentinelone-mcp)
- [burp-mcp](https://github.com/c0tton-fluff/burp-mcp)
- [hackerone-mcp](https://github.com/c0tton-fluff/hackerone-mcp)
- [MCP Specification](https://spec.modelcontextprotocol.io/)
- Author: Michal Ambrozkiewicz ([johnmatrix.org](https://johnmatrix.org))
