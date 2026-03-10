// src/pipeline/insightGenerator.ts — insight generation via Claude API

import Anthropic from '@anthropic-ai/sdk';
import { randomUUID } from 'node:crypto';
import { Concept, Puzzle, Insight } from '../shared/types';
import { INSIGHT_SYSTEM_PROMPT, insightUserPrompt } from './prompts';

const client = new Anthropic();

/**
 * Given a validated puzzle and optional enrichment concepts,
 * generate an insight that resolves it. Returns null if no genuine insight found.
 */
export async function generateInsight(
  puzzle: Puzzle,
  sourceConceptA: string,
  sourceConceptB: string,
  enrichmentConcepts: Concept[] = [],
  modelId?: string
): Promise<Insight | null> {
  const enrichmentTexts = enrichmentConcepts.map((c) => c.text);

  const userPrompt = insightUserPrompt(
    puzzle.puzzleStatement,
    puzzle.whyHardToExplain,
    sourceConceptA,
    sourceConceptB,
    enrichmentTexts
  );

  const response = await client.messages.create({
    model: modelId ?? 'claude-opus-4-6-20250219',
    max_tokens: 2048,
    system: INSIGHT_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const raw = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('\n');

  // Escape valve
  if (raw.includes('NO INSIGHT FOUND')) {
    return null;
  }

  // Parse structured output
  const insightMatch = raw.match(/INSIGHT:\s*(.+?)(?:\n|$)/s);
  const mechanismMatch = raw.match(/MECHANISM:\s*(.+?)(?:\n|$)/s);
  const resolvesMatch = raw.match(/RESOLVES:\s*(.+?)(?:\n|$)/s);
  const predictionsMatch = raw.match(/PREDICTIONS:\s*\n((?:- .+\n?)+)/);

  if (!insightMatch || !mechanismMatch) {
    return null;
  }

  const predictions = predictionsMatch
    ? predictionsMatch[1]
        .split('\n')
        .map((line) => line.replace(/^- /, '').trim())
        .filter(Boolean)
    : [];

  const insight: Insight = {
    id: randomUUID(),
    puzzleId: puzzle.id,
    insightStatement: insightMatch[1].trim(),
    mechanism: mechanismMatch[1].trim(),
    howItResolvesPuzzle: resolvesMatch?.[1]?.trim() ?? '',
    initialPredictions: predictions,
    enrichmentConceptIds: enrichmentConcepts.map((c) => c.id),
    createdAt: new Date(),
  };

  return insight;
}
