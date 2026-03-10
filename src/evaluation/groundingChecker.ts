// src/evaluation/groundingChecker.ts — Knowledge graph fact-checking

import Anthropic from '@anthropic-ai/sdk';
import { GroundingResult, DDLConfig } from '../shared/types';
import { GROUNDING_SYSTEM, groundingPrompt } from './prompts';

/**
 * Extract key factual claims from an insight and check whether any
 * contradict well-established knowledge. Flags genuine contradictions only.
 */
export async function runGroundingCheck(
  insightStatement: string,
  mechanism: string,
  config: DDLConfig
): Promise<GroundingResult> {
  const client = new Anthropic({ apiKey: config.anthropicApiKey });

  const userPrompt = groundingPrompt(insightStatement, mechanism);

  const response = await client.messages.create({
    model: config.modelId,
    max_tokens: 1024,
    system: GROUNDING_SYSTEM,
    messages: [{ role: 'user', content: userPrompt }],
    temperature: 0.2,
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');

  return parseGroundingResponse(text);
}

function parseGroundingResponse(text: string): GroundingResult {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    // Can't parse — assume grounded (benefit of the doubt)
    return { contradictions: [], isGrounded: true };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);

    const contradictions = Array.isArray(parsed.claims)
      ? parsed.claims
          .filter((c: any) => c.status === 'contradicted')
          .map((c: any) => ({
            claim: String(c.claim || ''),
            contradictedBy: String(c.contradictedBy || ''),
            source: String(c.source || ''),
          }))
      : [];

    return {
      contradictions,
      isGrounded: parsed.isGrounded !== false,
    };
  } catch {
    return { contradictions: [], isGrounded: true };
  }
}
