---
title: "20 Concepts That Explain Modern AI"
tags:
  - ai
  - llm
  - fundamentals
  - machine-learning
date: 2026-06-26
aliases:
  - "/AI-Research/20-Concepts-That-Explain-Modern-AI"
---
Most people who use AI every day cannot explain what is happening when they hit enter...A lot of senior engineers in Anthropic/OpenAI likely neither! That is fine for using it and a liability for building on it or securing it. These are the twenty concepts that, once they click, turn the whole field from magic into machinery. No maths required, purely the mental models.

---

## Part 1: The Foundation

**1. Neural networks.** A pipeline of layers. Data enters an `input layer`, passes through `hidden layers`, exits as a `prediction. Each connection has a **weight** - a number controlling how much one neuron influences the next. Training means adjusting billions of these weights until the output is accurate. Simple idea, insane at scale.

**2. Tokenisation.** Before a model reads text, it breaks it into tokens - often sub-word pieces, not whole words. `"playing"` becomes `"play"` + `"ing."` A fixed vocabulary of whole words would be impossibly large and would choke on anything new, so tokens are reusable building blocks the model can recombine. Rough rule to use... one token is about 0.75 words.

**3. Embeddings.** Each token becomes a **vector** - a list of numbers representing meaning. Think of it as a map where "doctor" and "nurse" sit close together and "doctor" and "pizza" sit far apart. The model does not understand words the way we do; it understands distance and direction. This is what powers semantic search, recommendations, and retrieval systems.

**4. Attention.** "Apple" means different things in "I ate an apple" and "I bought Apple stock." Embeddings alone cannot disambiguate that. `Attention` lets every word look at every other word and decide what matters. In "she bought shares in Apple," the word "Apple" pays attention to "shares" and "bought" and resolves to the company. This is the idea that unlocked modern AI few years ago.

**5. Transformers.** The architecture behind almost every modern model, introduced in the 2017 paper "Attention Is All You Need." The breakthrough was processing all the text in parallel using attention instead of reading one word at a time. Early layers handle grammar and structure, middle layers handle relationships, deep layers handle complex reasoning. GPT, Claude, Gemini, Llama are all transformers. Understand this one architecture and you understand the shape of the whole field.

---

## Part 2: How LLMs Work

**6. Large language models.** A transformer trained on an enormous amount of text with one task: predict the next token. That sounds too simple to be powerful, but repeat it across trillions of examples and grammar, reasoning, translation, and coding all *emerge*. Nobody programmed those abilities in... they simply fell out of next-token prediction at scale.

**7. Context window.** The maximum number of tokens a model can "see" at once, like your message, its reply, and the conversation so far. Windows have grown enormously, from a few thousand tokens in early models to hundreds of thousands and, in some models, over a million. However... a bigger window is not perfect memory. Research ("Lost in the Middle," Liu et al. 2023) shows models use information best at the beginning and end of the context and worse when it is buried in the middle. This is why an AI sometimes "forgets" something you clearly said. Clearing the context around 30% (especially with 1M context models) is a huge help and time saver.

**8. Temperature.** The creativity dial. When the model picks the next token it does not always choose the single most likely one. Temperature near zero makes it pick the safest, most predictable token every time, which is good for code, facts, and summaries. Higher temperature introduces variety, and this is good for brainstorming and creative writing. Too high and it becomes incoherent and hallucinations set in.

**9. Hallucination.** The model predicts plausible tokens, it does not look up truth. If a false statement looks like something that *should* come next based on training patterns, the model produces it with confidence. It will invent citations, APIs, and historical "facts." This is not a bug you can fully patch, as much as it is a direct consequence of how the model works. Never trust factual output without verifying it.

**10. Prompt engineering.** How you ask changes the result. "Explain APIs" gets a vague answer; "Explain how REST APIs handle authentication, with a code example, for a junior developer" gets something useful. Give context, assign a role, show examples, be specific about the output format, break complex asks into steps. It is not a hack, but simply the primary interface to the model. (Though for multi-step agents, this has been largely absorbed into the broader discipline of context engineering. This is above the content of this page. One day I will write more on that...)

---

## Part 3: How Models Become Useful

**11. Transfer learning.** Training from scratch is enormously expensive. Transfer learning means taking a model already trained on a huge general task and adapting it for something specific. It comes down to building on top instead of starting from zero. Almost every AI product works this way: a foundation model, then adaptation. Nobody trains from scratch anymore unless they are a frontier lab.

**12. Fine-tuning.** The how of transfer learning. Take a pretrained model and continue training it on a smaller, focused dataset  like clinical notes, legal contracts, a specific codebase. The model already speaks the language, you are teaching it your domain. The cost is that you are updating a lot of parameters, which needs real infrastructure.

**13. RLHF (Reinforcement Learning from Human Feedback).** Fine-tuning makes a model specialised,`RLHF` makes it feel helpful and aligned. Show the model a prompt, have it generate multiple responses, have humans rank them, and train the model to prefer what humans prefer. Rinse and repeat. This is the step that turns a fluent text predictor into something that behaves like an assistant.

**14. LoRA (LOw-Rank Adaptation).** Fine-tuning the whole model is expensive. `LoRA` freezes the original model and adds tiny trainable layers on top at a fraction of the full size. The insight is that most fine-tuning changes are small, so you do not need to rewrite the whole model. This is a big part of why open-source AI exploded: suddenly you could adapt a powerful model on modest hardware and swap adapters in and out.

**15. Quantisation.** Models are huge and running them needs serious memory. Quantisation reduces the numerical precision of each weight. For example, say from 16-bit to 4-bit, shrinking the model several times over with a surprisingly small quality drop. This is why you can now run capable models on a laptop or even a phone instead of only in a data centre.

---

## Part 4: How Real Systems Are Built

**16. RAG (Retrieval-Augmented Generation).** Models hallucinate because they answer from memory. `RAG` lets them look things up first: the system searches a knowledge base for relevant documents, passes those to the model as context, and the model answers from real information. Closed book exam versus open book exam. The bonus is that when your data changes you just update the documents, no need for retraining. Nearly every serious AI product uses some form of this.

**17. Vector databases.** RAG needs to find the right documents fast, by *meaning* rather than keywords. Every document is stored as an embedding... your question becomes an embedding too.The database returns the documents whose vectors are closest. So "heart disease treatment" can surface a document about "cardiac care protocols" even with no shared keywords. This is what makes systems feel like they understand rather than just match strings.

**18. AI agents.** An LLM answers... an agent *does*. You give it a goal and it plans, takes an action, observes the result, adjusts, and repeats - think, act, observe, loop. A coding agent reads an issue, explores the codebase, writes a fix, runs the tests, sees what failed, and tries again. The model is the brain; tools (web search, code execution, file access, APIs) are the hands. Agents are what turn AI from a chatbot into something closer to a coworker - and, as I have written elsewhere, into a much larger attack surface.

**19. Chain of thought.** Sometimes the model gets the wrong answer because it jumped straight to it. Prompting it to reason step by step - lay out the formula, plug in the numbers, then calculate - is far more reliable for maths, logic, and multi-step problems. Give the model room to think instead of forcing an instant answer. This is why "think step by step" actually works, and it is the seed of modern reasoning models.

**20. Diffusion models.** Everything above is about text. Diffusion explains image generation, and the mechanism is counterintuitive: the model does not learn to draw, it learns to *destroy*. In training you take a real image and add noise step by step until it is pure static, then train the model to reverse that. To generate, you start from pure noise and let the model denoise step by step, guided by a text prompt, until an image emerges. The same idea now drives video, audio, and 3D generation.

---

## The Edge

Understanding these twenty puts you ahead of nearly everyone who uses AI daily. The gap between "I use ChatGPT" and "I can explain why this model hallucinated and how to ground it" is not talent - it is exactly these mental models. Pick the ones that are still fuzzy and go one level deeper. That gap is the whole advantage.

---

## Sources

- Vaswani et al., "Attention Is All You Need" (2017) - https://arxiv.org/abs/1706.03762
- Liu et al., "Lost in the Middle: How Language Models Use Long Contexts" (2023) - https://arxiv.org/abs/2307.03172
- Hu et al., "LoRA: Low-Rank Adaptation of Large Language Models" (2021) - https://arxiv.org/abs/2106.09685
- Lewis et al., "Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks" (2020) - https://arxiv.org/abs/2005.11401
- Ho et al., "Denoising Diffusion Probabilistic Models" (2020) - https://arxiv.org/abs/2006.11239
- Wei et al., "Chain-of-Thought Prompting Elicits Reasoning in Large Language Models" (2022) - https://arxiv.org/abs/2201.11903
