// src/pipeline/puzzleGenerator.ts — puzzle generation via Claude API

import { randomUUID } from 'node:crypto';
import { ConceptPair, Puzzle } from '../shared/types';
import { PUZZLE_SYSTEM_PROMPT, puzzleUserPrompt } from './prompts';
import { claudeClient } from '../shared/claudeClient';

const client = claudeClient;

interface GeneratePuzzleResult {
  puzzle: Puzzle | null;
  raw: string;
}

/**
 * Takes a concept pair, asks Claude to find a genuine puzzle, and parses the result.
 * Returns null puzzle if no genuine connection is found (the escape valve fired).
 */
export async function generatePuzzle(
  pair: ConceptPair,
  modelId?: string
): Promise<GeneratePuzzleResult> {
  const userPrompt = puzzleUserPrompt(
    pair.conceptA.text,
    pair.conceptA.domain,
    pair.conceptB.text,
    pair.conceptB.domain
  );

  const response = await client.messages.create({
    model: modelId ?? 'claude-opus-4-6-20250219',
    max_tokens: 1024,
    system: PUZZLE_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const raw = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');

  // Escape valve: no genuine puzzle found
  if (raw.includes('NO PUZZLE FOUND')) {
    return { puzzle: null, raw };
  }

  // Parse structured output
  const puzzleMatch = raw.match(/PUZZLE:\s*(.+?)(?:\n|$)/s);
  const whyHardMatch = raw.match(/WHY HARD:\s*(.+?)(?:\n|$)/s);

  if (!puzzleMatch) {
    return { puzzle: null, raw };
  }

  const puzzle: Puzzle = {
    id: randomUUID(),
    conceptPairIds: [pair.conceptA.id, pair.conceptB.id],
    puzzleStatement: puzzleMatch[1].trim(),
    whyHardToExplain: whyHardMatch?.[1]?.trim() ?? '',
    stScore: {
      descriptionComplexity: 0,
      generationComplexity: 0,
      unexpectedness: 0,
    },
    createdAt: new Date(),
    status: 'discarded', // starts discarded until ST scoring validates it
  };

  return { puzzle, raw };
}
