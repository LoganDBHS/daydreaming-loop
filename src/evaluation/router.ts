// src/evaluation/router.ts — Domain-aware routing (hard vs soft path)

import Anthropic from '@anthropic-ai/sdk';
import { Insight, EvaluationPath, DDLConfig } from '../shared/types';
import { ROUTING_SYSTEM, routingPrompt } from './prompts';

interface RoutingDecision {
  path: EvaluationPath;
  reasoning: string;
  testApproach: string | null;
}

/**
 * Determine whether an insight should take the hard path (formal verification)
 * or the soft path (heuristic evaluation). Conservative — defaults to soft.
 */
export async function routeInsight(
  insight: Insight,
  config: DDLConfig
): Promise<RoutingDecision> {
  const client = new Anthropic({ apiKey: config.anthropicApiKey });

  const userPrompt = routingPrompt(insight.insightStatement, insight.mechanism);

  const response = await client.messages.create({
    model: config.modelId,
    max_tokens: 512,
    system: ROUTING_SYSTEM,
    messages: [{ role: 'user', content: userPrompt }],
    temperature: 0.1,
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');

  return parseRoutingResponse(text);
}

function parseRoutingResponse(text: string): RoutingDecision {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { path: 'soft', reasoning: 'Could not parse routing response', testApproach: null };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    const path = parsed.path === 'hard' ? 'hard' : 'soft';
    return {
      path,
      reasoning: String(parsed.reasoning || ''),
      testApproach: path === 'hard' ? String(parsed.testApproach || '') : null,
    };
  } catch {
    return { path: 'soft', reasoning: 'JSON parse error in routing', testApproach: null };
  }
}
