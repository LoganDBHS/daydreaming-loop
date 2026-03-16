// src/evaluation/evaluateInsight.ts — Top-level evaluation orchestrator
// This is the single entry point for evaluating an insight through
// the full multi-stage pipeline.

import { Insight, Puzzle, EvaluationResult, DDLConfig } from '../shared/types';
import { routeInsight } from './router';
import { runFormalVerification } from './formalVerifier';
import { runFertilityCheck } from './fertilityChecker';
import { runAdversarialCritic } from './adversarialCritic';
import { runUnificationCheck } from './unificationScorer';
import { runNoveltySearch } from './noveltySearcher';
import { runGroundingCheck } from './groundingChecker';
import { calculateCompositeScore } from './compositor';

export interface EvaluationLog {
  event: string;
  data: Record<string, unknown>;
}

/**
 * Run the full multi-stage evaluation pipeline on an insight.
 *
 * Flow:
 * 1. Route (hard vs soft)
 * 2. Hard path: formal verification → if pass, skip soft; if fail, discard; if inconclusive, fall through
 * 3. Soft path: fertility → adversarial → unification → composite (with early termination)
 * 4. Both paths: novelty search + grounding check
 */
export async function evaluateInsight(
  insight: Insight,
  puzzle: Puzzle,
  allPuzzles: Puzzle[],
  config: DDLConfig,
  onLog?: (log: EvaluationLog) => void,
): Promise<EvaluationResult> {
  const log = (event: string, data: Record<string, unknown>) => {
    onLog?.({ event, data: { insightId: insight.id, ...data } });
  };

  // Step 1: Route
  const routing = await routeInsight(insight, config);
  log('insight_routed', { path: routing.path, reasoning: routing.reasoning });

  // Step 2: Hard path
  if (routing.path === 'hard' && routing.testApproach) {
    try {
      const verification = await runFormalVerification(insight, routing.testApproach, config);
      log('formal_verification', { passed: verification.passed });

      if (verification.passed) {
        // Formally verified — high confidence, skip soft eval
        const [novelty, grounding] = await Promise.all([
          runNoveltySearch(insight.insightStatement, config),
          runGroundingCheck(insight.insightStatement, insight.mechanism, config),
        ]);

        return {
          insightId: insight.id,
          path: 'hard',
          formalVerification: verification,
          novelty,
          grounding,
          compositeScore: 9,
          passesThreshold: true,
        };
      }

      if (!verification.passed && !verification.output.includes('INCONCLUSIVE')) {
        // Formally falsified — discard
        const [novelty, grounding] = await Promise.all([
          runNoveltySearch(insight.insightStatement, config),
          runGroundingCheck(insight.insightStatement, insight.mechanism, config),
        ]);

        return {
          insightId: insight.id,
          path: 'hard',
          formalVerification: verification,
          novelty,
          grounding,
          compositeScore: 0,
          passesThreshold: false,
        };
      }

      // Inconclusive — fall through to soft path
      log('formal_verification_inconclusive', {});
    } catch (err: any) {
      log('formal_verification_error', { error: err.message });
    }
  }

  // Step 3: Soft path with early termination

  // 3a: Fertility
  const fertility = await runFertilityCheck(insight, puzzle, config);
  log('fertility_checked', { score: fertility.overallScore });

  if (fertility.overallScore < config.fertilityThreshold) {
    log('fertility_below_threshold', { score: fertility.overallScore, threshold: config.fertilityThreshold });
    // Early termination — still run novelty/grounding for logging
    const [novelty, grounding] = await Promise.all([
      runNoveltySearch(insight.insightStatement, config),
      runGroundingCheck(insight.insightStatement, insight.mechanism, config),
    ]);

    return {
      insightId: insight.id,
      path: 'soft',
      fertility,
      novelty,
      grounding,
      compositeScore: fertility.overallScore * config.compositeWeights.fertility,
      passesThreshold: false,
    };
  }

  // 3b: Adversarial
  const adversarial = await runAdversarialCritic(insight, puzzle, config);
  log('adversarial_tested', { resilience: adversarial.overallResilience });

  if (adversarial.overallResilience < config.resilienceThreshold) {
    log('resilience_below_threshold', { score: adversarial.overallResilience, threshold: config.resilienceThreshold });
    const [novelty, grounding] = await Promise.all([
      runNoveltySearch(insight.insightStatement, config),
      runGroundingCheck(insight.insightStatement, insight.mechanism, config),
    ]);

    return {
      insightId: insight.id,
      path: 'soft',
      fertility,
      adversarial,
      novelty,
      grounding,
      compositeScore: calculateCompositeScore(
        fertility,
        adversarial,
        { puzzlesResolved: [], unificationScore: 0 },
        config
      ),
      passesThreshold: false,
    };
  }

  // 3c: Unification, novelty, and grounding can run in parallel
  const [unification, novelty, grounding] = await Promise.all([
    runUnificationCheck(insight, allPuzzles, config),
    runNoveltySearch(insight.insightStatement, config),
    runGroundingCheck(insight.insightStatement, insight.mechanism, config),
  ]);

  log('unification_checked', {
    score: unification.unificationScore,
    puzzlesResolved: unification.puzzlesResolved.filter((p) => p.relevanceScore >= 6).length,
  });

  // 3d: Composite
  const compositeScore = calculateCompositeScore(fertility, adversarial, unification, config);
  log('composite_calculated', { compositeScore, threshold: config.compositeThreshold });

  return {
    insightId: insight.id,
    path: 'soft',
    fertility,
    adversarial,
    unification,
    novelty,
    grounding,
    compositeScore,
    passesThreshold: compositeScore >= config.compositeThreshold,
  };
}
