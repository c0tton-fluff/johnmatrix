---
title: "Offensive AI in Bug Bounty: The Real State of Play"
tags:
  - ai
  - security
  - bug-bounty
  - research
date: 2026-05-15
aliases:
  - "/AI-Research/Offensive-AI-in-Bug-Bounty"
---
The bug bounty ecosystem is splitting into two realities. In one, AI-generated garbage reports are drowning triage teams and killing open-source programs. In the other, skilled researchers are quietly using AI to find vulnerabilities that scanners and fuzzers never could. Both are happening simultaneously, and the gap between the two is widening fast.

This is an analysis of where offensive AI actually stands in mid-2026 -- not the marketing version, not the doom version. The evidence-based version.

---

## The Two Faces of AI in Bug Bounty

### The Noise: AI Slop is Real and Getting Worse

In January 2026, Daniel Stenberg shut down curl's HackerOne bug bounty program. Not because of budget. Not because of staffing. Because AI-generated fake vulnerability reports made the program unsustainable.

The numbers tell the story:

| Metric | Pre-AI (2022) | Post-AI (2024-2026) |
|--------|--------------|---------------------|
| Average triage time per report | 4-6 hours | 8-14 hours |
| Invalid/duplicate report rate | 30-35% | 50-65% (estimated) |
| Reports with zero reproduction steps | Low | Sharply increasing |
| Validity rate (curl specifically) | ~40% | ~5% |

Stenberg's security team -- seven people -- was processing reports that cited imaginary functions, referenced fake commit hashes, and described vulnerabilities that couldn't exist. Twenty submissions in the first weeks of January 2026. Zero real vulnerabilities.

> "The main goal with shutting down the bounty is to remove the incentive for people to submit crap and non-well researched reports to us. AI generated or not."

Curl wasn't alone. The Python Software Foundation reported urllib3 receiving baseless reports about SSLv2 -- in code that explicitly *disables* it. Open Collective's inbox filled with what their engineers called "AI garbage." HackerOne confirmed seeing increased volume in AI-helped reports across the entire industry.

The playbook is simple and cynical: prompt an LLM to generate a vulnerability report, copy-paste it into HackerOne, hope the target pays rather than investigates. One actor linked to the @evilginx account was submitting identical patterns across multiple organizations -- and some paid out.

Casey Ellis, founder of Bugcrowd, quantified it: 500 additional submissions per week across their platform. TechCrunch reported HackerOne launching "Hai Triage" -- AI fighting AI -- to filter the noise before human analysts see it.

### The Signal: Skilled Researchers Are Building Something Different

While the slop floods in, a different community is emerging. These aren't script kiddies with ChatGPT. They're experienced researchers integrating AI into workflows that produce real, validated findings.

The difference isn't the tool. It's the operator.

A Discord message captured it: *"ngl claude code found an IDOR nuclei missed completely."* No context. No follow-up. The person moved on. But it points to something real -- AI models that understand code context are finding logic vulnerabilities that pattern-matching tools can't reach.

Here's what the effective workflow actually looks like:

```
Human identifies target + attack surface
    |
AI reads source code, builds comprehension model
    |
Human directs focus based on signals
    |
AI generates hypotheses about vulnerability classes
    |
Human validates, tests, chains findings
    |
AI assists with report writing and evidence
```

The AI doesn't replace the researcher. It accelerates the parts that were bottlenecks: reading 50,000 lines of JavaScript to understand data flow, mapping authentication boundaries across microservices, identifying where input validation is inconsistent.

---

## The Frontier: What Actually Works in 2026

### Google's Big Sleep -- First AI-Discovered Real-World Zero-Day

In October 2024, Google's Project Zero and DeepMind collaboration (Big Sleep, evolved from Project Naptime) found an exploitable stack buffer underflow in SQLite. This is the milestone moment:

- First public AI-discovered zero-day in widely-used software
- Found through variant analysis of a recent commit
- Reported and fixed the same day
- The bug existed in code that had been extensively fuzzed

The architecture matters more than the result. Naptime gave the LLM specialized tools:

| Tool | Purpose |
|------|---------|
| Code Browser | Navigate target codebase |
| Debugger | Set breakpoints, observe runtime behavior |
| Python sandbox | Generate precise inputs |
| Reporter | Structured progress tracking |
| Controller | Verify success conditions (crashes, ASan hits) |

This isn't "ask GPT to find bugs." It's a purpose-built research environment where the AI operates like a human researcher -- iteratively forming and testing hypotheses against real execution.

The key insight from the Project Zero team: the SQLite bug wasn't found by fuzzing because the relevant harness didn't include the `generate_series` extension. Big Sleep found it through reasoning about commit changes and their implications. **AI found what fuzzing missed because it could reason about intent, not just inputs.**

The team's own assessment remains measured: "at present, it's likely that a target-specific fuzzer would be at least as effective." But they're building toward something fuzzers fundamentally can't do -- understanding *why* code is wrong, not just that it crashes.

### DARPA AIxCC -- Autonomous Cyber Reasoning at Scale

DARPA's AI Cyber Challenge at DEF CON 33 (August 2025) proved this isn't theoretical:

- **77% detection rate** on seeded vulnerabilities (54 of 70 found)
- **18 previously unknown real-world zero-days** discovered
- **11 zero-days patched during the competition**
- **Average time to patch: 45 minutes**
- **Estimated cost per fix: \$152**

Team Atlanta won \$4M. Trail of Bits took \$3M. Theori got \$1.5M. The tested targets weren't toys -- they were Linux kernel, Jenkins, Nginx, SQLite, and Apache Tika.

Four of seven finalist systems have been open-sourced. These aren't academic curiosities anymore. They're production-grade autonomous security systems.

### SHERPA -- LLM-Guided Fuzzing That Actually Ships

The AIxCC spawned SHERPA (Security Harness Engineering for Robust Program Analysis), a system that uses LLMs to generate fuzz harnesses targeting attacker-controlled entry points:

- 27 crash-inducing inputs auto-produced across OSS-Fuzz projects
- 18 validated bugs after human triage (~67% precision)
- 100+ false positive crashes auto-filtered by an LLM crash-analysis agent

The shift: instead of fuzzing everything, the AI identifies *where attackers actually hit production systems* and generates harnesses specifically for those paths. It moves fuzzing up the stack to where it matters.

### MCP-Based Pentest Frameworks

The Model Context Protocol has become the integration layer for offensive tooling. PentestMCP exposes 43 security tools behind scope-safe architecture:

- 20 security scanners covering OWASP Top 10
- Seven-phase PTES engagement lifecycle
- Automatic MITRE ATT&CK correlation (160 mapping rules)
- Scope enforcement: 200/200 accuracy across 8 attack categories

The constrained system achieves methodology adherence of 0.971 versus 0.605 for unconstrained LLM baselines. Structure matters. Guardrails produce better results than freedom.

---

## The Practitioner Layer: How Hunters Actually Use AI

### The RedAmon Framework

An open-source agentic red team framework chains:
1. Six sequential scanning phases for full attack surface mapping
2. LangGraph-based autonomous agent with MCP tool selection
3. Neo4j knowledge graph (17 node types, 20+ relationship types)
4. Real-time steering via chat

It's the first open framework that captures the *thinking* of offensive security -- not just the tools. The agent reasons about the graph, transitions through exploitation phases, and maintains state across a campaign.

### The Claude Code Bug Bounty Skill

Radioactivetobi's open-source Claude Code skill demonstrates the methodology integration:
- Recon, IDOR, XSS, SSRF, OAuth, GraphQL, LLM injection testing
- Four-gate validation checklist before any finding is reported
- Submission-ready report generation

The key design choice: Claude doesn't just run commands. It *understands the methodology* -- why you test in this order, what signals mean, when to pivot.

### What the Top Hunters on Huntr Are Doing

The AI/ML vulnerability platform Huntr profiles tell the real story:

**Tai (taiphung217)** -- quarterly #1 on the leaderboard in 5 months:
- Splits workflow between manual deep-dive and automated tools (Joern, AFL++)
- Studies existing 1-day reports to find variant vulnerabilities
- Escalated a path traversal to arbitrary file write to RCE over 5 days
- Targets: MLflow, Transformers, Ollama, PyTorch, TensorFlow

**Lyutoon (Tong Liu)** -- PhD researcher, Black Hat speaker:
- Coined "LLM4Shell" -- RCE vulnerabilities in LLM integration frameworks
- Found hundreds of bugs in LangChain, LlamaIndex, Ollama
- Combines fuzzing (craft malformed model files) with manual code audit
- Published at USENIX Security, CCS, Black Hat Asia

**Wlayzz** -- YesWeHack leaderboard, pentest/red team at Thales:
- "We have seen hack bots having good performance on rankings"
- Advocates learning AI tools to maintain competitive edge
- Combines day-job pentesting knowledge with bounty hunting

The pattern: AI doesn't replace skill. It amplifies it. The hunters using AI effectively are already experts who use it to extend their reach.

### Muhammad Arslan Akhtar -- The AI Security Engine Approach

A \$200K bug bounty career turned into a "Cognitive Security Orchestrator":
- DeepSeek-R1 for Chain-of-Thought reasoning on auth handshakes
- Llama-3.3-70B (abliterated) for overall strategy
- Qwen2.5-Coder-32B for code analysis and exploit generation
- Qwen3-VL-8B for visual UI analysis of login flows

His insight: "Legacy tools use regular expressions to find patterns. If the pattern isn't in their database, they are blind." The AI performs Chain-of-Thought analysis on authentication state machines -- spotting the exact moment an unverified identity gets promoted to trusted.

Running locally-hosted uncensored models is the differentiator. Commercial APIs refuse to discuss exploitation. Local models reason freely about attack paths.

---

## The Economics

The economic shift is measurable:

| Approach | Cost per Vuln Found | Time | Quality |
|----------|-------------------|------|---------|
| Traditional scanner | Low | Minutes | High FP rate |
| Human-only pentest | \$2K-10K+ | Days-weeks | High quality, limited coverage |
| AI slop submission | ~\$0 | Seconds | Zero real bugs |
| AI-augmented expert | Lower than pure human | Hours | Expert quality, broader coverage |
| Autonomous (AIxCC-class) | ~\$152/fix | 45 min | 77% detection, validated |

The last row is where things get interesting. \$152 per fix with 45-minute turnaround changes the math entirely. Not today at production scale. But the trajectory is clear.

---

## Where This Is Going

### The Near-Term (2026-2027)

1. **Triage AI vs. Submission AI** -- platforms will deploy AI that filters AI-generated reports. The arms race begins in earnest. HackerOne's Hai Triage is the first volley.

2. **Proof-of-concept requirements will tighten** -- video evidence, reproducible test cases, identity verification. The bar for submission goes up. This filters noise and rewards skill.

3. **MCP becomes the standard integration layer** -- offensive tools expose capabilities through structured protocols. The era of shell-script-chaining ends. Agents orchestrate tools through typed interfaces.

4. **Variant analysis becomes AI's killer app** -- not finding novel vulnerability classes, but finding every instance once one is known. This is where Big Sleep excels and what humans find tedious.

### The Medium-Term (2027-2029)

5. **Autonomous bug bounty hunters become viable** -- not for creative exploitation, but for systematic coverage of known vulnerability patterns across large attack surfaces.

6. **The skill premium inverts** -- knowing how to configure and direct AI becomes more valuable than manually testing individual endpoints. The researcher becomes the operator.

7. **Business logic remains human territory** -- "Is this a valid state transition?" requires understanding the business, not just the code. Multi-step chains, race conditions, and context-dependent logic stay in human hands.

### The Long-Term

8. **AI finds what humans didn't know to look for** -- novel vulnerability classes, not just variants. This is the Big Sleep dream. An AI that reads a codebase and says "this architectural pattern is unsafe in ways nobody has documented yet."

We're not there. But the distance between "find variants of known bugs" and "reason about novel security properties" is shrinking with every model generation.

---

## The Honest Assessment

AI in offensive security is simultaneously:
- **Overhyped** by vendors selling "AI-powered scanning" that's just pattern matching with a chat interface
- **Underhyped** by practitioners who haven't seen what purpose-built research frameworks can do
- **Misused** by opportunists flooding platforms with generated garbage
- **Well-used** by a small community building tools that genuinely extend human capability

The dividing line isn't "AI or no AI." It's **comprehension versus generation**. The slop generators treat AI as a content factory. The effective practitioners treat it as a reasoning partner that understands code.

If you're a researcher: the question isn't whether to use AI. It's whether you're using it like a copy machine or like a research assistant. The former gets you banned. The latter gets you findings that scanners miss.

If you're running a program: the noise is real and getting worse. Proof-of-concept requirements, reputation systems, and AI-powered triage are your defense. But don't mistake the noise for the signal. The best hunters are getting better, not worse, because of these tools.

The future belongs to the operators who understand both the security and the AI -- who can direct a model's reasoning toward the right questions, validate its hypotheses against real systems, and chain its outputs into exploitable paths.

The scanner era produced a generation of researchers who could drive tools but not think. The AI era will produce a generation who can direct intelligence but not validate it. The winners will be those who do both.

---

## References

- [Project Naptime](https://projectzero.google/2024/06/project-naptime.html) -- Google Project Zero, June 2024
- [From Naptime to Big Sleep](https://projectzero.google/2024/10/from-naptime-to-big-sleep.html) -- First AI-discovered SQLite zero-day, October 2024
- [DARPA AIxCC at DEF CON 33](https://aicyberchallenge.com/) -- Team Atlanta wins \$4M, August 2025
- [Curl ending bug bounty program](https://www.bleepingcomputer.com/news/security/curl-ending-bug-bounty-program-after-flood-of-ai-slop-reports/) -- BleepingComputer, January 2026
- [AI slop and bug bounties](https://techcrunch.com/2025/07/24/ai-slop-and-fake-reports-are-exhausting-some-security-bug-bounties) -- TechCrunch, July 2025
- [SHERPA -- LLM-powered fuzzing](https://github.com/AIxCyberChallenge/sherpa) -- AIxCC project
- [PentestMCP](https://github.com/Codexhack286/MCP_server_Pentest) -- MCP-based pentest server
- [RedAmon](https://github.com/l0cs/redamon) -- Agentic red team framework
- [Claude Code Bug Bounty Skill](https://github.com/radioactivetobi/claude-bug-bounty) -- radioactivetobi
- [YesWeHack Report 2026](https://www.yeswehack.com/community/use-ai-wlayzz-future-proofing) -- Wlayzz on AI in bounty
- [How Bug Bounty Hunters Use Claude Code](https://medium.com/bugbountywriteup/how-bug-bounty-hunters-are-using-claude-code-a94d6ceb056a) -- Medium, March 2026
- [Huntr Spotlight: taiphung217](https://blog.huntr.com/spotlight-taiphung217-five-month-huntr-leaderboard-climb) -- Huntr Blog, June 2025
- [Huntr Spotlight: Lyutoon](https://blog.huntr.com/spotlight-on-lyutoon-from-black-hat-to-bug-bounties) -- Huntr Blog, May 2025
