// src/evaluation/fertilityChecker.ts — Predictive fertility evaluation

import Anthropic from '@anthropic-ai/sdk';
import { Insight, Puzzle, FertilityResult, DDLConfig } from '../shared/types';
import { FERTILITY_SYSTEM, fertilityPrompt } from './prompts';

/**
 * Evaluate the predictive fertility of an insight.
 * Asks Claude to generate 3-5 novel, specific, falsifiable predictions.
 * Returns predictions with scores and an overall fertility score.
 */
export async function runFertilityCheck(
  insight: Insight,
  puzzle: Puzzle,
  config: DDLConfig
): Promise<FertilityResult> {
  const client = new Anthropic({ apiKey: config.anthropicApiKey });

  const userPrompt = fertilityPrompt(
    insight.insightStatement,
    insight.mechanism,
    puzzle.puzzleStatement
  );

  const response = await client.messages.create({
    model: config.modelId,
    max_tokens: 2048,
    system: FERTILITY_SYSTEM,
    messages: [{ role: 'user', content: userPrompt }],
    temperature: 0.4,
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');

  return parseFertilityResponse(text);
}

function parseFertilityResponse(text: string): FertilityResult {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Fertility checker returned no parseable JSON');
  }

  const parsed = JSON.parse(jsonMatch[0]);

  if (!Array.isArray(parsed.predictions)) {
    throw new Error('Fertility checker returned no predictions array');
  }

  const predictions = parsed.predictions.map((p: any) => ({
    prediction: String(p.prediction || ''),
    specificity: clampScore(p.specificity),
    independence: clampScore(p.independence),
    checkability: clampScore(p.checkability),
  }));

  return {
    predictions,
    overallScore: clampScore(parsed.overallScore),
  };
}

function clampScore(value: unknown): number {
  const n = Number(value);
  if (isNaN(n)) return 1;
  return Math.max(0, Math.min(10, Math.round(n)));
}
