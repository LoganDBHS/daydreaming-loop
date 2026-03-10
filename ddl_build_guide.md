# DDL Project — Multi-Terminal Build Guide

## Step 0: Create the Project Structure

Run this ONCE yourself before launching any Claude Code terminals:

```bash
mkdir -p ddl-discovery
cd ddl-discovery
npm init -y
mkdir -p src/shared src/data src/pipeline src/evaluation src/dashboard
```

## Step 1: Create the Shared Contract

Create `src/shared/types.ts` yourself. This is the contract between all modules.
No terminal modifies this file — only you do, if the contract needs to change.

```typescript
// src/shared/types.ts
// ═══════════════════════════════════════════════════════════
// SHARED CONTRACT — DO NOT MODIFY FROM ANY TERMINAL
// All modules import from this file. Changes require
// coordination across all terminals.
// ═══════════════════════════════════════════════════════════

// ── DATA LAYER TYPES ──

export interface Concept {
  id: string;
  text: string;
  source: string;            // where this came from (paper title, URL, manual entry)
  domain: string;            // domain tag (e.g. "computer vision", "neuroscience")
  embedding: number[];       // vector embedding
  metadata: {
    addedBy: string;         // expert who added it
    addedAt: Date;
    confidence: "established" | "speculative";
    sourceType: "manual" | "document" | "url";
  };
}

export interface ConceptPair {
  conceptA: Concept;
  conceptB: Concept;
  cosineSimilarity: number;  // how similar they are (lower = more interesting)
}

// ── PIPELINE TYPES ──

export interface Puzzle {
  id: string;
  conceptPairIds: [string, string];
  puzzleStatement: string;   // the puzzle in plain language
  whyHardToExplain: string;  // why this is surprising
  stScore: {
    descriptionComplexity: number;   // C — how simply it can be described
    generationComplexity: number;    // Cv — how hard for the world to produce
    unexpectedness: number;          // U = Cv - C
  };
  createdAt: Date;
  status: "validated" | "discarded";
}

export interface Insight {
  id: string;
  puzzleId: string;
  insightStatement: string;       // the proposed insight (1-3 sentences)
  mechanism: string;              // what mechanism it proposes
  howItResolvesPuzzle: string;    // how it explains the puzzle
  initialPredictions: string[];   // predictions it makes
  enrichmentConceptIds: string[]; // additional concepts used
  createdAt: Date;
}

// ── EVALUATION TYPES ──

export type EvaluationPath = "hard" | "soft" | "inconclusive";

export interface FertilityResult {
  predictions: Array<{
    prediction: string;
    specificity: number;     // 1-10
    independence: number;    // 1-10
    checkability: number;    // 1-10
  }>;
  overallScore: number;      // 1-10
}

export interface AdversarialResult {
  attacks: Array<{
    vector: "logical_coherence" | "counterexamples" | "established_knowledge" 
            | "simpler_explanation" | "unfalsifiability" | "rhetorical_mimicry";
    severity: number;        // 0-10
    finding: string;
  }>;
  overallResilience: number; // 1-10
}

export interface UnificationResult {
  puzzlesResolved: Array<{
    puzzleId: string;
    relevanceScore: number;  // 1-10
  }>;
  unificationScore: number;  // 0-1 (puzzles resolved / total puzzles)
}

export interface NoveltyResult {
  existingWorks: Array<{
    title: string;
    url: string;
    similarityAssessment: string;
  }>;
  isNovel: boolean;
}

export interface GroundingResult {
  contradictions: Array<{
    claim: string;
    contradictedBy: string;
    source: string;
  }>;
  isGrounded: boolean;
}

export interface EvaluationResult {
  insightId: string;
  path: EvaluationPath;
  
  // Hard path (if applicable)
  formalVerification?: {
    testCode: string;
    passed: boolean;
    output: string;
  };
  
  // Soft path
  fertility?: FertilityResult;
  adversarial?: AdversarialResult;
  unification?: UnificationResult;
  
  // Both paths
  novelty: NoveltyResult;
  grounding: GroundingResult;
  
  compositeScore: number;    // final score 0-10
  passesThreshold: boolean;  // composite >= 5.0
}

// ── DASHBOARD TYPES ──

export interface ReviewCandidate {
  insight: Insight;
  puzzle: Puzzle;
  sourceConcepts: [Concept, Concept];
  enrichmentConcepts: Concept[];
  evaluation: EvaluationResult;
}

export interface ReviewDecision {
  candidateId: string;
  decision: "approved" | "rejected" | "investigate" | "refine";
  rejectionReason?: "trivially_obvious" | "already_known" | "factually_wrong" 
                    | "not_actionable" | "too_vague" | "rhetorical_mimicry";
  expertNotes?: string;
  reviewedAt: Date;
  reviewedBy: string;
}

// ── CONFIGURATION ──

export interface DDLConfig {
  // Sampling
  antiCorrelationWindow: number;    // 0.0-1.0, default 0.2 (bottom 20%)
  defaultPairSize: number;          // default 2
  batchSize: number;                // pairs per batch run
  
  // Simplicity Theory
  stThresholdPercentile: number;    // default 0.95 (95th percentile)
  stWindowSize: number;             // trailing window for adaptive threshold
  
  // Evaluation
  fertilityThreshold: number;       // default 4
  resilienceThreshold: number;      // default 4
  compositeThreshold: number;       // default 5.0
  compositeWeights: {
    fertility: number;              // default 0.35
    resilience: number;             // default 0.35
    unification: number;            // default 0.30
  };
  
  // API
  anthropicApiKey: string;
  modelId: string;                  // "claude-opus-4-6-20250219" or latest
  
  // Novelty search
  semanticScholarApiKey?: string;
}
```

## Step 2: Create CLAUDE.md for Each Terminal

Each terminal gets its own CLAUDE.md that scopes its work. Drop these files
into the appropriate directories before launching Claude Code in that directory.

---

### Terminal 1 CLAUDE.md → `src/data/CLAUDE.md`

```markdown
# Data Layer Module

You are building the data layer for a Daydreaming Discovery Loop (DDL) system.
Your code lives ONLY in src/data/. Do not create or modify files outside this directory.

## What you're building

A knowledge management system that:
1. Lets domain experts easily input concepts (text, documents, URLs)
2. Chunks documents into concept-sized units (100-300 tokens)
3. Embeds concepts using a high-quality embedding model
4. Stores everything in a vector database (use ChromaDB)
5. Provides an anti-correlated sampler that returns concept pairs with LOW cosine similarity
6. Stores validated puzzles in a Puzzle Bank

## Files you own

- src/data/vectorStore.ts      — ChromaDB setup, CRUD operations
- src/data/chunker.ts          — document chunking logic
- src/data/embedder.ts         — embedding generation (use Voyage or OpenAI embeddings)
- src/data/sampler.ts          — anti-correlated concept pair sampling
- src/data/puzzleBank.ts       — puzzle storage and retrieval
- src/data/ingest.ts           — expert input handlers (text, document, URL)
- src/data/index.ts            — public exports

## Key exported functions (these are your API contract)

- addConcept(text, source, domain, metadata): Promise<Concept>
- addConceptsFromDocument(filePath, domain): Promise<Concept[]>
- addConceptsFromURL(url, domain): Promise<Concept[]>
- getRandomAntiCorrelatedPair(windowPercent?): Promise<ConceptPair>
- getRelatedConcepts(text, topK?): Promise<Concept[]>
- storePuzzle(puzzle): Promise<void>
- getAllValidatedPuzzles(): Promise<Puzzle[]>
- getConceptById(id): Promise<Concept>

## Import types from

import { Concept, ConceptPair, Puzzle, DDLConfig } from '../shared/types';

## Anti-correlated sampling algorithm

1. Pick a random concept from the database
2. Get ALL other concepts with their cosine similarity to the picked concept
3. Sort by ascending similarity (most distant first)
4. Sample from the bottom N% of the similarity distribution (N = antiCorrelationWindow from config, default 20%)
5. Return the pair with their cosine similarity score

## Chunking strategy

- Target chunk size: 100-300 tokens
- Split on paragraph breaks and section headers
- Never split mid-sentence
- For academic papers: extract abstract, each finding, each method, each conclusion as separate chunks

## Do NOT

- Touch any files outside src/data/
- Implement pipeline logic, evaluation, or UI
- Make assumptions about how your functions will be called — just expose clean async functions
```

---

### Terminal 2 CLAUDE.md → `src/pipeline/CLAUDE.md`

```markdown
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
```

---

### Terminal 3 CLAUDE.md → `src/evaluation/CLAUDE.md`

```markdown
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
```

---

### Terminal 4 CLAUDE.md → `src/dashboard/CLAUDE.md`

```markdown
# Dashboard & Orchestrator Module

You are building the human review dashboard and the main orchestrator for a DDL system.
Your code lives ONLY in src/dashboard/ and the project root (for the main entry point).
Do not modify files in src/data/, src/pipeline/, or src/evaluation/.

## What you're building

Two things:

1. A CLI orchestrator (main.ts at project root) that wires all modules together and runs the pipeline
2. A simple web dashboard where domain experts can:
   - Input new concepts (text, document upload, URL)
   - View and review candidate insights
   - Approve/reject with reasons
   - See evaluation breakdowns and source traces
   - Configure pipeline parameters

## Files you own

- src/dashboard/server.ts         — Express server for the dashboard
- src/dashboard/routes.ts         — API routes
- src/dashboard/views/             — Frontend (use simple HTML + vanilla JS or React, keep it simple)
- src/dashboard/reviewStore.ts    — stores review decisions
- src/dashboard/logger.ts         — pipeline logging (all discards with scores and reasons)
- src/dashboard/index.ts          — public exports
- main.ts (project root)         — orchestrator entry point

## The orchestrator (main.ts)

This is the glue. It:
1. Loads config from a config.json or .env
2. Initializes the data layer (vector DB connection)
3. Runs the batch pipeline:
   a. Call data layer to get concept pairs
   b. Call pipeline to generate puzzles and score them
   c. For validated puzzles, call pipeline to generate insights
   d. Call evaluation engine to evaluate each insight
   e. Store results for dashboard display
4. Starts the dashboard server

Keep it simple. This is a script, not a framework.

## Dashboard — what the expert sees for each candidate

- The insight statement
- The source puzzle and why it's surprising
- The original concept pair (full text)
- Evaluation scores breakdown (fertility, resilience, unification, composite)
- For formally verified insights: test code and results
- Predictions generated by fertility check
- Strongest objections from adversarial stress test
- Closest existing work from novelty search
- Full provenance chain (which concepts → what puzzle → what enrichment → what insight)

## Expert actions

- Approve (insight is validated)
- Reject with reason (select from: trivially_obvious, already_known, factually_wrong, 
  not_actionable, too_vague, rhetorical_mimicry)
- Flag for investigation (interesting but needs more work)
- Refine (expert edits the insight)
- Add expert notes

## Logging

Log EVERYTHING. Every discarded puzzle with its U-score. Every discarded insight with its
composite score and which evaluation stage killed it. Every review decision with reason.
This data is essential for tuning the pipeline.

Use a simple JSON-lines log file. One JSON object per line. Include timestamps.

## Import types from

import { ReviewCandidate, ReviewDecision, DDLConfig, ... } from '../shared/types';

## Do NOT

- Modify files in src/data/, src/pipeline/, or src/evaluation/
- Over-engineer the UI — simple and functional beats pretty
- Build authentication or multi-user features (single expert use case for now)
```

## Step 3: Shared Dependencies

Create a single package.json at the project root with all deps before launching terminals:

```json
{
  "dependencies": {
    "@anthropic-ai/sdk": "latest",
    "chromadb": "latest",
    "express": "latest",
    "uuid": "latest",
    "zstd-codec": "latest"
  },
  "devDependencies": {
    "typescript": "latest",
    "@types/node": "latest",
    "@types/express": "latest",
    "tsx": "latest"
  }
}
```

Run `npm install` once before launching any terminals.

## Step 4: Launch Order

All four terminals can launch simultaneously. They don't depend on each other's
code existing — they only depend on the shared types file.

The dependency injection pattern in Terminal 2 means it never imports from Terminal 1's
code directly. Terminal 4 (orchestrator) is the only thing that imports from all modules,
and it's the last thing to wire together.

1. Open 4 terminal panes (tmux, iTerm2 split, or separate windows)
2. Terminal 1: `cd src/data && claude` 
3. Terminal 2: `cd src/pipeline && claude`
4. Terminal 3: `cd src/evaluation && claude`
5. Terminal 4: `cd src/dashboard && claude`

Give each terminal its first prompt:
- T1: "Read CLAUDE.md and build the complete data layer. Start with vectorStore.ts and sampler.ts."
- T2: "Read CLAUDE.md and build the core pipeline. Start with prompts.ts and puzzleGenerator.ts."
- T3: "Read CLAUDE.md and build the evaluation engine. Start with prompts.ts and adversarialCritic.ts."
- T4: "Read CLAUDE.md and build the dashboard server and review UI. Start with server.ts and routes.ts. 
       Don't build main.ts yet — wait until the other modules are done."

## Step 5: Integration

Once T1-T3 are done, tell T4:
"Now build main.ts. Import from ../data, ../pipeline, and ../evaluation. 
Wire everything together following the orchestrator spec in your CLAUDE.md."

Test the full pipeline with a small knowledge base (5-10 concepts from a domain you know well).
