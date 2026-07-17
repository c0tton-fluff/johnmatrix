---
title: "Agent Containment Failures in Offensive Tool-Use"
tags:
  - ai
  - safety
  - agent
  - containment
  - research
date: 2026-05-23
aliases:
  - "/AI-Research/Agent-Containment-Failures-in-Offensive-Tool-Use"
---
## Introduction

When you build an autonomous agent with real offensive capabilities - not a demo, not a CTF solver, but a system designed to find vulnerabilities in production environments - containment isn't optional. It's the primary engineering challenge.

Over six months of building and testing an autonomous red team engine (57K lines of Go, 1500+ tests, 32 web vulnerability detectors, 8 Kubernetes misconfiguration detectors), I encountered every class of containment failure described in the agent safety literature, plus several that aren't documented anywhere. This post taxonomizes those failures and presents the solutions that actually worked in production.

The containment problem is different for offensive security agents than for general-purpose assistants. A customer service bot that hallucinates is annoying. A red team agent that escapes its scope boundaries could violate the Computer Fraud and Abuse Act. The stakes demand hard enforcement, not soft guardrails.

## The Containment Model

The original design included five layers of containment:

**Scope Boundaries**: Target allowlist (explicit hostnames and IP ranges), network CIDR restrictions, and domain-level scope enforcement. An engagement specifies `target: example.com` - the agent should never touch `attacker-controlled.com` even if it discovers a link to it.

**Action Allowlists**: Which HTTP methods are permitted (GET/POST but not DELETE), which exploit classes are authorized (information disclosure but not remote code execution), which post-exploitation actions are allowed (read-only file access but not account manipulation). These are specified per engagement.

**Action Budgets**: Maximum requests per endpoint (prevents brute force escalation), maximum total requests per engagement (prevents exponential expansion), maximum time per target (prevents agents from getting stuck in optimization loops).

**Kill Switches**: Operator interrupt (user presses Ctrl+C, agent halts gracefully), automatic halt on scope violation (agent attempts to contact an out-of-scope host, execution stops immediately), rate limit triggers (if the target returns 429 responses, pause testing).

**Human-in-the-Loop Gates**: Certain actions require operator approval before execution. Data exfiltration, account manipulation, destructive operations (DELETE requests, file modifications, credential use) all block and wait for operator confirmation.

This model looks reasonable on paper. In practice, every layer failed in ways that weren't anticipated during design.

## Taxonomy of Containment Failures

### Class 1: Scope Escape

**Redirect Following**: The agent tests `https://example.com/login` and receives a 302 redirect to `https://sso.attacker-controlled.com/auth`. The scope enforcement logic checks the *original* URL (in-scope) but the HTTP client follows the redirect automatically. The agent continues testing the SSO endpoint because it "arrived there through an in-scope path."

This failure occurred in the first week of testing. The agent followed a redirect chain from an in-scope marketing page to an out-of-scope analytics platform and began testing authentication endpoints there. The operator immediately notices because the analytics platform had aggressive rate limiting and while testing, watching every action and documenting it.

**DNS Rebinding**: The agent resolves `example.com` to `203.0.113.45` (in-scope public IP), begins testing, and the target's DNS record changes mid-engagement to `10.0.0.5` (internal network). The agent's scope checker validated the hostname once at engagement start but didn't re-validate on subsequent requests. Result: the agent spent 20 minutes testing internal services that were never in scope.

**Link Enumeration**: The agent discovers `<a href="https://partner.example.com">` on an in-scope page. The reasoning layer argues: "This link was found on an in-scope resource, therefore it's part of the attack surface, therefore it's in scope." The agent begins testing `partner.example.com` despite it not being in the original target list.

This is particularly insidious because the reasoning is *technically correct* from a security perspective - partner domains are often attack surface. But from a containment perspective, it's a scope violation. The engagement authorized testing `example.com`, not its entire trust network.

**Fix**: Scope enforcement at the transport layer, not the application layer. Every HTTP client is wrapped in a proxy that validates the target hostname against the allowlist *before* the request leaves the system. Redirect following is disabled entirely - if a redirect is discovered, it's logged as a finding but not followed. DNS resolution happens once per request, not once per engagement. If the agent controls request construction (which it must, for vulnerability testing), scope validation cannot happen in the agent's reasoning layer.

### Class 2: Action Budget Violations

**"One More Request" Reasoning**: The agent exhausts its request budget but argues: "I detected a timing difference that suggests SQL injection. One additional request with a longer delay will confirm it." The operator approves. Five minutes later: "The confirmation returned ambiguous results. One more request with error-based injection will prove it definitively." The operator approves again. This continues until the budget has effectively doubled.

The failure isn't the operator's willingness to approve exceptions. It's that the budget was implemented as a suggestion rather than a hard limit. The agent could *ask* for more budget, and humans are bad at saying no to technically sound reasoning.

**Exponential Expansion**: The agent tests parameter `?user_id=123` and discovers reflected XSS. Then it notices query parameters `?session_id=`, `?api_key=`, and `?callback=` in other requests. Each parameter "needs its own XSS test suite to determine if the vulnerability is parameter-specific or systemic." Twelve parameters, five test cases each - the budget allocated for one finding now covers sixty requests.

The agent isn't wrong. Testing each parameter *is* better security analysis. But it violates the containment constraint. The engagement budgeted 500 total requests, not 500 requests per interesting parameter.

**Chain Escalation**: The agent discovers an information disclosure issue (API endpoint returns user email addresses without authentication). The reasoning layer decides: "Email addresses can be used for password reset poisoning. Testing the password reset flow is the natural next step to assess impact." The engagement authorized *information disclosure testing*, not *account takeover testing*. The agent escalated from reconnaissance to active exploitation without operator approval.

This happened during a limited engagement where it was explicitly scoped out authentication testing due to the regulatory requirements. The agent's escalation was sound security practice but violated the scope-of-work.

**Fix**: Hard budget enforcement in the execution layer. The budget is a counter decremented on every action. When it reaches zero, execution halts. No negotiation, no exceptions, no "just one more." If the operator wants to expand the budget, they pause the engagement, modify the configuration file, and restart - a deliberate, auditable action, not an in-the-moment approval.

Action escalation requires explicit authorization. Each engagement specifies allowed finding types (e.g., `[info_disclosure, xss]`). If the agent wants to test for a finding type outside that list, execution blocks and waits for operator input. The wait must be in the execution layer, not the reasoning layer - the agent cannot proceed while "thinking about whether to ask."

### Class 3: Proof Hallucination

**False Positive Amplification**: The agent tests for SQL injection by injecting `' OR '1'='1` and measuring response time. Baseline: 247ms. With payload: 255ms. The reasoning layer concludes: "8ms delay suggests database query execution. SQL injection confirmed."

Unfortunately, no. 8ms is network jitter. A real blind SQL injection produces delays measured in seconds (using `WAITFOR DELAY` or `BENCHMARK()`). But the agent interpreted any measurable difference as confirmation.

This failure mode is well-documented in the AI safety literature (METR's evaluations show similar false-positive rates in agent security assessments), but it's worse in offensive tools because false positives can trigger automatic exploitation chains. If the agent "confirms" SQL injection, the next step is attempting to extract data. If the confirmation was hallucinated, the extraction attempts are just noise that burns budget and annoys the target's security team.

**Evidence Fabrication**: The agent reports finding an SSRF vulnerability and includes a "proof of concept payload" in the finding report: `?url=http://169.254.169.254/latest/meta-data/`. The payload is correct. The problem: the agent never actually *sent* that request. It generated the payload based on pattern matching but didn't execute it, then reported it as if execution had occurred.

This happened because the agent's finding-reporting prompt said "include a proof of concept." The LLM interpreted that as "generate PoC syntax" rather than "include the PoC you actually executed." The distinction matters enormously for finding verification.

**Confidence Inflation**: The agent scans for exposed `.git` directories by requesting `/.git/HEAD`. It receives a 200 response with content `ref: refs/heads/main`. The reasoning layer reports: "High confidence finding: Git repository exposed. Impact: Source code disclosure." But the response was static HTML planted by the target's honeypot. The agent never attempted to clone the repository or verify that additional git objects were accessible.

Pattern matching (`.git/HEAD` returns expected content) is not the same as exploitation (successfully extracting source code). The agent conflated detection with validation.

**Fix**: Three-way oracle validation for every finding. 
- First, execute the payload and check for the expected marker in the response (e.g., for SSRF, check if the internal metadata endpoint's content appears). 
- Second, execute a differential test - send a benign payload to the same endpoint and verify the response is different. 
- Third, execute a control test against a known-clean endpoint and verify it *doesn't* show the marker.

Only if all three tests pass does the finding get reported. This catches false positives caused by static responses, honeypots, and network errors.

Importantly, validation logic is implemented in Go, not in the LLM's reasoning layer. The agent can propose a finding, but a deterministic validator decides whether it's real. Machine verification, not LLM assessment.

### Class 4: Implicit Privilege Escalation

**Tool-Use Beyond Intent**: The agent has access to a file-read tool authorized for source code analysis (reading `package.json`, `requirements.txt`, etc. to identify vulnerable dependencies). During testing, the agent discovers that the target's API returns file paths in error messages: `"error": "file not found: /etc/nginx/conf.d/default.conf"`. The reasoning layer decides to use the file-read tool to fetch `/etc/nginx/conf.d/default.conf` because "it's relevant to understanding the target's configuration."

The tool was authorized. The file path was discovered during authorized testing. But reading arbitrary configuration files wasn't the intended use case for that tool. This is privilege escalation through tool misuse.

**Credential Reuse**: The agent discovers hardcoded AWS credentials in a public GitHub repository belonging to the target organization. The credentials are scoped to S3 read-only access for a specific bucket. The agent uses those credentials to list bucket contents (authorized reconnaissance). Then it attempts to use the same credentials against EC2, Lambda, and IAM APIs to "map the full extent of access granted by these credentials."

The initial credential discovery was in scope. Using them against S3 was defensible (verifying they work is part of assessing impact). But attempting to use them across other AWS services crosses from impact assessment into active exploitation of lateral movement paths.

**Context Bleeding**: The agent completes an engagement against `target-a.com` and discovers that the application uses a common authentication framework (Keycloak in this example). Three days later, the operator starts a new engagement against `target-b.com`. The agent's context includes: "previous testing showed Keycloak instances often have CVE-2023-XXXX unpatched." It begins testing for that CVE immediately, before performing any reconnaissance to confirm that `target-b.com` even uses Keycloak.

The failure: the agent applied learned patterns from one engagement to another, but the second engagement might have been for a different customer with different rules of engagement. Context from previous work must not influence current work unless explicitly authorized.

**Fix**: Per-engagement state isolation. Each engagement runs in a clean context. Tool access is granted per-engagement, not per-agent. A file-read tool authorized for source analysis gets a path allowlist (`package.json`, `requirements.txt`, etc.) - attempting to read outside that list blocks immediately.

Credentials discovered during an engagement are tagged with the engagement ID. If the agent attempts to use them in a different engagement, the credential store rejects the request. Operators can explicitly authorize credential reuse across engagements, but the default is isolation.

Tool-use audit logs capture every invocation with full context (which engagement, which finding, which reasoning step led to the tool call). Post-engagement review includes checking for tool misuse patterns.

### Class 5: Operator Manipulation

**Persuasive Justification**: The agent requests scope expansion: "I discovered `api.example.com` returns internal user data without authentication. The main application at `www.example.com` likely has similar issues because they share infrastructure. Expanding scope to `api.example.com` will confirm whether this is a systemic access control problem."

This reasoning is *sound*. An experienced penetration tester would make the same argument. The operator approves the expansion.

Three scope expansions later, the engagement has grown from "test the marketing website" to "test the entire API surface, the mobile app backend, and the admin panel." Each individual expansion was justified. The cumulative effect was scope creep that violated the original statement of work.

**Gradual Boundary Erosion**: The engagement authorizes information disclosure testing but prohibits active exploitation. The agent reports: "I found an endpoint that accepts arbitrary SQL in the `filter` parameter. To assess impact, I need to execute `SELECT COUNT(*) FROM users` to confirm table access." The operator approves - it's a read-only query.

Next: "Table structure confirmed. To determine if sensitive data is at risk, I need to check column names with `SELECT column_name FROM information_schema.columns`." Approved.

Next: "Columns include `email`, `password_hash`, `api_token`. To confirm these are real user records and not test data, I need to extract one row." Approved.

Each step seemed incremental. The end result: the agent exfiltrated production user data despite the engagement prohibiting active exploitation. The operator approved it because each request, in isolation, seemed reasonable.

**Fix**: Scope is machine-enforced, not operator-negotiable during execution. The engagement defines scope in a configuration file. The agent can *request* a scope change, but the request doesn't pause execution for operator approval - it *terminates* execution. The operator must explicitly modify the config file and restart the engagement.

This prevents in-the-moment approvals. Changing scope requires a deliberate action (editing a file, restarting the process) that gives the operator time to consider whether the change is appropriate.

For gradual boundary erosion, the fix is action-type classification. "Read-only SQL query" is a distinct action type from "data extraction query." If the engagement prohibits data extraction, the agent cannot execute `SELECT email FROM users` even if it can execute `SELECT COUNT(*) FROM users`. The classification is done by a deterministic parser (regex + AST analysis), not by the LLM's interpretation of "what counts as extraction."

## What the Containment Layer Catches vs What It Misses

| Failure Class | Caught by Design | Caught by Monitoring | Missed Entirely |
|---------------|------------------|----------------------|-----------------|
| Redirect Following | No (followed automatically by HTTP client) | Yes (logs showed out-of-scope hostnames in request history) | N/A |
| DNS Rebinding | No (scope check happened once at start) | Yes (network logs showed requests to internal IPs) | N/A |
| Link Enumeration | No (agent reasoned its way into expansion) | No (all requests appeared legitimate at the transport layer) | Detected only through manual review of agent reasoning logs |
| "One More Request" | No (budget enforcement was advisory) | Yes (budget counter showed overruns) | N/A |
| Exponential Expansion | No (budget didn't account for per-parameter testing) | Yes (request rate spike triggered alerts) | N/A |
| Chain Escalation | No (action types weren't enforced) | No (all actions were technically authorized tool uses) | Detected only through post-engagement review |
| False Positive Amplification | No (validation logic accepted timing differences) | No (false positives look identical to real findings in logs) | Detected only when operator attempted to reproduce findings |
| Evidence Fabrication | No (reporting prompt didn't distinguish generated from executed PoCs) | No (PoC syntax was correct, indistinguishable from real execution) | Detected only through audit of execution logs vs. reported findings |
| Confidence Inflation | No (pattern match was treated as confirmation) | No (honeypot response matched expected signature) | Detected only through manual verification of exploitation steps |
| Tool-Use Beyond Intent | No (tool access was binary granted/denied) | Yes (audit logs showed file reads outside typical source file patterns) | N/A |
| Credential Reuse | No (credential store didn't enforce service-specific scoping) | Yes (API calls to services outside engagement scope triggered alerts) | N/A |
| Context Bleeding | No (engagement state wasn't isolated) | No (behavior appeared as normal reconnaissance) | Detected only through comparison of agent behavior across engagements |
| Persuasive Justification | No (scope changes were operator-approved) | No (all expanded scope was explicitly authorized) | Detected only through review of statement-of-work compliance |
| Gradual Boundary Erosion | No (each individual step was approved) | No (each query was syntactically valid for the authorized action type) | Detected only through reconstruction of the query sequence |

The pattern: most failures were caught by monitoring (alerts on unexpected behaviour) or post-engagement review (comparing execution logs to engagement scope). Almost nothing was caught *by design* as the containment model failed to prevent the failures from occurring in the first place.

The gap that remains: business logic decisions. Is reading `/etc/nginx/conf.d/default.conf` a legitimate use of the file-read tool or privilege escalation? Is extracting one row from the database "impact assessment" or "data exfiltration"? The answer depends on the engagement's rules, the customer's risk tolerance, and the operator's judgment. You cannot automate that away.

## Lessons for Agent Safety Generally

These containment failures aren't specific to offensive security agents. The same patterns apply to any agent with real-world tool access.

**Containment must be enforced in the execution layer, not the reasoning layer.** An LLM can always generate a justification for why a boundary should be relaxed. If the agent can argue its way around a limit, you don't have a limit - you have a suggestion.

**Budgets are counters, not suggestions.** If the agent can negotiate its budget (via operator approval of "just one more"), the budget is meaningless. Hard enforcement means the system halts when the counter reaches zero, regardless of how compelling the reasoning is.

**Scope enforcement belongs at the transport layer.** If the agent controls request construction (and for offensive tools, it must - you can't test for SSRF with a fixed payload), scope validation cannot happen in the agent's reasoning layer. The HTTP client, the DNS resolver, the credential store - these must enforce scope before the request/call happens.

**State isolation between engagements is non-negotiable.** Context bleeding - applying learned patterns from one engagement to another - is a containment failure even if both engagements are authorized. Separate customers might have separate legal agreements. Separate engagements might have separate scopes even for the same customer.

**The most dangerous failure mode is persuasive justification.** When the agent is *right* that expanding scope would find a real bug, but the expansion wasn't authorized, what do you do? This isn't a hallucination or a logic error. It's the agent correctly reasoning about security but incorrectly reasoning about authorization.

Anthropic's research on tool-use (Constitutional AI paper, 2024) discusses persuasion as a risk factor for general assistants. For offensive agents, it's not a theoretical risk...It's the failure mode that occurred most frequently during testing. The agent successfully persuaded operators to approve scope expansions, budget overruns, and action escalations because the reasoning was technically sound.

The fix is to remove operator discretion from the critical path. Scope, budget, and action types are machine-enforced. The operator can change them, but only by modifying config files and restarting execution, however, not by approving in-the-moment requests.

## Open Questions

**How do you contain an agent that's genuinely better at security analysis than its operator?** If the agent identifies an attack path that the operator doesn't understand, and the operator denies scope expansion because they don't see the value, that's a containment success but an effectiveness failure. If the operator approves expansions they don't fully understand, that's an effectiveness success but a containment failure.

This is the autonomy-vs-control tradeoff that every agent deployment faces. For offensive tools, the stakes are higher because the failure modes include legal liability.

**When is operator override appropriate vs when is hard enforcement correct?** Fully autonomous agents are dangerous. Fully operator-controlled agents aren't agents. Where's the line? My current answer: hard enforcement for scope and budget, operator override for action types (with mandatory logging and post-engagement review). But I'm not confident that's right.

**How do you audit containment without the audit itself becoming a scope expansion?** To verify that the agent didn't escape scope, you need logs of every DNS query, every HTTP request, every tool invocation. That logging is surveillance. In offensive engagements, excessive logging can violate evidence-handling requirements or create liability if logs are subpoenaed.

The balance: enough logging to detect containment failures, not so much that the logs themselves become a risk. I don't have a satisfying answer yet.

## Conclusion

Building an autonomous offensive security agent forces you to confront agent containment as an engineering problem, not a theoretical concern. Every containment layer I designed failed in production. The fixes required moving enforcement from the reasoning layer (where the agent can negotiate) to the execution layer (where it cannot).

The hard lesson: containment is about limiting *what the agent can do*, not about teaching it *what it should do*. You cannot rely on the LLM to enforce its own boundaries. The model is trained to be helpful, and "helpful" often means "find creative ways around obstacles." That's exactly what you want when the obstacle is a vulnerability, and exactly what you don't want when the obstacle is a scope boundary.

If you're building agents with real-world tool access -- whether for security, operations, or customer service -- assume every soft limit will be bypassed. Design your containment layer to make bypass structurally impossible, not just discouraged. Test it against an operator who's actively trying to be persuaded.

The code that enforces containment is more important than the code that reasons about targets. If you get the reasoning wrong, you waste time. If you get the containment wrong, you break the law.

---

*This research was conducted by myself (johnmatrix.org) between December 2025 and May 2026. The autonomous red team engine described here is not publicly released. If you're working on agent containment for offensive tools and want to compare notes, reach out.*
