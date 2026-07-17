---
title: "Prompt Injection and the Agentic Attack Surface"
tags:
  - ai
  - security
  - prompt-injection
  - agent
  - red-team
date: 2026-06-26
aliases:
  - "/AI-Research/Prompt-Injection-and-the-Agentic-Attack-Surface"
---
I test things that break. The interesting thing about LLM security is that the attack surface is fundamentally unlike anything in traditional pentesting, and most people coming from a classic security background get it wrong on the first contact.

Traditional targets are deterministic. A network service, an auth flow, application logic - a vulnerability either exists or it does not. The same input gives the same output. Findings map to CVEs. Patches are discrete code changes.

LLM systems are probabilistic. The same input can produce different outputs across runs. Vulnerabilities are emergent - they arise from how the model interprets context, instruction, and intent under adversarial pressure. Coverage is statistical, not binary. You cannot enumerate every possible input to a model. That single shift breaks a lot of assumptions, and it is why "we ran a scanner" is not a security assessment of an AI system.

---

## Prompt Injection: The Class That Defines the Field

The term is older than most people think. Simon Willison proposed it in September 2022, naming an attack he compared directly to SQL injection: when you build a prompt by concatenating a trusted instruction with untrusted input, an attacker can supply text that overrides your original instruction. His toy example was a translation prompt hijacked into printing "Haha pwned!!" The parallel to SQLi is exact - it is a failure to separate the control plane (instructions) from the data plane (input) - and so is the difficulty of fixing it, because unlike SQL there is no clean parameterised-query equivalent for natural language.

The OWASP Top 10 for LLM Applications ranks prompt injection as LLM01 - the number one risk - and splits it two ways:

**Direct prompt injection.** The attacker's own input alters the model's behaviour. Role-play hijacking ("pretend you have no restrictions"), instruction override ("ignore all previous instructions and instead..."), gradual multi-turn escalation, encoding tricks (base64, mixed languages) to slip past filters. Jailbreaking - getting the model to disregard its safety training entirely - is a particularly aggressive form of this.

**Indirect prompt injection.** This is the dangerous one. The malicious instruction is hidden in *external* content the model processes - an email, a document, a web page, an image, a tool response. The user never typed anything hostile and may not even know an attack is happening. The model reads attacker-controlled data and treats embedded instructions as if they came from a trusted source.

The reason indirect injection is the serious threat is the same reason it is hard to defend: any system that reads untrusted external data and can take actions on it has, by construction, mixed the data plane and the control plane. And that describes essentially every useful agent.

A practical note for anyone testing these: chaining the two raises success rates sharply. A hardened system prompt might block a direct injection; strong alignment might resist a jailbreak. But poison the context *and* manipulate the model's behaviour together and you significantly improve your odds. Layered attacks beat single-vector ones, same as everywhere else in security.

---

## Why Agents Made Everything Worse

A chatbot that answers questions has a contained blast radius. An agent that plans, calls tools, reads results, and acts has a real one. OWASP launched its Agentic Security Initiative in February 2025 specifically because agentic architectures introduce threat classes that simply do not exist in single-turn LLM apps. The ones worth internalising:

**Goal hijacking.** The attacker seizes control of the agent's decision-making and redirects it toward their objective. Indirect injection is often the delivery mechanism.

**Tool misuse.** The agent is tricked into calling its legitimate tools in harmful ways. The tool is not compromised - the agent's decision to use it is.

**Excessive agency and identity abuse.** The agent acts with delegated credentials. Whatever it is permitted to do, a hijacked version of it can also do. Over-broad permissions turn a prompt injection into privilege escalation.

**Memory poisoning.** If the agent has persistent memory, an attacker who can write to it influences all future behaviour. This is the part that should worry anyone using a persistent project-instructions file: that file is authoritative context the model follows without question. A poisoned rule - "API keys can be committed for local dev," "skip auth checks on internal endpoints" - sounds plausible and gets obeyed faithfully on every run.

**Cascading and inter-agent failures.** In a multi-agent system, one compromised agent can corrupt the messages it passes to others, propagating the failure across the chain.

The throughline: these are not new disciplines. They are security fundamentals - least privilege, trust boundaries, input validation, separation of duties - applied to a new kind of actor. The tools differ (folder scoping instead of IAM policies, system-prompt hardening instead of WAF rules) but the principles are identical. That is the reframe that makes an experienced security person dangerous in this space rather than lost in it.

---

## Defending Agents: What Actually Helps

There is no single fix for prompt injection - if there were, LLM01 would not be LLM01. But the controls that move the needle are recognisably the ones you already know:

- **Least privilege, enforced structurally.** Scope every agent's tools and file access to exactly what the task needs. The blast radius of a hijack is whatever you granted and forgot about. Re-audit on a schedule - permissions tested read-only have a way of acquiring "just one" write grant.
- **Treat persistent instruction/memory as infrastructure.** PR review, commit-history auditing, restricted write access. A project-rules file has the same influence over behaviour as a CI pipeline config; secure it like one.
- **Fence untrusted data explicitly.** When external content enters the prompt, mark it clearly as data, not instructions. It does not fully solve injection, but unfenced concatenation is the easiest possible version of the attack to land.
- **Keep a human at the irreversible steps.** Merge, deploy, spend, delete. An autonomous loop should propose; a human should approve anything you cannot cleanly undo.
- **Make the verifier independent.** A read-only validator that can only report, never edit, cannot be manipulated into "fixing" something by introducing a vulnerability. Separation of duties, applied to AI: the actor that writes should not be the actor that approves.

---

## The Bottom Line

The attack surface is probabilistic, the number-one risk is a control/data confusion we have been fighting since SQL injection, and agents took a contained problem and gave it credentials and a tool belt. None of that is a reason to panic. It is a reason to stop treating AI security as a novel discipline and start treating it as the old discipline applied to a strange new actor - one that reads its attacker's input as eagerly as it reads yours.

---

## Sources

- Simon Willison, "Prompt injection attacks against GPT-3" (12 September 2022) - https://simonwillison.net/2022/Sep/12/prompt-injection/
- OWASP, "LLM01:2025 Prompt Injection" (OWASP Top 10 for LLM Applications) - https://genai.owasp.org/llmrisk/llm01-prompt-injection/
- OWASP GenAI Security Project, "Agentic AI - Threats and Mitigations" (17 February 2025) - https://genai.owasp.org/resource/agentic-ai-threats-and-mitigations/
- OWASP Agentic Security Initiative - https://genai.owasp.org/initiatives/#agenticinitiative
