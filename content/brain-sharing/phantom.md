---
title: Phantom
tags:
  - security
  - go
  - pentest
  - ai
  - automation
aliases:
  - "/Brain-Sharing/Phantom"
---
Autonomous penetration testing operator. Native Go detectors, signal-based attack planning, and an engagement engine that chains findings into critical-severity paths. Designed to work with AI assistants as the reasoning layer while Go handles all detection at machine speed.

Private project -- not open source. Sharing the architecture and thinking here for anyone building similar tooling.

## What It Is

Phantom is a penetration testing framework where AI does the thinking and Go does the testing. Instead of running a scanner and reading output, the AI reads application source code, builds a mental model of what matters, creates a ranked attack plan, and then drives native Go detectors against confirmed targets.

The key insight: scanners find vulnerabilities. Phantom finds attack paths. A medium-severity IDOR becomes critical when chained with a BAC finding that grants access to admin functionality. Phantom's engine tracks these chains automatically.

## Architecture

```
AI Assistant (reasoning, planning, exploitation)
        |
        v
Phantom Engine (Go) -- engagement state, signals, chains, coverage tracking
        |
        v
Go Detectors (25) -- native binaries, each tests one vulnerability class
        |
        v
Proxy (Caido/Burp) -- complex exploitation, race conditions, business logic
```

The AI assistant handles:
- Reading extracted source maps and building a comprehension model
- Creating ranked attack plans based on signal strength
- Driving exploitation of confirmed findings via proxy
- Business logic testing that requires understanding context

The Go engine handles:
- Engagement state (SQLite) -- endpoints, credentials, findings, signals
- Signal detection and ranking
- Chain analysis -- two mediums that combine into a critical
- Contagion -- if IDOR works on /users/:id, auto-queue /orders/:id
- Coverage tracking -- what was tested, what was eliminated, what remains

## Detectors (25)

Each detector is a standalone binary that reads endpoints from the engagement database, runs its tests, and writes findings back. All native macOS arm64 -- no Docker, no Python, no network dependencies beyond the target.

| Detector | What it tests |
|----------|--------------|
| `jwt` | Algorithm confusion, none alg, key reuse, claim manipulation |
| `bac` | Horizontal/vertical access control on all endpoints |
| `auth-matrix` | Cross-role access matrix (user A accessing user B resources) |
| `idor` | Direct object reference manipulation across all ID parameters |
| `mass-assign` | Hidden field injection on writable endpoints |
| `sqli` | Boolean, error-based, time-based injection on all parameters |
| `xss` | Reflected/stored XSS with context-aware payload selection |
| `cors` | Origin reflection, null origin, credential exposure |
| `ssrf` | URL parameter fetch testing with callback verification |
| `pp` | Prototype pollution on Node.js/Express targets |
| `xxe` | XML external entity injection on XML-accepting endpoints |
| `qfuzz` | Hidden query parameter discovery + injection testing |
| `gateway` | API gateway bypass (path traversal, method override, version rollback) |
| `websocket` | WebSocket auth, CSWSH, message injection |
| `waf` | WAF detection and bypass technique identification |
| `token-entropy` | Session token randomness analysis + admin path fuzzing |
| `race` | Time-of-check/time-of-use on state-changing operations |
| `cache-deception` | Web cache deception via path confusion |
| `api-gateway-bypass` | Cloud API gateway authentication bypass |
| `unicode-case` | Unicode case mapping bypass for auth checks |
| `webhook-bypass` | Webhook URL validation bypass |
| `session-fixation` | Session fixation via token injection |
| `state-machine` | Multi-step workflow state bypass |
| `graphql` | Introspection, batching, depth attacks on GraphQL endpoints |
| `init` | User registration, login, token extraction (setup detector) |

## The Engine

The engagement engine is the central state machine. It tracks:

- **Endpoints** -- discovered routes with method, path, parameters, and auth requirements
- **Credentials** -- registered test users and admin tokens for multi-role testing
- **Signals** -- indicators from source code, error responses, and detector output that suggest vulnerability classes
- **Findings** -- confirmed vulnerabilities with evidence and severity
- **Chains** -- combinations of findings that escalate severity (IDOR + BAC = ATO path)
- **Coverage** -- what has been tested, what was eliminated, what remains

Every finding triggers automatic chain analysis. When two findings combine into a higher-severity path, the engine flags it immediately and reprioritises the attack plan.

## Workflow

1. **Recon** -- a Go binary (`pentest-init-flow`) extracts endpoints from the target in ~3 seconds. Finds API routes, downloads source maps, scans source for security signals.

2. **Plan** -- the AI reads extracted source code, answers "what does this app do and what would be critical here?", then presents a ranked attack plan. Human approves before any testing begins.

3. **Detect** -- Go detectors run one by one against the target. Each reads endpoints from the DB, tests its vulnerability class, and writes findings back. The AI reads output after each detector and adjusts course.

4. **Exploit** -- confirmed signals get manual exploitation via proxy. Business logic, race conditions, multi-step chains -- things that require understanding context rather than pattern matching.

5. **Report** -- engine generates a findings report with chain analysis. Feeds learnings back into a history database that improves signal ranking for future engagements.

## Design Decisions

**Why Go detectors instead of Python scripts?**
Speed and reliability. A Go binary starts in milliseconds, handles HTTP/2 natively, doesn't need dependency management, and compiles to a single file. No virtualenv, no pip, no Docker. Copy the binary and run.

**Why not just run a scanner?**
Scanners don't understand context. They can't tell you that the IDOR on /api/users/:id is critical because the app is a medical records system. They can't chain a medium-severity mass assignment with a vertical BAC into an account takeover. Phantom's AI layer provides the judgment that makes findings actionable.

**Why signal-based planning?**
Testing everything on every endpoint is wasteful. Source code analysis reveals where the interesting logic lives. Error messages leak implementation details. Signal-based planning focuses effort on the highest-probability targets first.

**Why one detector at a time?**
Running all detectors in parallel provides zero visibility for 2+ minutes. Running them sequentially lets the AI read each output, learn from it, and adjust the next detector's priority. A CORS finding might bump SSRF to the top of the queue. A mass assignment finding might trigger immediate BAC re-testing on the affected endpoint.

## Thinking Patterns

The difference between a scanner and an operator:

- **Think backwards from impact** -- don't test all endpoints. Ask "how do I achieve account takeover?" and work backwards to the attack path.
- **Every error is a window** -- a 400 response with "must be one of: admin, user, moderator" is free enumeration, not a failure.
- **Chain everything** -- two mediums that chain into a critical is the headline finding. Always ask "what would make this finding worse?"
- **Assume the developer was lazy** -- if IDOR works on /users/:id, test /orders/:id, /invoices/:id. Same developer, same patterns.
- **Read responses, not just status codes** -- 200 with different user data vs 200 with same data tells you everything about access control.
