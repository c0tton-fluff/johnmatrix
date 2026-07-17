---
title: "How LLMs Are Actually Built: The Architecture Is the Part That Matters Least"
tags:
  - ai
  - llm
  - machine-learning
  - fundamentals
date: 2026-06-26
aliases:
  - "/AI-Research/How-LLMs-Are-Actually-Built"
---
Ask most people how you build a model like Claude or GPT and they say "transformers," as if the secret is the neural network design. It isn't. The transformer architecture is published, standardised, and freely available. Every major lab uses roughly the same building blocks. If architecture were the moat, everyone would already have a frontier model.

The thing nobody tells you: in practice it is **data, evaluation, and systems** that make or break a model, not architectural tweaks. The best models are not just trained. They are engineered. That is why two labs starting from the same architecture produce wildly different models - the architecture is shared, and everything that actually matters is not.

Here is the full pipeline from raw internet text to an assistant that answers you, in five stages. The architecture is one paragraph of one of them.

---

## Stage 1: Pretraining - Teach It Language Itself

Everything starts with one deceptively simple objective: **predict the next token**. Given a sequence, the model learns the probability distribution over what comes next. Do that across enough text and it absorbs grammar, facts, and reasoning patterns - not because anyone taught them, but because predicting the next token well *requires* them.

Before the model sees any text, the text is broken into tokens. The standard method is Byte-Pair Encoding, and its logic shapes everything downstream: the tokeniser determines the vocabulary, how the model handles new words, and how efficiently it processes different languages.

Then comes the architecture - the transformer, introduced in the 2017 paper "Attention Is All You Need." That is essentially it for this section, and that is the point. You do not win by inventing a cleverer transformer. Scaling curves are why: transformers simply have a better constant and slope than the recurrent models that came before. Pick the standard tool and move on to the four stages that decide the outcome.

---

## Stage 2: Data - Where Models Are Actually Won

If architecture matters least, data matters most. This is the stage that separates a good model from a mediocre one, and the one most people underestimate.

The pipeline starts with something like Common Crawl - a scrape of the public web measured in petabytes. But raw web data is filthy. Turning it into training material is a brutal multi-step filter:

1. Extract text from HTML, handling maths, code, and boilerplate
2. Filter undesirable content - NSFW, harmful, personal data
3. Deduplicate by URL, document, and line, because the web repeats endlessly (headers, footers, menus)
4. Heuristic filtering - drop low-quality docs by word count, outlier tokens, junk
5. Model-based filtering - predict whether a page is "reference-quality"
6. Data mixing - classify into categories (code, books, web) and reweight by what helps

The principle: **data quality trumps quantity**, and the modern numbers are enormous. Meta's Llama 3 was trained on roughly 15 trillion tokens of publicly available text. This is the most secretive part of the whole stack precisely because the competitive advantage lives in the data pipeline, not the papers.

---

## Stage 3: Scaling Laws - Spend Compute Optimally

You have a fixed compute budget. Do you train a bigger model, or train on more data? Guessing wastes millions. Scaling laws answer it predictably.

The DeepMind "Chinchilla" paper (Hoffmann et al., 2022) found that for compute-optimal training, **model size and training tokens should scale equally** - for every doubling of model size, you double the training tokens. The commonly cited rule of thumb derived from this is around 20 tokens per parameter for training-cost-optimality.

The practical twist: once you account for the cost of *running* the model at inference scale, you push well past that ratio. You train a smaller model on far more data, because you pay to run it millions of times. A smaller model that is cheaper per query, trained longer, beats a bloated one you can barely serve.

This is the engineering reasoning behind Mixture-of-Experts architectures, which let a model hold more total parameters (more knowledge) while only activating a subset per token (cheaper inference). It is a direct response to the scaling-law tradeoff.

The meta-lesson here is Rich Sutton's "bitter lesson": do the simple things and scale them. In the long run the only thing that reliably wins is leveraging computation.

---

## Stage 4: Post-Training - Turn a Predictor Into an Assistant

After pretraining you have something powerful but useless for chat. It completes text; it does not know it is supposed to *answer* you. Ask it a question and it might reply with three more questions - a perfectly plausible next-token continuation. Post-training closes that gap.

**Supervised fine-tuning (SFT)** shows the model thousands of prompt-and-good-response examples and it learns to imitate the pattern. This is behaviour cloning, and the surprising part is how little data it takes - a few thousand examples - because SFT only teaches the *format* of a good answer. The knowledge is already in the pretrained model.

SFT alone has three problems: it is bounded by the demonstrators' ability, it can teach the model to hallucinate (cloning a "correct" answer the model does not actually know teaches it to make things up), and writing ideal demonstrations does not scale.

**RLHF** (reinforcement learning from human feedback) fixes this by optimising for preference instead of imitation. The model generates two answers, a human picks the better one, those preferences train a reward model, and the model is optimised against that reward. This is the step that turned a raw text predictor into something that feels like an assistant.

**DPO** (Direct Preference Optimization, Rafailov et al., 2023) reaches comparable quality with a single supervised-style loss and no separate reward model or RL loop - the authors showed the optimal RLHF policy has a closed-form relationship to the reward, so you can collapse the whole thing into one classification objective. It is simpler and more stable to train, which is why much of the open-source community defaults to it.

---

## Stage 5: Evaluation and Systems - Prove It, Then Make It Feasible

Two things wrap around the whole pipeline. Skip either and you do not have a real model.

**Evaluation** is genuinely hard. During pretraining the metric is perplexity - roughly, how many tokens the model is hesitating between. But perplexity stops being meaningful after alignment, so evaluation shifts to benchmarks (MMLU and similar) and head-to-head human comparisons (Elo-style arenas). The honest takeaway is that no single number captures an aligned model, and the same model can score very differently depending only on the prompt format. Goodhart's law is always lurking: when a benchmark becomes the target, it stops being a good measure.

**Systems** is what makes training physically possible. Everyone is bottlenecked by compute - GPUs are expensive, scarce, and limited by communication speed. The systems layer is not optional:

- Low precision (bf16 instead of fp32) roughly halves memory and boosts speed
- Memory-efficient attention kernels (FlashAttention) cut the slow trips to global memory
- Data parallelism splits the dataset across GPUs; model parallelism splits the model itself
- Sparsity (MoE) gives more parameters for the same per-token compute

This is where quantisation and MoE stop being theory and become the engineering decisions that decide whether you can train and serve the thing at all.

---

## The Mistakes That Sink LLM Projects

- **Obsessing over architecture** - the most copied, least differentiating part of the stack
- **Treating data as a commodity** - dirty data caps your ceiling no matter the compute
- **Skipping the scaling maths** - a model too big for its data is undertrained and wastes compute
- **Stopping at SFT** - a fine-tuned model imitates; without preference optimisation it never learns what people actually prefer
- **Trusting perplexity after alignment** - post-training changes the distribution and the metric stops meaning anything

---

## The Bottom Line

A great model is not trained. It is engineered. Language modelling, then clean data, then optimal scaling, then alignment, then honest evaluation on efficient systems. Five stages. The architecture is one paragraph of one of them.

If you want to actually understand where models come from, pick the stage you have been ignoring - for most people it is data or evaluation - and go deep. That is where the difference lives.

---

## Sources

- Vaswani et al., "Attention Is All You Need" (2017) - https://arxiv.org/abs/1706.03762
- Hoffmann et al., "Training Compute-Optimal Large Language Models" (Chinchilla, DeepMind, 2022) - https://arxiv.org/abs/2203.15556
- Rafailov et al., "Direct Preference Optimization: Your Language Model is Secretly a Reward Model" (2023) - https://arxiv.org/abs/2305.18290
- Dao et al., "FlashAttention: Fast and Memory-Efficient Exact Attention with IO-Awareness" (2022) - https://arxiv.org/abs/2205.14135
- Meta, Llama 3 model card (15 trillion training tokens) - https://github.com/meta-llama/llama3/blob/main/MODEL_CARD.md
- Rich Sutton, "The Bitter Lesson" (2019) - http://www.incompleteideas.net/IncIdeas/BitterLesson.html
