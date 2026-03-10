// src/data/embedder.ts — Local embedding generation via Xenova/Transformers
//
// Uses all-MiniLM-L6-v2 running locally — no API key needed for embeddings.
// Only ANTHROPIC_API_KEY is required (by the pipeline module for LLM calls).

// @ts-expect-error — @xenova/transformers ships JS, no declaration file
import { pipeline } from "@xenova/transformers";

let extractor: any = null;

async function getExtractor(): Promise<any> {
  if (!extractor) {
    extractor = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
  }
  return extractor;
}

/**
 * Generate an embedding for a single text.
 */
export async function embed(text: string): Promise<number[]> {
  const ext = await getExtractor();
  const output = await ext(text, { pooling: "mean", normalize: true });
  return Array.from(output.data as Float32Array);
}

/**
 * Generate embeddings for multiple texts in a single batch.
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];

  const ext = await getExtractor();
  const output = await ext(texts, { pooling: "mean", normalize: true });

  const dim = output.dims[1];
  const data = output.data as Float32Array;
  const results: number[][] = [];
  for (let i = 0; i < texts.length; i++) {
    results.push(Array.from(data.slice(i * dim, (i + 1) * dim)));
  }
  return results;
}
