// src/evaluation/unificationScorer.ts — Explanatory unification scoring

import { claudeClient } from '../shared/claudeClient';
import { Insight, Puzzle, UnificationResult, DDLConfig } from '../shared/types';
import { UNIFICATION_SYSTEM, unificationPrompt } from './prompts';

const RELEVANCE_THRESHOLD = 6;

/**
 * Evaluate how many puzzles an insight can explain beyond its source puzzle.
 * Unification score = puzzles resolved (score >= 6) / total puzzles.
 */
export async function runUnificationCheck(
  insight: Insight,
  allPuzzles: Puzzle[],
  config: DDLConfig
): Promise<UnificationResult> {
  // Filter to validated puzzles other than the source puzzle
  const otherPuzzles = allPuzzles.filter(
    (p) => p.id !== insight.puzzleId && p.status === 'validated'
  );

  if (otherPuzzles.length === 0) {
    return { puzzlesResolved: [], unificationScore: 0 };
  }

  const client = claudeClient;

  const puzzleList = otherPuzzles.map((p) => ({
    id: p.id,
    puzzleStatement: p.puzzleStatement,
  }));

  const userPrompt = unificationPrompt(
    insight.insightStatement,
    insight.mechanism,
    puzzleList
  );

  const response = await client.messages.create({
    model: config.modelId,
    max_tokens: 2048,
    system: UNIFICATION_SYSTEM,
    messages: [{ role: 'user', content: userPrompt }],
    temperature: 0.3,
  });

  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');

  return parseUnificationResponse(text, otherPuzzles.length);
}

function parseUnificationResponse(text: string, totalPuzzles: number): UnificationResult {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Unification scorer returned no parseable JSON');
  }

  const parsed = JSON.parse(jsonMatch[0]);

  if (!Array.isArray(parsed.puzzlesResolved)) {
    throw new Error('Unification scorer returned no puzzlesResolved array');
  }

  const puzzlesResolved = parsed.puzzlesResolved.map((p: any) => ({
    puzzleId: String(p.puzzleId || ''),
    relevanceScore: clampScore(p.relevanceScore),
  }));

  const resolved = puzzlesResolved.filter(
    (p: { relevanceScore: number }) => p.relevanceScore >= RELEVANCE_THRESHOLD
  ).length;

  return {
    puzzlesResolved,
    unificationScore: totalPuzzles > 0 ? resolved / totalPuzzles : 0,
  };
}

function clampScore(value: unknown): number {
  const n = Number(value);
  if (isNaN(n)) return 1;
  return Math.max(0, Math.min(10, Math.round(n)));
}
