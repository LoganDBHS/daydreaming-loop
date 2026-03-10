# Evaluation Engine Module

You are building the multi-stage evaluation engine for a DDL system.
Your code lives ONLY in src/evaluation/. Do not create or modify files outside this directory.

## What you're building

A rigorous, multi-stage evaluation pipeline that takes raw insights and determines
if they're genuinely valuable. This is the system's defense against insight mimicry —
LLM-generated outputs that SOUND insightful but contain nothing real.

## Files you own

- src/evaluation/router.ts            — domain-aware routing (hard vs soft path)
- src/evaluation/formalVerifier.ts     — hard path: run code, check proofs, verify predictions
- src/evaluation/fertilityChecker.ts   — predictive fertility evaluation
- src/evaluation/adversarialCritic.ts  — adversarial stress test
- src/evaluation/unificationScorer.ts  — explanatory unification scoring
- src/evaluation/noveltySearcher.ts    — patent-style literature novelty search
- src/evaluation/groundingChecker.ts   — knowledge graph fact-checking
- src/evaluation/compositor.ts         — composite score calculation
- src/evaluation/prompts.ts            — all evaluation prompt templates
- src/evaluation/index.ts              — public exports

## Key exported functions

- evaluateInsight(insight: Insight, puzzle: Puzzle, allPuzzles: Puzzle[], config: DDLConfig): Promise<EvaluationResult>
- checkNovelty(insightStatement: string): Promise<NoveltyResult>
- checkGrounding(insightStatement: string): Promise<GroundingResult>

## Import types from

import { Insight, Puzzle, EvaluationResult, FertilityResult, AdversarialResult,
         UnificationResult, NoveltyResult, GroundingResult, DDLConfig } from '../shared/types';

## The evaluation pipeline (in order)

1. DOMAIN-AWARE ROUTING
   Ask: "Can this insight be formally tested?" (code, math, simulation, data check)
   If yes → hard path. If no → soft path. If unclear → soft path.

2. HARD PATH (if routed here)
   - Ask Claude to write test code / proof / data query that would verify the insight
   - Execute it (use child_process or vm module)
   - If formally falsified → discard immediately
   - If passes → skip soft eval, go to step 6
   - If inconclusive → fall through to soft path

3. PREDICTIVE FERTILITY (soft path)
   Prompt asks for 3-5 novel, specific, falsifiable predictions.
   Each rated on specificity, independence, checkability (1-10).
   Overall fertility score 1-10. Discard below 4.

4. ADVERSARIAL STRESS TEST (soft path)
   CRITICAL: The system prompt must be radically different from generation prompts.
   This critic is ADVERSARIAL — its only job is to destroy the insight.

   Six attack vectors, each scored 0-10 severity:
   - Logical coherence
   - Counterexamples
   - Established knowledge contradictions
   - Simpler existing explanation
   - Unfalsifiability
   - Rhetorical mimicry (MOST IMPORTANT — catches insights that sound deep but say nothing)

   Overall resilience score 1-10. Discard below 4.

5. EXPLANATORY UNIFICATION (soft path)
   Check if the insight resolves multiple puzzles from the Puzzle Bank.
   For each puzzle: "Could this insight plausibly explain this puzzle?" (1-10)
   Count puzzles scoring above 6.
   Unification score = puzzles_resolved / total_puzzles.

6. COMPOSITE SCORE (soft path only)
   composite = (fertility × 0.35) + (resilience × 0.35) + (min(unification × 10, 10) × 0.30)
   Discard below 5.0.

7. NOVELTY SEARCH
   Search Semantic Scholar API and/or web for existing work making similar claims.
   Ask Claude to compare the insight against top search results.
   Flag if already known.

8. GROUNDING CHECK
   Extract key factual claims from the insight.
   Check against Wikidata or ask Claude if any claims contradict established knowledge.
   Flag if contradicted.

## Novelty search implementation

Use Semantic Scholar API (api.semanticscholar.org) — free, no auth needed for basic search.
Endpoint: GET https://api.semanticscholar.org/graph/v1/paper/search?query={query}&limit=5
Extract the insight's core claim as a search query.

## Do NOT

- Touch any files outside src/evaluation/
- Import directly from src/data/ or src/pipeline/
- Soften the adversarial critic — it should be harsh
- Skip the rhetorical mimicry attack vector
