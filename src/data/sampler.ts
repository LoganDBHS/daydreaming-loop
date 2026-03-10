// src/data/sampler.ts — Anti-correlated concept pair sampling

import type { Concept, ConceptPair } from "../shared/types.js";
import { getAllConcepts, getConceptCount } from "./vectorStore.js";

/**
 * Cosine similarity between two vectors.
 * Returns value in [-1, 1] where -1 = opposite, 0 = orthogonal, 1 = identical.
 */
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}

/**
 * Anti-correlated sampling algorithm:
 * 1. Pick a random concept from the database
 * 2. Compute cosine similarity of ALL other concepts to it
 * 3. Sort by ascending similarity (most distant first)
 * 4. Sample from the bottom N% of the similarity distribution
 * 5. Return the pair with their cosine similarity score
 *
 * @param windowPercent - Bottom percentage to sample from (0.0-1.0, default 0.2 = 20%)
 */
export async function getRandomAntiCorrelatedPair(
  windowPercent: number = 0.2
): Promise<ConceptPair> {
  const count = await getConceptCount();
  if (count < 2) {
    throw new Error(`Need at least 2 concepts for sampling, have ${count}`);
  }

  const allConcepts = await getAllConcepts();

  // Step 1: Pick a random concept
  const pivotIndex = Math.floor(Math.random() * allConcepts.length);
  const pivot = allConcepts[pivotIndex];

  // Step 2: Compute similarities to all other concepts
  const others = allConcepts.filter((_, i) => i !== pivotIndex);
  const scored = others.map((concept) => ({
    concept,
    similarity: cosineSimilarity(pivot.embedding, concept.embedding),
  }));

  // Step 3: Sort ascending (most distant / anti-correlated first)
  scored.sort((a, b) => a.similarity - b.similarity);

  // Step 4: Sample from bottom N% window
  const windowSize = Math.max(1, Math.floor(scored.length * windowPercent));
  const candidates = scored.slice(0, windowSize);
  const chosen = candidates[Math.floor(Math.random() * candidates.length)];

  // Step 5: Return pair
  return {
    conceptA: pivot,
    conceptB: chosen.concept,
    cosineSimilarity: chosen.similarity,
  };
}

/**
 * Get concepts most related to a given text query.
 * Uses cosine similarity against all stored concepts.
 */
export async function getRelatedConcepts(
  queryEmbedding: number[],
  topK: number = 5
): Promise<Concept[]> {
  const allConcepts = await getAllConcepts();
  if (allConcepts.length === 0) return [];

  const scored = allConcepts.map((concept) => ({
    concept,
    similarity: cosineSimilarity(queryEmbedding, concept.embedding),
  }));

  scored.sort((a, b) => b.similarity - a.similarity);
  return scored.slice(0, topK).map((s) => s.concept);
}
