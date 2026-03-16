// src/shared/concurrency.ts — Concurrency limiter for parallel Claude CLI calls

import { cpus } from 'node:os';

/**
 * Calculate concurrency based on batch size.
 * Scales up with larger batches, capped by CPU cores.
 *
 *   batchSize 1-3   → 2 workers
 *   batchSize 4-8   → 4 workers
 *   batchSize 9-15  → 6 workers
 *   batchSize 16+   → 8 workers (or CPU count, whichever is less)
 *
 * Override with DDL_CONCURRENCY env var.
 */
export function getConcurrency(batchSize: number): number {
  const envOverride = process.env.DDL_CONCURRENCY;
  if (envOverride) {
    const n = parseInt(envOverride, 10);
    if (n > 0) return n;
  }

  const maxCores = cpus().length;

  let concurrency: number;
  if (batchSize <= 3) concurrency = 2;
  else if (batchSize <= 8) concurrency = 4;
  else if (batchSize <= 15) concurrency = 6;
  else concurrency = 8;

  return Math.min(concurrency, maxCores, batchSize);
}

/**
 * Runs async tasks with a concurrency limit.
 * Like Promise.all but only runs `limit` tasks at a time.
 */
export async function parallelMap<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  limit: number,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const i = nextIndex++;
      results[i] = await fn(items[i], i);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
