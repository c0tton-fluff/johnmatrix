---
title: "Context Engineering: The Skill Nobody Named in 2024"
description: "The discipline of managing what the model sees, remembers, and forgets."
tags:
  - ai
  - agent
  - context-engineering
  - llm
date: 2026-06-26
aliases:
  - "/AI-Research/Context-Engineering"
---
Prompt engineering is being quietly demoted. The people building real agentic systems realised the prompt is the small part. The big part is everything *around* the model: the briefing docs, the skills, the connectors, the retrieval, the memory, and the way the agent finds exactly what it needs at each step without drowning in what it does not. Prompts still matter. They just aren't the thing that decides whether your agent holds up over a long task.

That discipline now has a name. In June 2025, Andrej Karpathy publicly backed "context engineering" over "prompt engineering." Shopify's CEO Tobi Lutke defined it crisply: the art of providing all the context for the task to be plausibly solvable by the model. By late 2025 Anthropic's own engineering team had written it up as a first-class discipline. The term went from nonexistent to industry-standard in about a year.

What it actually means -- and why a million-token window did not make the problem go away.

---

## What It Is

Anthropic frames context engineering as the set of strategies for curating and maintaining the optimal set of tokens during inference - finding the smallest possible set of high-signal tokens that maximise the chance of the outcome you want. The mental model is that context is a **finite resource**, not a free dumping ground. Every token you add spends part of a fixed attention budget.

That reframing is the whole point. Prompt engineering treats the question as "how do I phrase this." Context engineering treats it as "what information environment does the model need to be set up for success" - and crucially, what to leave *out*.

---

## Why Now: Three Forces Converged

**Agents changed the game.** A single-turn chatbot can get by on a good prompt. An agent that plans, calls tools, reads results, and acts across many steps needs carefully engineered context at *every* step. The model deciding which tool to call needs different context than the model evaluating whether that call succeeded. There is no single prompt that covers a multi-step trajectory.

**Bigger windows did not solve it.** Million-token context windows exist now. The problem did not go away - it got more expensive. More room means more opportunity to fill the window with the wrong things, and the model's attention gets stretched thin as the token count climbs.

**Context rot turned out to be real and measurable.** In July 2025 the team at Chroma ran a study across 18 frontier models - Claude, GPT, Gemini, Qwen - and found that performance consistently degrades as input length grows, *even on simple tasks like retrieval or copying text*. Models do not process context uniformly. One striking finding: in conversational question-answering, models did significantly better on focused prompts of a few hundred tokens than on full prompts of over a hundred thousand. The relevant information was present in both. Presentation, not mere presence, was what mattered.

This is the same family as the older "Lost in the Middle" result (Liu et al., 2023), which showed models use information best when it sits at the beginning or end of the input and noticeably worse when it is buried in the middle. A long context is not perfect memory. It is the technical reason an AI sometimes "forgets" something you clearly told it.

---

## The Failure Mode: Context Rot in a Running Agent

The reason this matters for agents specifically: as an agent works through a multi-step task, the context window accumulates tool outputs, intermediate results, and conversation history. Without active management, it degrades. Anthropic's term for the fix is that context must be **cyclically refined** - the curation decision happens every single time you decide what to pass to the model, not once at the start.

If you have used a long coding session and watched the model start contradicting decisions it made earlier, you have watched context rot in real time. The window did not run out. The signal-to-noise ratio collapsed.

---

## What the Discipline Actually Involves

- **Selection** - deciding what to include and what to exclude, treating the window as a budget to spend deliberately
- **Structure** - where information sits in the context (beginning and end beat the middle), and how it is formatted, because structure affects recall
- **Retrieval** - pulling the right documents at the right step instead of front-loading everything
- **Memory architecture** - what persists across steps and sessions, and what gets summarised or dropped
- **Refinement** - actively pruning accumulated cruft so a long-running agent does not slowly poison its own window

The common thread: a frontier model with a poorly engineered context window will lose to a smaller model with a clean, well-curated one. The model is rarely the bottleneck. The information environment is.

Lance Martin's four-pillar taxonomy -- Write, Select, Compress, Isolate -- has become the field's shared vocabulary, and it maps onto the list above almost 1:1. If you read anyone else on this topic, that is the frame they are using.

---

## 2026: Three Things That Changed

The discipline moved fast in the first half of 2026. Three developments worth knowing:

**ACE -- context as a playbook, not a blob.** The Agentic Context Engineering (ACE) paper proposed treating context as an evolving, itemised playbook rather than a rewritten blob. Instead of dumping the whole history into the window every turn, you maintain a structured set of claims and instructions that the agent updates in place. It directly attacks the "context collapse" failure mode -- the window stops being a growing transcript and becomes a living document.

**Automatic compaction shipped.** Anthropic productised context compaction in Claude Opus 4.6 -- the model itself summarises and compresses older context when the window fills, rather than the developer hand-managing it. It removes the most tedious part of the discipline for the common case, and it pushes the hard part (what to keep, what to compress) into the model's own judgment, which is not always right.

**Cache-aware layout is worth 41-80%.** A February 2026 study ("Don't Break the Cache") measured agentic workloads and found that cache-aware context layout -- keeping stable prefixes intact so the prompt cache hits -- cut API costs 41-80% with no model change. Where you put the volatile tokens is not a cosmetic choice. It is the single biggest cost lever in a running agent.

---

## The Practical Takeaways

If you take three things from this:

1. **More context is not better context.** Adding tokens spends attention budget. Add only what raises the chance of the outcome you want.
2. **Position matters.** Put the load-bearing information at the start or end, not buried in the middle of a wall of text.
3. **For anything multi-step, manage the window actively.** Summarise, prune, and re-retrieve. A context window left to accumulate will rot.

The skill nobody named in 2024 is the one that separates a demo from a system that holds up over a long task. It is worth learning on purpose.

---

## Sources

- Anthropic, "Effective Context Engineering for AI Agents" (29 September 2025) - https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- Simon Willison, "Context engineering" (27 June 2025), summarising the Karpathy and Lutke framing - https://simonwillison.net/2025/Jun/27/context-engineering/
- Hong, Troynikov, Huber (Chroma), "Context Rot: How Increasing Input Tokens Impacts LLM Performance" (14 July 2025) - https://www.trychroma.com/research/context-rot
- Liu et al., "Lost in the Middle: How Language Models Use Long Contexts" (2023) - https://arxiv.org/abs/2307.03172
