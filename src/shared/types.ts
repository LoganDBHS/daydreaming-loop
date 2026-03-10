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
