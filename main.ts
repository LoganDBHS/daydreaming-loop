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

// ── Load config ──

function loadConfig(): DDLConfig {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY is required. Copy .env.template to .env and fill it in.');
    process.exit(1);
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

const collectedInsights: Insight[] = [];

async function getRelatedByText(text: string, k: number): Promise<Concept[]> {
  const results = await queryByText(text, k);
  return results.map((r) => r.concept);
}

async function collectInsight(insight: Insight): Promise<void> {
  collectedInsights.push(insight);
}

// ── Main ──

async function main() {
  const config = loadConfig();

  const conceptCount = await getConceptCount();
  console.log(`Loaded ${conceptCount} concepts from vector store.`);

  if (conceptCount < 2) {
    console.log('Not enough concepts to run pipeline. Add concepts via the dashboard or data layer.');
    console.log('Starting dashboard server...');
    createServer(parseInt(process.env.DDL_PORT || '3000'));
    return;
  }

  // 1. Run batch pipeline: pairs → puzzles → insights
  console.log(`Running batch pipeline (batchSize=${config.batchSize})...`);

  const batch = await runBatch(
    () => getRandomAntiCorrelatedPair(config.antiCorrelationWindow),
    getRelatedByText,
    dbStorePuzzle,
    collectInsight,
    config,
  );

  console.log(
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

  console.log(`Evaluating ${collectedInsights.length} insights against ${allPuzzles.length} puzzles...`);

  let added = 0;
  for (const insight of collectedInsights) {
    const puzzle = batch.puzzles.find((p) => p.id === insight.puzzleId);
    if (!puzzle) continue;

    console.log(`  Evaluating insight ${insight.id.slice(0, 8)}...`);

    const evaluation = await evaluateInsight(insight, puzzle, allPuzzles, config, (log) => {
      logGeneric(log.event, log.data);
      console.log(`    ${log.event}: ${JSON.stringify(log.data)}`);
    });

    logGeneric('insight_evaluated', {
      insightId: insight.id,
      compositeScore: evaluation.compositeScore,
      passed: evaluation.passesThreshold,
    });

    if (!evaluation.passesThreshold) {
      logInsightDiscarded(insight.id, evaluation.compositeScore, 'composite_below_threshold', {
        fertility: evaluation.fertility?.overallScore ?? 0,
        resilience: evaluation.adversarial?.overallResilience ?? 0,
        unification: evaluation.unification?.unificationScore ?? 0,
      });
      continue;
    }

    const candidate = await buildReviewCandidate(insight, puzzle, evaluation);
    addCandidate(candidate);
    added++;
  }

  console.log(`${added} candidates ready for expert review.`);

  // 3. Start dashboard
  const port = parseInt(process.env.DDL_PORT || '3000');
  createServer(port);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
