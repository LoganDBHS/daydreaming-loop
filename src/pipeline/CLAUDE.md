# Core Pipeline Module

You are building the core discovery pipeline for a DDL system.
Your code lives ONLY in src/pipeline/. Do not create or modify files outside this directory.

## What you're building

The creative engine that:
1. Takes concept pairs from the data layer
2. Generates puzzles (patterns that are easy to describe but hard to explain)
3. Scores puzzles using Simplicity Theory (U = Cv - C)
4. For validated puzzles, generates insights that resolve them
5. Orchestrates batch runs of the full pipeline

## Files you own

- src/pipeline/puzzleGenerator.ts    — puzzle generation via Claude API
- src/pipeline/stScorer.ts           — Simplicity Theory scoring
- src/pipeline/insightGenerator.ts   — insight generation via Claude API
- src/pipeline/prompts.ts            — all prompt templates (system + user)
- src/pipeline/batchRunner.ts        — orchestrates batch pipeline runs
- src/pipeline/index.ts              — public exports

## Key exported functions

- generatePuzzle(pair: ConceptPair): Promise<{ puzzle: Puzzle | null; raw: string }>
- scorePuzzleWithST(puzzleText: string): Promise<{ C: number; Cv: number; U: number }>
- generateInsight(puzzle: Puzzle, enrichmentConcepts?: Concept[]): Promise<Insight | null>
- runBatch(batchSize: number, config: DDLConfig): Promise<{ puzzles: Puzzle[]; insights: Insight[] }>

## Import types from

import { Concept, ConceptPair, Puzzle, Insight, DDLConfig } from '../shared/types';

## You will call data layer functions via dependency injection

Your batchRunner receives data layer functions as parameters, e.g.:
```typescript
async function runBatch(
  getPair: () => Promise<ConceptPair>,
  getRelated: (text: string, k: number) => Promise<Concept[]>,
  storePuzzle: (p: Puzzle) => Promise<void>,
  config: DDLConfig
)
```
This keeps your module decoupled. You do NOT import from src/data/ directly.

## Claude API calls

Use the Anthropic SDK directly:
```typescript
import Anthropic from '@anthropic-ai/sdk';
const client = new Anthropic(); // uses ANTHROPIC_API_KEY env var
```

Model: claude-opus-4-6-20250219 (or config.modelId)

## Prompt design requirements

ALL prompts must include a "NO PUZZLE FOUND" or "NO INSIGHT FOUND" escape valve.
Without this, the model will force connections on every pair and flood the pipeline with noise.

Puzzle generation prompt must ask step-by-step:
1. What does each concept describe?
2. Is there an unexpected overlap, tension, analogy, or contradiction?
3. Can you state the puzzle in 1-2 sentences?
4. Why is this puzzle genuinely hard to explain?

Insight generation prompt must require:
1. Restate the puzzle crisply
2. Propose candidate mechanisms
3. Select the simplest explanation with broadest coverage
4. State predictions beyond the original puzzle
5. Check for contradictions with established knowledge

## Simplicity Theory scoring

For C (description complexity): use zstd compression ratio on the puzzle text.
For Cv (generation complexity): ask Claude to rate "how likely is this pattern
to arise by chance" on a 1-10 scale with justification. Use the numeric score.
U = Cv_normalized - C_normalized

Adaptive threshold: maintain a rolling window of the last N U-scores.
The threshold τ is the 95th percentile of that window.

## Do NOT

- Touch any files outside src/pipeline/
- Import directly from src/data/ (use dependency injection)
- Implement evaluation logic or UI
- Skip the "NO PUZZLE/INSIGHT FOUND" escape valve in any prompt
