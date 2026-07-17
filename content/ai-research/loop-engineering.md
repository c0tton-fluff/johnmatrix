---
title: "Loop Engineering: Replacing Yourself as the Prompter (and the Security Tax Nobody Budgets For)"
tags:
  - ai
  - agent
  - automation
  - security
  - claude-code
date: 2026-06-26
aliases:
  - "/AI-Research/Loop-Engineering"
---
For two years the workflow was: write a prompt, share context, read the output, write the next prompt. The agent was a tool you held the entire time. That phase is ending.

A loop is a small system that, on its own, finds the work, hands it to the agent, checks the result, records what happened, and decides the next move. You design that system once. It prompts the agent from then on. The leverage point moved from typing prompts to designing the loop that prompts.

I build offensive tooling for a living, so I came at this from a specific angle: an unattended loop is also an unattended attack surface. Most write-ups skip that part. This one does not. But first, the honest version of the technique - including when *not* to use it.

---

## Most Developers Do Not Need a Loop Yet

A loop earns its setup cost only under four conditions. Miss one and it costs more than it returns.

| Condition | Why it matters |
|---|---|
| The task repeats | A loop amortises setup across many runs. A one-off is just a good prompt you wrote once. |
| Verification is automated | Something must be able to *fail* bad work without you in the room - tests, type checker, linter, build. No gate means you are back to reading every diff. |
| The token budget absorbs waste | Loops re-read, retry, and explore. They burn tokens whether or not anything ships. Obvious to people with free tokens, reckless on a metered plan. |
| The agent has real tools | Logs, a repro environment, the ability to run its own code and see what breaks. Without that, the loop iterates blind. |

A 30-second per-task check before you build anything: does this happen at least weekly, can an objective gate reject bad output, can the agent run the code it changes, is there a hard stop (token budget, iteration cap, or time limit), and does a human review before anything irreversible (merge, deploy, dependency change)? Miss a box, keep it a manual prompt.

Good first loops are boring on purpose: CI failure triage, dependency-bump PRs, lint-and-fix passes, flaky-test reproduction. Bad first loops are exactly the exciting ones: architecture rewrites, auth or payments code, production deploys, anything where "done" is a judgment call.

---

## The Five Building Blocks

**Automations - the heartbeat.** Something fires the loop on a schedule or event. In Claude Code that is a scheduled run or a recurring command; the useful nuance is the difference between "run every 30 minutes regardless" and "keep going until a condition I wrote is actually true, checked by a separate model." That second pattern - a different model verifying the stop condition - is the whole game, and we will come back to why.

**Worktrees - parallel without chaos.** More than one agent means file collisions, the same way two engineers committing to the same lines without talking collide. A git worktree gives each agent its own working directory on its own branch with shared history, so one agent's edits literally cannot touch another's checkout. The catch: worktrees remove the *mechanical* collision, but your review bandwidth still decides how many parallel agents you can actually run. The tool is not the ceiling. You are.

**Skills - write project knowledge once, read it every run.** A loop without persistent project context re-derives everything from zero every cycle. With a skill file holding conventions, build steps, and "we do not do it this way because of that one incident," intent compounds - written once on the outside, read by every run.

**Connectors - touch the real tools.** A loop that only sees the filesystem is a tiny loop. Via MCP (the Model Context Protocol), the agent can read the issue tracker, query a database, hit a staging API, post to Slack. This is the difference between an agent that says "here is the fix" and a loop that opens the PR, links the ticket, and pings the channel once CI is green.

**Sub-agents - keep the maker away from the checker.** The single most useful structural pattern: split the agent that writes from the agent that checks. The model that wrote the code is far too generous grading its own homework. A second agent, with different instructions and sometimes a different model, catches what the first one talked itself into.

That maker-vs-checker split is not new vocabulary, by the way. It is the **evaluator-optimizer** pattern Anthropic documented in December 2024 - one model generates, another critiques, repeat. The term went viral in 2026; the mechanism was written down eighteen months earlier.

---

## The State File Is the Spine

This sounds too dumb to matter and is actually load-bearing. A loop needs state that lives *outside* the single conversation - a markdown file, an issues board, a JSON record - holding what is done and what is next.

Agents have short memory by default. The rule: the agent forgets, the repo does not. No persistent state and every run restarts from zero. With state, every run resumes. Pair it with a standing high-level spec the loop rereads each run, and you get the full picture: the state file tells the agent where it is, the spec tells it where to go.

---

## The Minimum Viable Loop

Passed the four-condition test? Build the smallest thing that works before anything fancy:

1. One automation - a scheduled run with a clear stop condition
2. One skill - the context the agent would otherwise re-derive every run
3. One state file - so tomorrow resumes instead of restarting
4. One gate - the test, type check, or build that fails bad work automatically

Order matters: get one manual run reliable, turn it into a skill, wrap it in a loop, then schedule it. Skipping ahead is how loops fail in production.

The metric that actually matters is **cost per accepted change** - not tokens spent, tasks attempted, or loops scheduled. If your accepted-change rate drops below half, you are doing the review work the loop was supposed to save, and the loop is losing.

---

## The Ralph Wiggum Loop: How Loops Fail Quietly

Geoffrey Huntley named and documented this. In its simplest form a loop is literally a Bash loop feeding the same prompt to a coding agent over and over: `while :; do cat PROMPT.md | claude-code; done`. It works far better than it has any right to - but it also exposes the failure mode. An agent meant to emit a "done" signal only when finished emits it early, and the loop exits on a half-finished job. Without a hard gate, loops fail quietly and keep spending.

It happens when there is no real verifier (just a second agent asked to "review" - two optimists agreeing), when "done" is defined by the agent's judgment instead of a test or build, or when there are no hard stops so the loop runs until something external kills it.

The fix is the objective gate: something that can genuinely *fail* the work - a test that passes or fails, a build that compiles or does not, a linter returning zero or non-zero. Not a verifier with an opinion.

---

## The Security Tax

Here is the part I care about most, and the part that gets cut from every productivity thread. The moment a loop runs while you are not watching, your threat model changes. This maps cleanly onto the things people who break agentic systems already exploit.

**Generated code shipping unreviewed.** The loop opens PRs faster than humans read them. If your gate does not include security checks - SAST, dependency audit, secret scanning - then insecure code does not just slip through, it merges *automatically*. The gate is your only control, and a gate that checks "does it compile" while ignoring "does it ship a hardcoded credential" is a false sense of safety.

**Skills and connectors as injection vectors.** Auto-installing a community skill inherits every instruction hidden in its description. This is indirect prompt injection with a supply-chain delivery mechanism: the malicious instruction does not come from you, it comes from a resource the agent reads and trusts. Audit skill and connector sources before you wire them into an unattended loop. A loop that reads external data and takes actions is exactly the configuration where indirect injection does the most damage.

**Credentials in logs.** Verbose debug logging during long runs scatters secrets across logs no one is monitoring. Disable it in production loops and sanitise what remains.

**Permission scope creep.** A loop you tested read-only gets "just one" write permission for convenience, and then never gets re-audited. The principle is least privilege applied to a non-human actor: scope the agent's tools to exactly what the task needs, and re-audit on a schedule. The blast radius of a hijacked loop is whatever you granted it and forgot about.

The pattern underneath all four is the same one we apply to service accounts and CI pipelines: an autonomous actor with credentials and the ability to take actions needs the same security discipline as any other piece of infrastructure - because that is what it is.

---

## The Failure Modes, in One Table

| Failure mode | Mechanism | Mitigation |
|---|---|---|
| Goal drift | Each summarisation step is lossy; "do not do X" constraints quietly vanish over a long run | A standing spec the loop rereads every run |
| Self-preferential bias | The maker is too generous grading its own work | A separate verifier with no exposure to the maker's reasoning |
| Agentic laziness | The loop declares "done enough" at partial completion | An objective stop condition checked by a fresh model |
| Comprehension debt | The faster the loop ships code you did not write, the larger the gap between what the repo contains and what you understand | Read the diffs; block the loop from judgment-call work |

That last one is the quiet killer and it gets *worse* as the loop gets better. The bill that hurts is not the token bill - it is the day you have to debug a system nobody on the team has actually read.

---

## The Leverage Moved - Your Job Did Too

For two years the leverage was at the prompt. That phase is ending, not because the work got easier but because the leverage point moved one floor up: to the system that decides what the agents work on, when, with what gate, and what state survives between runs.

The honest version stays honest: most developers do not need a loop yet. But if you pass the test, build small - one automation, one skill, one state file, one gate - and treat the unattended loop as the attack surface it is.

Build the loop. Stay the engineer.

---

## Sources

- Anthropic, "Building Effective Agents" (evaluator-optimizer pattern, 19 December 2024) - https://www.anthropic.com/research/building-effective-agents
- Geoffrey Huntley, "Ralph Wiggum as a software engineer" (14 July 2025) - https://ghuntley.com/ralph/
- OWASP GenAI Security Project, "Agentic AI - Threats and Mitigations" (17 February 2025) - https://genai.owasp.org/resource/agentic-ai-threats-and-mitigations/
- Anthropic, Model Context Protocol - https://modelcontextprotocol.io/
- Addy Osmani has written extensively on the loop-engineering framing; search his essays for the longer treatment.
