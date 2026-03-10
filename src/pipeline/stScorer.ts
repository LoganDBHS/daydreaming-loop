// src/pipeline/stScorer.ts — Simplicity Theory scoring

import Anthropic from '@anthropic-ai/sdk';
// @ts-ignore — zstd-codec has no type declarations
import { ZstdCodec } from 'zstd-codec';
import { ST_SCORING_SYSTEM_PROMPT, stScoringUserPrompt } from './prompts';

const client = new Anthropic();

interface STScore {
  C: number;   // description complexity (compression ratio, 0-1)
  Cv: number;  // generation complexity (Claude rating, normalized 0-1)
  U: number;   // unexpectedness = Cv - C
}

/** Compress text with zstd and return ratio (compressed / original). Lower = more compressible = simpler. */
async function compressionRatio(text: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ZstdCodec.run((zstd: any) => {
      try {
        const simple = new zstd.Simple();
        const input = Buffer.from(text, 'utf-8');
        const compressed = simple.compress(input, 3); // level 3
        resolve(compressed.length / input.length);
      } catch (err) {
        reject(err);
      }
    });
  });
}

/** Ask Claude to rate generation complexity (how unlikely this pattern is by chance). */
async function rateGenerationComplexity(
  puzzleText: string,
  modelId?: string
): Promise<number | null> {
  const response = await client.messages.create({
    model: modelId ?? 'claude-opus-4-6-20250219',
    max_tokens: 512,
    system: ST_SCORING_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: stScoringUserPrompt(puzzleText) }],
  });

  const raw = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n');

  if (raw.includes('NO SCORE FOUND')) {
    return null;
  }

  const match = raw.match(/SCORE:\s*(\d+(?:\.\d+)?)/);
  if (!match) return null;

  const score = parseFloat(match[1]);
  if (score < 1 || score > 10) return null;
  return score;
}

/**
 * Score a puzzle using Simplicity Theory: U = Cv_normalized - C_normalized
 * C = compression ratio (already 0-1)
 * Cv = Claude's generation complexity rating / 10 (normalized to 0-1)
 */
export async function scorePuzzleWithST(
  puzzleText: string,
  modelId?: string
): Promise<STScore> {
  const [C, cvRaw] = await Promise.all([
    compressionRatio(puzzleText),
    rateGenerationComplexity(puzzleText, modelId),
  ]);

  const Cv = cvRaw !== null ? cvRaw / 10 : 0;
  const U = Cv - C;

  return { C, Cv, U };
}

// ── Adaptive threshold ──

/** Maintains a rolling window of U-scores and computes the adaptive threshold. */
export class AdaptiveThreshold {
  private window: number[];
  private readonly maxSize: number;
  private readonly percentile: number;

  constructor(windowSize: number, percentile: number = 0.95) {
    this.window = [];
    this.maxSize = windowSize;
    this.percentile = percentile;
  }

  /** Add a new U-score to the window. */
  push(u: number): void {
    this.window.push(u);
    if (this.window.length > this.maxSize) {
      this.window.shift();
    }
  }

  /** Get current threshold (95th percentile of window). Returns 0 if window is too small. */
  get threshold(): number {
    if (this.window.length < 5) return 0; // need minimum data
    const sorted = [...this.window].sort((a, b) => a - b);
    const idx = Math.floor(sorted.length * this.percentile);
    return sorted[Math.min(idx, sorted.length - 1)];
  }

  /** Check if a U-score exceeds the adaptive threshold. */
  passes(u: number): boolean {
    return u >= this.threshold;
  }
}
