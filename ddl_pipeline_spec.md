# Daydreaming Discovery Loop (DDL) with Simplicity Theory

## A Complete Pipeline for Automated Insight Discovery

**Model**: Claude Opus 4.6 (all slots)
**Core References**: Gwern — "LLM Daydreaming" (2024), Łukasiak — "Dreaming Machines" & "Reinventing Daydreaming Machines" (2025), Dessalles — Simplicity Theory

---

## How This System Works (Plain English)

This system automates the "aha moment." It takes a knowledge base of concepts from a specific domain, randomly pairs concepts that don't obviously belong together, asks whether the pairing reveals a puzzle worth investigating, then tries to generate insights that resolve those puzzles. Every candidate insight passes through multiple stages of evaluation — mathematical surprise scoring, predictive fertility checks, adversarial stress tests, novelty searches, and fact-checking — before reaching a human expert who makes the final call.

The key insight from the research: don't search for insights directly (combinatorial explosion makes this impossible). Instead, search for *puzzles* first — patterns that are easy to describe but hard to explain. Puzzles are rare, so this dramatically cuts the search space. Then, for each validated puzzle, search for insights that resolve it. This two-phase architecture is what makes the system tractable.

---

## Phase 0: Knowledge Ingestion

### Purpose

Everything downstream depends on the quality of what goes in. This is the GIGO safeguard. A human domain expert controls what enters the knowledge base, ensuring relevance and quality. The system discovers connections — it cannot discover connections between things it doesn't know about.

### Expert Input Interface

The system should make it trivially easy for a domain expert to add knowledge. Support multiple input formats:

**Direct text input.** The expert types or pastes a concept description directly. Example: "Hailo-8 NPU performs 26 TOPS at 2.5W power consumption using a dataflow architecture optimized for neural network inference at the edge." This is the simplest path and should be the default.

**Document upload.** The expert drops in PDFs, papers, textbooks, technical docs. The system extracts text, chunks it, and adds it to the knowledge base. The expert should be able to review and approve/reject individual chunks before they enter the database.

**URL ingestion.** The expert provides URLs to papers, blog posts, documentation pages. The system fetches, extracts, chunks, and presents for review.

**Structured concept entry.** A simple form where the expert provides: a concept name (short label, e.g. "YOLO object detection"), a concept description (1-3 sentences explaining what it is), a domain tag (e.g. "computer vision", "neuroscience", "economics"), and optionally key relationships or tensions they already know about.

**Bulk import from citation managers.** If the expert has a Zotero/Mendeley library, allow batch import of paper abstracts and key passages.

### Chunking Strategy

Raw documents need to be broken into discrete "concept units" — chunks small enough to be a single idea but large enough to be meaningful. Target chunk size: 100-300 tokens. Each chunk gets embedded using a high-quality embedding model (e.g., Voyage-3 or OpenAI text-embedding-3-large) and stored in the vector database.

Chunking should preserve semantic coherence. Don't split mid-sentence or mid-paragraph. Use section headers and paragraph breaks as natural split points. For papers, extract the abstract, each major finding, each method description, and each conclusion as separate chunks.

### Metadata Tagging

Every chunk should carry metadata: source document, domain tag(s), date of entry, expert who added it, and a confidence flag (is this well-established knowledge or speculative?). This metadata becomes important later for grounding checks and for the expert to trace where insights came from.

### Vector Database

Store all concept chunks with their embeddings in a vector database (Chroma, Pinecone, Weaviate, or Qdrant all work). The database needs to support: similarity search (for the optional concept enrichment in Phase 2), random sampling (for the anti-correlated sampler), and metadata filtering (for domain-scoped searches).

### What Makes a Good Knowledge Base

Based on the HN discussion and Łukasiak's experiments, the most productive knowledge bases are: cross-disciplinary (span 3-5 related but distinct fields), dense with technical specifics (not just high-level overviews), and curated by someone who understands the domain well enough to exclude noise but broadly enough to include adjacent fields where surprising connections might live.

A bad knowledge base is either too narrow (all concepts are already closely related, so pairings are boring) or too broad (random pairings between quantum physics and Renaissance painting are unlikely to yield actionable insights). The sweet spot is a focused cluster of 3-5 fields with known but underexplored interfaces between them.

---

## Phase 1: Puzzle Discovery

### Purpose

This is the first half of Łukasiak's two-phase architecture. The goal is to find combinations of concepts that reveal genuine puzzles — patterns that are easy to describe but hard to explain. Most combinations are uninteresting. This phase filters aggressively so that Phase 2 only works on validated targets.

### Step 1.1: Anti-Correlated Concept Sampling

Pull pairs of concepts from the vector database. The critical design decision here: **prefer pairs with LOW cosine similarity.** This is counterintuitive — most retrieval systems try to find *similar* items — but the whole point of daydreaming is to explore unexpected connections.

The problem with naive random sampling is that embedding spaces encode existing relationships from training data. Concepts that the literature already treats as related will cluster together. If you sample uniformly at random, you'll oversample pairs that are already somewhat expected. The truly wild, high-value connections — the ones between maximally distant concepts — are the ones you want to find.

**Sampling algorithm:**

1. Select a random concept from the database.
2. Retrieve concepts ranked by *ascending* cosine similarity (most distant first).
3. Sample from the bottom 10-30% of the similarity distribution (not the absolute minimum, because completely unrelated concepts like "bicycle gears" and "pharaonic burial rites" are almost certainly noise).
4. The sampling window (bottom 10% vs. bottom 30%) is a tunable parameter. Start at 20% and adjust based on the hit rate in puzzle evaluation.

**Default pair size:** k=2. Łukasiak showed that the two-phase architecture lets you effectively compose higher-order insights (3-4+ concept combinations) by finding pairwise puzzles first, then adding enrichment concepts in Phase 2. This avoids the combinatorial explosion of searching all C(n,3) or C(n,4) combinations directly.

**Sampling rate:** Generate concept pairs continuously. The goal is to feed a steady stream into puzzle generation. The system should be able to run overnight and produce thousands of candidate pairs.

### Step 1.2: Puzzle Generation

For each concept pair, send the following to Claude Opus 4.6:

**System prompt:**
```
You are a puzzle detector. Your job is to identify genuinely surprising tensions,
anomalies, or unexplained patterns that emerge when two concepts are considered
together. Do NOT state obvious connections. Do NOT force connections that don't
exist. If the pairing is genuinely uninteresting, say "NO PUZZLE FOUND" and
explain briefly why.

A good puzzle has these properties:
- It can be described simply (a clear pattern or observation)
- It is hard to explain why this pattern exists given current understanding
- It suggests something deeper is going on that hasn't been articulated

Think step by step:
1. What does each concept describe?
2. Is there an unexpected overlap, tension, analogy, or contradiction?
3. If so, can you state the puzzle in 1-2 sentences?
4. Why is this puzzle genuinely hard to explain?
```

**User prompt:**
```
Concept 1: {chunk_text_A}
Concept 2: {chunk_text_B}

Is there a genuine puzzle here? If so, state it clearly. If not, say NO PUZZLE FOUND.
```

**Critical design note from the HN discussion:** The "NO PUZZLE FOUND" escape valve is essential. Without it, the model will force connections between every pair, flooding the pipeline with false positives. LLMs are trained to be helpful and will manufacture plausible-sounding connections even when none exist. Explicitly permitting "no" as an answer dramatically improves signal-to-noise ratio.

**Output:** Either "NO PUZZLE FOUND" (discard, log for analysis) or a structured puzzle statement with a description of the pattern and an explanation of why it's hard to account for.

### Step 1.3: Puzzle Evaluation via Simplicity Theory

Every candidate puzzle gets scored using Simplicity Theory's unexpectedness metric: **U = Cv - C**, where C is description complexity and Cv is generation complexity.

**Approximating C (description complexity):**

Use compression as a proxy. Take the puzzle statement text and compress it with zstd or a sentencepiece tokenizer. The compressed size (in bytes or tokens) approximates how simply the pattern can be described. Lower C = simpler description = potentially more interesting if Cv is high.

Implementation: `C = len(zstd.compress(puzzle_text.encode())) / len(puzzle_text.encode())`

This gives a compression ratio between 0 and 1. Lower ratios mean the pattern is more compressible (simpler to describe).

**Approximating Cv (generation complexity):**

Use the base model's perplexity as a proxy. Feed the puzzle statement to Claude and measure how "surprising" it is. Higher perplexity = the model finds this pattern unlikely to occur = higher generation complexity.

Implementation approach: Send the puzzle text as a completion request with `logprobs` enabled. Calculate the mean negative log probability across tokens. This gives you a perplexity-like score. Higher score = more surprising = higher Cv.

Alternative (simpler but less precise): Ask Claude directly to estimate how likely this pattern is to arise by chance, on a 1-10 scale, with detailed justification. Use the numeric score as a Cv proxy. This is the "direct LLM estimation" approach from Łukasiak — less principled but more practical as a first implementation.

**Computing U and filtering:**

U = Cv_score - C_score (after normalizing both to comparable scales)

Set an acceptance threshold τ. The threshold should be adaptive: track the distribution of U scores over the last N puzzles and set τ at the 95th percentile. This means roughly 5% of puzzles pass, which balances between being too strict (nothing passes, system stalls) and too loose (pipeline drowns in false positives).

**Puzzles that pass** get stored in a Puzzle Bank — a separate data store that accumulates validated puzzles. This bank becomes important in Phase 3 for explanatory unification scoring.

**Puzzles that fail** get discarded but logged. The logs are valuable for tuning: if the system is generating too many low-U puzzles, you might need to adjust the anti-correlated sampling window. If nearly everything passes, your threshold is too low.

---

## Phase 2: Insight Generation

### Purpose

For each validated puzzle, try to generate an insight — a mechanism, principle, or framework that *resolves* the puzzle by providing a simple explanation for the hard-to-explain pattern. This is the creative core of the system.

### Step 2.1: Optional Concept Enrichment

Before generating an insight, optionally retrieve 1-2 additional concepts from the vector database that might help resolve the puzzle. This is where higher-order (3-4 concept) insights emerge without paying the full combinatorial cost.

**Retrieval strategy:** Take the puzzle statement text, embed it, and retrieve the top 3-5 most relevant concepts from the vector database (standard similarity search — here you *want* related concepts, unlike in Phase 1 where you wanted distant ones). Present these as optional additional building blocks to the insight generator.

This step is what lets the system discover insights like Darwin's: the puzzle (organisms match environments) was found from two concepts, but the resolution (natural selection) required additional concepts (population pressure, variation, inheritance) that were retrieved as enrichment.

### Step 2.2: Insight Generation

Send the validated puzzle plus any enrichment concepts to Claude Opus 4.6:

**System prompt:**
```
You are a theoretical synthesizer. You've been given a validated puzzle — a pattern
that is easy to describe but hard to explain. Your job is to propose an insight
that RESOLVES this puzzle: a mechanism, principle, framework, or connection that
explains WHY the pattern exists.

Requirements for a good insight:
- It should be SIMPLE (ideally expressible in 1-3 sentences)
- It should EXPLAIN the puzzle (not just restate it)
- It should be GENERATIVE (it should predict other things beyond the puzzle)
- It should be GROUNDED (it shouldn't contradict known facts)
- It should be NON-OBVIOUS (it shouldn't be something already widely known)

If you cannot generate a satisfying insight, say "NO INSIGHT FOUND" rather than
forcing a weak one.

Think step by step:
1. What exactly needs explaining? (Restate the puzzle crisply)
2. What mechanisms or principles could account for this?
3. Which candidate explanation is simplest while covering the most ground?
4. What would this explanation predict beyond the original puzzle?
5. Does this contradict anything you know to be established?
```

**User prompt:**
```
PUZZLE: {puzzle_statement}

ORIGINAL CONCEPTS:
- {chunk_text_A}
- {chunk_text_B}

ADDITIONAL CONCEPTS (optional building blocks):
- {enrichment_chunk_1}
- {enrichment_chunk_2}

Propose an insight that resolves this puzzle.
```

**Output:** Either "NO INSIGHT FOUND" (discard, log) or a structured insight with: the insight statement (1-3 sentences), the mechanism it proposes, how it resolves the puzzle, and initial predictions it makes.

---

## Phase 3: Multi-Stage Insight Evaluation

### Purpose

This is where the system earns its keep. The HN discussion made clear that LLM-as-critic degrades quality when the generator and critic share the same biases. The solution is a multi-stage evaluation pipeline where each stage tests a *different dimension* of insight quality, and where "hard reality" replaces LLM judgment wherever possible.

### Step 3.1: Domain-Aware Routing

Before running soft evaluation, check: **can this insight be formally tested?**

This is the single most important architectural decision in the evaluation pipeline, drawn from the HN consensus (amelius, Yizahi, amelius). Wherever you can bypass LLM judgment with actual verification, you should.

**Hard reality path criteria:**
- Does the insight make a claim about code behavior? → Run the code and test it.
- Does the insight propose a mathematical relationship? → Write it as a formal proof or compute counterexamples.
- Does the insight predict a measurable quantity? → Check against known data.
- Does the insight propose a causal mechanism that can be simulated? → Run the simulation.
- Does the insight predict the outcome of a specific, documented experiment? → Check the experimental record.

If ANY of these apply, route to the hard reality path first. Only insights that can't be formally tested go through the full soft evaluation pipeline.

### Step 3.2 (Hard Path): Formal Verification

For insights that can be formally tested:

1. **Generate the test.** Ask Claude to write code, a proof sketch, a simulation, or a data query that would verify or falsify the insight.
2. **Run the test.** Execute the code, check the proof, run the simulation, query the data.
3. **Evaluate the result.** Did the insight's prediction hold up?

If the insight is **formally falsified** (the code fails, the proof has a gap, the prediction doesn't match data), discard it immediately. This is the strongest possible signal — no amount of rhetorical persuasiveness can survive a failed formal test.

If the insight **passes formal verification**, it skips the soft evaluation pipeline entirely and goes directly to novelty verification (Step 3.6). A formally verified insight is worth far more than one that merely survived LLM critique.

If the test is **inconclusive** (couldn't generate a clean test, test timed out, data unavailable), fall through to the soft evaluation path.

### Step 3.3 (Soft Path): Predictive Fertility Check

A genuinely valuable insight should generate predictions that the original concepts alone wouldn't have produced. This is the strongest soft test available because it checks for *generativity* — the hallmark of a real theoretical contribution.

**Prompt to Claude:**
```
You are evaluating the predictive power of a proposed insight.

INSIGHT: {insight_statement}
ORIGINAL PUZZLE: {puzzle_statement}
SOURCE CONCEPTS: {concept_A}, {concept_B}

Task:
1. List 3-5 NOVEL, SPECIFIC, FALSIFIABLE predictions that this insight makes
   which would NOT be obvious from the source concepts alone.
2. For each prediction, rate:
   - Specificity (1-10): How precise and testable is this prediction?
   - Independence (1-10): How far is this prediction from the original concepts?
   - Checkability (1-10): Could someone verify this with existing data or a
     feasible experiment?
3. Overall fertility score (1-10): How generative is this insight?

If the insight doesn't generate any novel predictions, score it 1 and explain why.
```

**Scoring:** Extract the overall fertility score. Insights scoring below 4 are discarded. The specific predictions are saved — they become part of the output package for the human reviewer and can be used for downstream validation.

### Step 3.4 (Soft Path): Adversarial Stress Test

A dedicated critique pass whose explicit goal is to *destroy* the insight. This is the system's defense against insight mimicry — the tendency of LLMs to produce outputs that sound insightful but don't hold up under scrutiny.

**Critical implementation note from HN (zhangjunphy):** Using the same model with the same prompting style for generation and critique causes performance degradation. The system prompt here must be radically different in tone and objective from the generation prompts. The critic should be adversarial by design — rewarded for finding flaws, not for being balanced.

**Prompt to Claude:**
```
You are a ruthless scientific critic. Your ONLY job is to find flaws in the
following proposed insight. You are not trying to be balanced or fair. You are
trying to DESTROY this insight. If it survives your attack, it might be worth
something.

INSIGHT: {insight_statement}
MECHANISM: {proposed_mechanism}
PREDICTIONS: {predictions_from_fertility_check}

Attack vectors — work through ALL of these:

1. LOGICAL COHERENCE: Does the reasoning contain any logical fallacies,
   circular arguments, or unsupported leaps? Be specific about where.

2. COUNTEREXAMPLES: Can you think of a specific, concrete case where this
   insight would predict X but reality shows Y? Name the case.

3. ESTABLISHED KNOWLEDGE: Does this insight contradict any well-established
   scientific findings, engineering principles, or mathematical results?
   Cite what it contradicts.

4. SIMPLER EXPLANATION: Is there a simpler, already-known explanation for the
   same puzzle that makes this insight unnecessary? What is it?

5. UNFALSIFIABILITY: Is this insight stated so vaguely that it could never be
   proven wrong? If so, it's not an insight, it's a platitude.

6. RHETORICAL MIMICRY: Does this insight merely SOUND deep without actually
   saying anything? Strip away the impressive language — what's the actual
   claim? Is it trivial when stated plainly?

For each attack vector, rate the severity of the flaw found:
- 0: No flaw found (insight survives this test)
- 1-3: Minor flaw (could be addressed)
- 4-7: Significant flaw (insight is weakened)
- 8-10: Fatal flaw (insight should be discarded)

Overall resilience score (1-10): 10 = survived all attacks, 1 = fatally flawed
```

**Scoring:** Extract the overall resilience score. Insights scoring below 4 are discarded. Pay special attention to attack vector 6 (rhetorical mimicry) — this is the most common failure mode for LLM-generated insights and the hardest to catch with other evaluation methods.

### Step 3.5 (Soft Path): Explanatory Unification Score

Check whether the candidate insight resolves multiple validated puzzles simultaneously, not just the one it was generated for. This is the "compression gain" test from Simplicity Theory — the best insights are the ones that collapse many anomalies into one explanation.

**Implementation:**
1. Retrieve all validated puzzles from the Puzzle Bank (Phase 1 output).
2. For each puzzle, ask Claude: "Could the following insight plausibly explain this puzzle? Rate relevance 1-10."
3. Count how many puzzles score above 6.
4. The unification score = number of puzzles resolved / total puzzles in the bank.

An insight that resolves only its target puzzle gets a unification score near 0. An insight that resolves 5+ puzzles is extremely valuable — this is the Darwin's-natural-selection scenario where one mechanism explains a huge range of previously disconnected observations.

**Scoring:** The unification score acts as a multiplier on the composite score. Even a modest insight becomes much more valuable if it unifies multiple puzzles.

### Step 3.5.1: Composite Scoring

Combine all soft evaluation scores into a single composite:

```
composite = (fertility_score × 0.35) + (resilience_score × 0.35) + (unification_bonus × 0.30)

where unification_bonus = min(unification_score × 10, 10)
```

The weights are tunable. The equal weighting of fertility and resilience reflects that an insight needs to be both generative (makes new predictions) and robust (survives attack). Unification gets slightly less weight because it's the rarest signal — most insights will only resolve their target puzzle, and that's fine.

**Threshold:** Insights with composite score below 5.0 are discarded. This is deliberately aggressive — the goal is to surface only the best 5-10% of candidates for human review.

### Step 3.6: Patent-Style Novelty Search

Before surfacing an insight to the human reviewer, check whether it already exists in the literature under different framing. The HN discussion on attribution bias revealed that many "novel" AI-generated insights are actually rediscoveries of existing work expressed in different terminology.

**Implementation:**
1. Take the insight statement and extract its core claim in plain language.
2. Search academic databases (Semantic Scholar API, Google Scholar, arXiv) for papers making similar claims.
3. Search patent databases (Google Patents, USPTO) for related inventions.
4. Ask Claude to compare the insight against the top 5-10 search results: "Is this insight substantively the same as any of these existing works? Or does it add something genuinely new?"

**If the insight already exists:** Discard it (it's not novel) but flag the existing source — the human expert might still find the *connection* between their domain and the existing work valuable, even if the insight itself isn't new.

**If no match is found:** This is a positive signal. Proceed to grounding check.

### Step 3.7: Knowledge Graph Grounding Check

Verify that the insight doesn't contradict established facts. This is a safety net against the system confidently proposing mechanisms that violate known physics, chemistry, biology, etc.

**Implementation:**
1. Extract the key factual claims from the insight.
2. Check each claim against a structured knowledge source (Wikidata, domain-specific ontologies, textbook databases).
3. Ask Claude: "Do any of the following claims contradict well-established scientific knowledge?" with the extracted claims and relevant knowledge graph entries.

**If contradicted:** Discard the insight with a clear explanation of what it contradicts. Log this — a high rate of grounding failures suggests the puzzle generation or insight generation prompts need adjustment.

**If consistent (or no contradicting evidence found):** The insight passes to human review.

---

## Phase 4: Human Review Queue

### Purpose

The system produces candidates, not breakthroughs. As PaulHoule argued on HN, even a brilliant insight requires sustained human advocacy — potentially years of work — to become a breakthrough. The human review step is not a rubber stamp; it's where the real scientific judgment happens. The pipeline's job is to reduce the firehose of possible connections to a manageable stream of 10-20 high-quality candidates per day that a domain expert can meaningfully evaluate.

### What the Expert Sees

For each candidate insight, the dashboard should present:

**The insight itself.** A clear, concise statement of the proposed mechanism or principle.

**The source puzzle.** What anomaly or tension the insight was generated to resolve, including the original concept pair that produced the puzzle.

**Evaluation scores.** The composite score, broken down by fertility, resilience, and unification. For formally verified insights, show the test results.

**Predictions.** The specific, falsifiable predictions generated by the fertility check. These are actionable — the expert can immediately assess whether they're testable in their lab/domain.

**Adversarial critique.** The strongest objections the stress test found, so the expert can evaluate whether the flaws are real or artifacts of the LLM's reasoning.

**Unification map.** If the insight resolved multiple puzzles, show which ones and how.

**Novelty search results.** The closest existing work found in the literature, so the expert can assess whether this is genuinely new or a rediscovery.

**Source trace.** Full provenance chain: which concepts were paired, what enrichment concepts were added, what the intermediate puzzle statement was. This lets the expert understand *how* the insight was constructed and assess whether the reasoning chain is sound.

### Expert Actions

The expert can: approve (insight moves to validated discoveries), reject with reason (archived with rejection reason for future analysis), flag for further investigation (the insight is interesting but needs more evaluation — perhaps an experiment), and modify/refine (the expert sees the kernel of a good idea but wants to reshape it).

### Learning from Rejections

Rejection reasons should be categorized: "trivially obvious", "already known", "factually wrong", "interesting but not actionable", "too vague", "rhetorical mimicry." Over time, the distribution of rejection reasons reveals which parts of the pipeline need improvement. If most rejections are "already known," the novelty search isn't working. If most are "rhetorical mimicry," the adversarial stress test needs strengthening.

---

## System Configuration & Tuning Parameters

### Sampling Parameters
- **Anti-correlation window:** Sample from bottom 20% of cosine similarity distribution (tunable: 10-30%)
- **Pair size:** k=2 (default), with optional enrichment in Phase 2
- **Sampling rate:** Continuous, target 1000+ pairs per overnight run

### Simplicity Theory Parameters
- **Unexpectedness threshold τ:** Adaptive, set at 95th percentile of U scores over trailing window of 500 puzzles
- **C approximation method:** zstd compression ratio
- **Cv approximation method:** Direct LLM estimation on 1-10 scale (simpler to implement than perplexity-based approach; upgrade to perplexity later if needed)

### Evaluation Parameters
- **Fertility threshold:** Discard below 4/10
- **Resilience threshold:** Discard below 4/10
- **Composite threshold:** Discard below 5.0/10
- **Composite weights:** Fertility 0.35, Resilience 0.35, Unification 0.30
- **Daily human review target:** 10-20 candidates

### Operational Parameters
- **Run schedule:** Overnight batch processing (cheaper compute, results ready for morning review)
- **Logging:** Log ALL discards with scores and reasons (essential for tuning)
- **Puzzle Bank size:** Uncapped, but re-evaluate oldest puzzles quarterly for continued relevance

---

## Known Limitations & Failure Modes

### Insight Mimicry (highest risk)
LLMs are trained on millions of examples of what insights sound like. The system may produce outputs that perfectly match the rhetorical structure of a breakthrough — the "surprisingly, X connects to Y" framing, the confident synthesis tone — without containing any actual novel content. The adversarial stress test (especially attack vector 6, rhetorical mimicry) is the primary defense, but it's not foolproof because the critic is also an LLM susceptible to the same patterns. The human reviewer is the ultimate safeguard.

### Embedding Space Bias (medium risk)
Even with anti-correlated sampling, the embedding space itself encodes biases from training data. Concepts that the existing literature ignores or treats as unrelated may not even be represented in a way that captures their potential connection. This is a ceiling on what the system can discover — it can only find connections between concepts that are *expressible in the knowledge base*.

### Compression Proxy Limitations (medium risk)
Approximating Kolmogorov complexity with zstd compression is crude. Some genuinely complex patterns may compress well due to surface-level textual regularity, and some genuinely simple patterns may not compress well due to unusual vocabulary. This can be mitigated by using multiple compression methods and averaging, but the fundamental limitation remains: no computable function perfectly approximates Kolmogorov complexity.

### Single Model Family Correlation (medium risk)
Using Claude Opus 4.6 for all slots means the generator and all evaluators share the same training data, architectural biases, and blind spots. The prompt engineering (radically different system prompts for generation vs. evaluation) partially mitigates this, but correlated failures are possible. If an insight exploits a systematic blind spot in Claude's reasoning, it might pass all evaluation stages. The human reviewer is the only completely independent check.

### The Embodiment Gap (fundamental limitation)
The system cannot interact with physical reality. It cannot run experiments, collect new data, or be surprised by an unexpected observation. It can only recombine existing concepts. This means it has a ceiling that corresponds to the expressiveness of existing written knowledge. Insights that require noticing something in the physical world that nobody has documented are permanently out of reach for this architecture. This is a fundamental limitation, not a bug.

### Context Rot in Long Generations (low risk with current design)
Extended LLM generation degrades in quality as the context fills with the model's own output. The current design mitigates this by keeping each individual call short and focused (puzzle generation, insight generation, and each evaluation step are separate API calls, not one long conversation). If any step is redesigned to involve multi-turn reasoning, context rot becomes a risk.

---

## Costs & Practical Considerations

### Compute Costs (Rough Estimates)

Each concept pair requires approximately 5-8 API calls through the full pipeline:
1. Puzzle generation: ~500-1000 tokens out
2. ST evaluation (if using LLM estimation): ~200-500 tokens out
3. Insight generation (for puzzles that pass): ~500-1500 tokens out
4. Fertility check: ~500-1000 tokens out
5. Adversarial stress test: ~1000-2000 tokens out
6. Unification check: ~200-500 tokens per puzzle in bank
7. Novelty search synthesis: ~500-1000 tokens out
8. Grounding check: ~300-500 tokens out

Most pairs will be discarded at step 2 (puzzle evaluation), so the effective cost per pair is dominated by steps 1-2. With ~95% rejection at the puzzle stage, for every 1000 pairs sampled, roughly 50 will proceed to insight generation, and perhaps 5-10 will reach human review.

Gwern estimated a ~20:1 "daydreaming tax" for unfiltered DDL. The two-phase architecture with ST filtering should reduce this substantially — perhaps to 5:1 or 3:1 — but running this system at scale will still cost meaningfully more than the insights it produces would cost to generate in a single prompted conversation. That's the trade-off: you're paying for the search through combination space that no human would think to do.

### When to Use This System

This system is overkill for: problems where the answer is already known, domains where you can directly prompt an LLM with the right question, situations where a literature review would suffice.

This system is appropriate for: cross-disciplinary problems where connections between fields are underexplored, domains with large amounts of documented knowledge but limited theoretical unification, research groups that have accumulated significant domain knowledge and want to systematically explore the space of possible connections, and engineering problems where the solution might live in an adjacent technical field that the team hasn't considered.

---

## Implementation Priority

### Build First (Minimum Viable Pipeline)
1. Expert input interface (structured concept entry + document upload)
2. Vector database with embedding and storage
3. Anti-correlated sampler
4. Puzzle generation with "NO PUZZLE FOUND" escape valve
5. Basic ST scoring (LLM estimation of Cv, compression for C)
6. Insight generation with concept enrichment
7. Simple composite evaluation (fertility + adversarial, skip unification initially)
8. Basic dashboard showing results

### Build Second (Full Pipeline)
9. Novelty search (Semantic Scholar API integration)
10. Grounding check (Wikidata/knowledge graph integration)
11. Explanatory unification scoring (requires accumulated Puzzle Bank)
12. Domain-aware routing (hard reality path for testable insights)
13. Rejection reason categorization and pipeline analytics
14. Adaptive threshold tuning based on acceptance rates

### Build Third (Optimization)
15. Perplexity-based Cv estimation (replacing LLM estimation)
16. Multiple compression methods for C estimation
17. Expert feedback loop (rejection patterns inform prompt engineering)
18. Batch scheduling and cost optimization
19. Formal verification framework for code/math/simulation domains
