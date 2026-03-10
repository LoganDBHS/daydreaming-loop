// src/evaluation/index.ts — public exports for the evaluation engine

// Main entry point
export { evaluateInsight } from './evaluateInsight';

// Individual stages (for direct use if needed)
export { routeInsight } from './router';
export { runFormalVerification } from './formalVerifier';
export { runFertilityCheck } from './fertilityChecker';
export { runAdversarialCritic } from './adversarialCritic';
export { runUnificationCheck } from './unificationScorer';
export { runNoveltySearch } from './noveltySearcher';
export { runGroundingCheck } from './groundingChecker';
export { calculateCompositeScore } from './compositor';

// Convenience exports per CLAUDE.md contract
export { runNoveltySearch as checkNovelty } from './noveltySearcher';
export { runGroundingCheck as checkGrounding } from './groundingChecker';
