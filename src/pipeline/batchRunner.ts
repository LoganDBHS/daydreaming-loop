// src/pipeline/batchRunner.ts — orchestrates batch pipeline runs

import { Concept, ConceptPair, Puzzle, Insight, DDLConfig } from '../shared/types';
import { parallelMap, getConcurrency } from '../shared/concurrency';
import { generatePuzzle } from './puzzleGenerator';
import { scorePuzzleWithST, AdaptiveThreshold } from './stScorer';
import { generateInsight } from './insightGenerator';

interface BatchResult {
  puzzles: Puzzle[];
  insights: Insight[];
  stats: {
    pairsProcessed: number;
    puzzlesGenerated: number;
    puzzlesValidated: number;
    insightsGenerated: number;
  };
}

/**
 * Runs the full pipeline for a batch of concept pairs.
 * Uses dependency injection for data layer functions to stay decoupled.
 */
export async function runBatch(
  getPair: () => Promise<ConceptPair>,
  getRelated: (text: string, k: number) => Promise<Concept[]>,
  storePuzzle: (p: Puzzle) => Promise<void>,
  storeInsight: (i: Insight) => Promise<void>,
  config: DDLConfig,
  onProgress?: (current: number, total: number, phase: string) => void,
): Promise<BatchResult> {
  const concurrency = getConcurrency(config.batchSize);
  console.log(`[batch] Running with concurrency=${concurrency} for batchSize=${config.batchSize}`);

  const puzzles: Puzzle[] = [];
  const insights: Insight[] = [];
  const threshold = new AdaptiveThreshold(config.stWindowSize, config.stThresholdPercentile);

  let puzzlesGenerated = 0;
  let puzzlesCompleted = 0;

  // Fetch all pairs upfront so we can process them in parallel
  const pairs: ConceptPair[] = [];
  for (let i = 0; i < config.batchSize; i++) {
    pairs.push(await getPair());
    if ((i + 1) % 50 === 0 || i === config.batchSize - 1) {
      onProgress?.(i + 1, config.batchSize, 'Fetching concept pairs');
    }
  }

  // Phase 1: Generate puzzles and score them in parallel
  onProgress?.(0, pairs.length, 'Generating puzzles');
  const pairResults = await parallelMap(
    pairs,
    async (pair) => {
      // Generate puzzle
      const { puzzle } = await generatePuzzle(pair, config.modelId);
      if (!puzzle) {
        puzzlesCompleted++;
        onProgress?.(puzzlesCompleted, pairs.length, 'Generating puzzles');
        return null;
      }

      // Score with Simplicity Theory
      const stScore = await scorePuzzleWithST(puzzle.puzzleStatement, config.modelId);
      puzzle.stScore = {
        descriptionComplexity: stScore.C,
        generationComplexity: stScore.Cv,
        unexpectedness: stScore.U,
      };

      puzzlesCompleted++;
      onProgress?.(puzzlesCompleted, pairs.length, 'Generating puzzles');
      return { pair, puzzle, uScore: stScore.U };
    },
    concurrency,
  );

  // Apply adaptive threshold sequentially (order-dependent)
  const validatedWork: Array<{ pair: ConceptPair; puzzle: Puzzle }> = [];
  for (const result of pairResults) {
    if (!result) continue;
    puzzlesGenerated++;

    const { pair, puzzle, uScore } = result;
    threshold.push(uScore);

    if (threshold.passes(uScore)) {
      puzzle.status = 'validated';
      validatedWork.push({ pair, puzzle });
    }

    await storePuzzle(puzzle);
    puzzles.push(puzzle);
  }

  // Phase 2: Generate insights for validated puzzles in parallel
  let insightsCompleted = 0;
  onProgress?.(0, validatedWork.length, 'Generating insights');
  const insightResults = await parallelMap(
    validatedWork,
    async ({ pair, puzzle }) => {
      const enrichment = await getRelated(puzzle.puzzleStatement, 5);

      const insight = await generateInsight(
        puzzle,
        pair.conceptA.text,
        pair.conceptB.text,
        enrichment,
        config.modelId,
      );

      insightsCompleted++;
      onProgress?.(insightsCompleted, validatedWork.length, 'Generating insights');

      if (insight) {
        await storeInsight(insight);
        return insight;
      }
      return null;
    },
    concurrency,
  );

  for (const insight of insightResults) {
    if (insight) insights.push(insight);
  }

  return {
    puzzles,
    insights,
    stats: {
      pairsProcessed: pairs.length,
      puzzlesGenerated,
      puzzlesValidated: puzzles.filter((p) => p.status === 'validated').length,
      insightsGenerated: insights.length,
    },
  };
}
