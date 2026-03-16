// src/evaluation/adversarialCritic.ts — adversarial stress test for insights

import { claudeClient } from '../shared/claudeClient';
import { Insight, Puzzle, AdversarialResult, DDLConfig } from '../shared/types';
import { ADVERSARIAL_SYSTEM, adversarialPrompt } from './prompts';

const ATTACK_VECTORS = [
  'logical_coherence',
  'counterexamples',
  'established_knowledge',
  'simpler_explanation',
  'unfalsifiability',
  'rhetorical_mimicry',
] as const;

/**
 * Run the adversarial stress test against an insight.
 * This critic is intentionally harsh — its only job is to destroy the insight.
 * Returns a resilience score (how well the insight survived) and individual attack findings.
 */
export async function runAdversarialCritic(
  insight: Insight,
  puzzle: Puzzle,
  config: DDLConfig
): Promise<AdversarialResult> {
  const client = claudeClient;

  const userPrompt = adversarialPrompt(
    insight.insightStatement,
    insight.mechanism,
    insight.howItResolvesPuzzle,
    puzzle.puzzleStatement
  );

  const response = await client.messages.create({
    model: config.modelId,
    max_tokens: 2048,
    system: ADVERSARIAL_SYSTEM,
    messages: [{ role: 'user', content: userPrompt }],
    temperature: 0.3, // low temp for consistent, rigorous critique
  });

  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');

  return parseAdversarialResponse(text);
}

function parseAdversarialResponse(text: string): AdversarialResult {
  // Extract JSON from the response (may be wrapped in markdown fences)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Adversarial critic returned no parseable JSON');
  }

  const parsed = JSON.parse(jsonMatch[0]);

  // Validate and normalize the attacks array
  const attacks = validateAttacks(parsed.attacks);
  const overallResilience = clampScore(parsed.overallResilience);

  return { attacks, overallResilience };
}

function validateAttacks(
  rawAttacks: unknown[]
): AdversarialResult['attacks'] {
  if (!Array.isArray(rawAttacks)) {
    throw new Error('Adversarial critic returned no attacks array');
  }

  // Build a map of returned attacks by vector name
  const attackMap = new Map<string, { severity: number; finding: string }>();
  for (const attack of rawAttacks) {
    if (attack && typeof attack === 'object' && 'vector' in attack) {
      const a = attack as { vector: string; severity: number; finding: string };
      attackMap.set(a.vector, {
        severity: clampScore(a.severity),
        finding: String(a.finding || 'No finding provided'),
      });
    }
  }

  // Ensure all six vectors are present — missing ones get max severity
  // (if the critic didn't even bother attacking a vector, assume it's because
  // the insight was so weak it wasn't worth the effort)
  return ATTACK_VECTORS.map((vector) => {
    const found = attackMap.get(vector);
    if (found) {
      return { vector, severity: found.severity, finding: found.finding };
    }
    return {
      vector,
      severity: 8,
      finding: 'Attack vector not evaluated by critic — defaulting to high severity',
    };
  });
}

function clampScore(value: unknown): number {
  const n = Number(value);
  if (isNaN(n)) return 1;
  return Math.max(0, Math.min(10, Math.round(n)));
}
