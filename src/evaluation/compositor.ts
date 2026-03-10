// src/evaluation/compositor.ts — Composite score calculation

import {
  FertilityResult,
  AdversarialResult,
  UnificationResult,
  DDLConfig,
} from '../shared/types';

/**
 * Calculate the composite evaluation score.
 * composite = (fertility * 0.35) + (resilience * 0.35) + (min(unification * 10, 10) * 0.30)
 *
 * Unification score is 0-1, so we scale it to 0-10 for the composite.
 */
export function calculateCompositeScore(
  fertility: FertilityResult,
  adversarial: AdversarialResult,
  unification: UnificationResult,
  config: DDLConfig
): number {
  const { compositeWeights } = config;

  const fertilityScore = fertility.overallScore;
  const resilienceScore = adversarial.overallResilience;
  const unificationScore = Math.min(unification.unificationScore * 10, 10);

  const composite =
    fertilityScore * compositeWeights.fertility +
    resilienceScore * compositeWeights.resilience +
    unificationScore * compositeWeights.unification;

  // Round to 2 decimal places
  return Math.round(composite * 100) / 100;
}
