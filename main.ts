// main.ts — DDL orchestrator entry point
// Wires data layer, pipeline, evaluation, and dashboard together.

import 'dotenv/config';

import {
  getRandomAntiCorrelatedPair,
  queryByText,
  storePuzzle as dbStorePuzzle,
  getConceptById,
  getConceptCount,
  getAllValidatedPuzzles,
} from './src/data/index.js';

import { runBatch } from './src/pipeline/index.js';
import { evaluateInsight } from './src/evaluation/index.js';

import {
  createServer,
  addCandidate,
  logPuzzleDiscarded,
  logInsightDiscarded,
  logGeneric,
} from './src/dashboard/index.js';

import {
  DDLConfig,
  Insight,
  Puzzle,
  Concept,
  ReviewCandidate,
  EvaluationResult,
} from './src/shared/types.js';

import { parallelMap, getConcurrency } from './src/shared/concurrency.js';

// ── Load config ──

function loadConfig(): DDLConfig {
  const apiKey = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN is required. Copy .env.template to .env and fill it in.');
  }

  return {
    antiCorrelationWindow: parseFloat(process.env.DDL_ANTI_CORRELATION_WINDOW || '0.2'),
    defaultPairSize: parseInt(process.env.DDL_DEFAULT_PAIR_SIZE || '2'),
    batchSize: parseInt(process.env.DDL_BATCH_SIZE || '5'),

    stThresholdPercentile: parseFloat(process.env.DDL_ST_THRESHOLD_PERCENTILE || '0.95'),
    stWindowSize: parseInt(process.env.DDL_ST_WINDOW_SIZE || '50'),

    fertilityThreshold: parseFloat(process.env.DDL_FERTILITY_THRESHOLD || '4'),
    resilienceThreshold: parseFloat(process.env.DDL_RESILIENCE_THRESHOLD || '4'),
    compositeThreshold: parseFloat(process.env.DDL_COMPOSITE_THRESHOLD || '5.0'),
    compositeWeights: {
      fertility: parseFloat(process.env.DDL_WEIGHT_FERTILITY || '0.35'),
      resilience: parseFloat(process.env.DDL_WEIGHT_RESILIENCE || '0.35'),
      unification: parseFloat(process.env.DDL_WEIGHT_UNIFICATION || '0.30'),
    },

    anthropicApiKey: apiKey,
    modelId: process.env.DDL_MODEL_ID || 'claude-opus-4-20250514',
    semanticScholarApiKey: process.env.SEMANTIC_SCHOLAR_API_KEY,
  };
}

// ── Build a ReviewCandidate from evaluated insight ──

async function buildReviewCandidate(
  insight: Insight,
  puzzle: Puzzle,
  evaluation: EvaluationResult,
): Promise<ReviewCandidate> {
  const [idA, idB] = puzzle.conceptPairIds;
  const conceptA = await getConceptById(idA);
  const conceptB = await getConceptById(idB);

  const enrichmentConcepts: Concept[] = [];
  for (const eid of insight.enrichmentConceptIds) {
    try {
      enrichmentConcepts.push(await getConceptById(eid));
    } catch {
      // enrichment concept may have been removed
    }
  }

  return {
    insight,
    puzzle,
    sourceConcepts: [conceptA, conceptB],
    enrichmentConcepts,
    evaluation,
  };
}

// ── Adapters for runBatch dependency injection ──

async function getRelatedByText(text: string, k: number): Promise<Concept[]> {
  const results = await queryByText(text, k);
  return results.map((r) => r.concept);
}

// ── Pipeline runner (called on-demand from dashboard) ──

async function executePipeline(
  onStatus: (msg: string, progress?: { current: number; total: number; phase: string }) => void,
  overrides?: { batchSize?: number },
): Promise<{
  pairsProcessed: number;
  puzzlesValidated: number;
  insightsGenerated: number;
  candidatesAdded: number;
}> {
  const config = loadConfig();

  // Apply overrides from the UI
  if (overrides?.batchSize && overrides.batchSize > 0) {
    config.batchSize = overrides.batchSize;
  }

  const conceptCount = await getConceptCount();
  onStatus(`Loaded ${conceptCount} concepts from vector store.`);

  if (conceptCount < 2) {
    throw new Error('Not enough concepts to run pipeline. Add at least 2 concepts first.');
  }

  // 1. Run batch pipeline: pairs → puzzles → insights
  onStatus(`Running batch pipeline (batchSize=${config.batchSize})...`, { current: 0, total: config.batchSize, phase: 'Generating puzzles' });

  const collectedInsights: Insight[] = [];

  const batch = await runBatch(
    () => getRandomAntiCorrelatedPair(config.antiCorrelationWindow),
    getRelatedByText,
    dbStorePuzzle,
    async (insight: Insight) => { collectedInsights.push(insight); },
    config,
    (current, total, phase) => {
      console.log(`[progress] ${phase}: ${current}/${total}`);
      onStatus(`${phase}: ${current}/${total}`, { current, total, phase });
    },
  );

  onStatus(
    `Batch done: ${batch.stats.pairsProcessed} pairs, ` +
    `${batch.stats.puzzlesValidated} validated puzzles, ` +
    `${batch.stats.insightsGenerated} insights`,
  );

  // Log discarded puzzles
  for (const puzzle of batch.puzzles) {
    if (puzzle.status === 'discarded') {
      logPuzzleDiscarded(puzzle.id, puzzle.stScore.unexpectedness, 'Below ST threshold');
    }
  }

  // 2. Evaluate each insight and build review candidates
  const storedPuzzles = await getAllValidatedPuzzles();
  const allPuzzles = [
    ...batch.puzzles.filter((p) => p.status === 'validated'),
    ...storedPuzzles.filter((sp) => !batch.puzzles.some((bp) => bp.id === sp.id)),
  ];

  const evalConcurrency = getConcurrency(collectedInsights.length);
  onStatus(`Evaluating ${collectedInsights.length} insights in parallel (concurrency=${evalConcurrency})...`, { current: 0, total: collectedInsights.length, phase: 'Evaluating insights' });

  // Pair each insight with its puzzle
  const insightsWithPuzzles = collectedInsights
    .map((insight) => ({
      insight,
      puzzle: batch.puzzles.find((p) => p.id === insight.puzzleId),
    }))
    .filter((x): x is { insight: Insight; puzzle: Puzzle } => x.puzzle != null);

  let added = 0;
  let evalsCompleted = 0;
  const evalTotal = insightsWithPuzzles.length;

  await parallelMap(
    insightsWithPuzzles,
    async ({ insight, puzzle }) => {
      onStatus(`Evaluating insight ${insight.id.slice(0, 8)}...`, { current: evalsCompleted, total: evalTotal, phase: 'Evaluating insights' });

      const evaluation = await evaluateInsight(insight, puzzle, allPuzzles, config, (log) => {
        logGeneric(log.event, log.data);
      });

      evalsCompleted++;
      logGeneric('insight_evaluated', {
        insightId: insight.id,
        compositeScore: evaluation.compositeScore,
        passed: evaluation.passesThreshold,
      });
      onStatus(`Evaluated insight ${insight.id.slice(0, 8)} (score=${evaluation.compositeScore.toFixed(2)})`, { current: evalsCompleted, total: evalTotal, phase: 'Evaluating insights' });

      if (!evaluation.passesThreshold) {
        logInsightDiscarded(insight.id, evaluation.compositeScore, 'composite_below_threshold', {
          fertility: evaluation.fertility?.overallScore ?? 0,
          resilience: evaluation.adversarial?.overallResilience ?? 0,
          unification: evaluation.unification?.unificationScore ?? 0,
        });
        return;
      }

      const candidate = await buildReviewCandidate(insight, puzzle, evaluation);
      addCandidate(candidate);
      added++;
    },
    evalConcurrency,
  );

  onStatus(`${added} candidates ready for expert review.`);

  return {
    pairsProcessed: batch.stats.pairsProcessed,
    puzzlesValidated: batch.stats.puzzlesValidated,
    insightsGenerated: batch.stats.insightsGenerated,
    candidatesAdded: added,
  };
}

// ── Main ──

async function main() {
  const port = parseInt(process.env.DDL_PORT || '3000');
  createServer(port, { runPipeline: executePipeline });
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
