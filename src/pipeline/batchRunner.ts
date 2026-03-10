// src/pipeline/batchRunner.ts — orchestrates batch pipeline runs

import { Concept, ConceptPair, Puzzle, Insight, DDLConfig } from '../shared/types';
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
  config: DDLConfig
): Promise<BatchResult> {
  const puzzles: Puzzle[] = [];
  const insights: Insight[] = [];
  const threshold = new AdaptiveThreshold(config.stWindowSize, config.stThresholdPercentile);

  let pairsProcessed = 0;
  let puzzlesGenerated = 0;

  for (let i = 0; i < config.batchSize; i++) {
    pairsProcessed++;

    // 1. Get a concept pair
    const pair = await getPair();

    // 2. Generate puzzle
    const { puzzle } = await generatePuzzle(pair, config.modelId);
    if (!puzzle) continue;
    puzzlesGenerated++;

    // 3. Score with Simplicity Theory
    const stScore = await scorePuzzleWithST(puzzle.puzzleStatement, config.modelId);
    puzzle.stScore = {
      descriptionComplexity: stScore.C,
      generationComplexity: stScore.Cv,
      unexpectedness: stScore.U,
    };

    // Track U-score in adaptive threshold window
    threshold.push(stScore.U);

    // 4. Validate against adaptive threshold
    if (threshold.passes(stScore.U)) {
      puzzle.status = 'validated';
    }

    await storePuzzle(puzzle);
    puzzles.push(puzzle);

    // 5. For validated puzzles, generate insights
    if (puzzle.status === 'validated') {
      // Fetch enrichment concepts related to the puzzle
      const enrichment = await getRelated(puzzle.puzzleStatement, 5);

      const insight = await generateInsight(
        puzzle,
        pair.conceptA.text,
        pair.conceptB.text,
        enrichment,
        config.modelId
      );

      if (insight) {
        await storeInsight(insight);
        insights.push(insight);
      }
    }
  }

  return {
    puzzles,
    insights,
    stats: {
      pairsProcessed,
      puzzlesGenerated,
      puzzlesValidated: puzzles.filter((p) => p.status === 'validated').length,
      insightsGenerated: insights.length,
    },
  };
}
