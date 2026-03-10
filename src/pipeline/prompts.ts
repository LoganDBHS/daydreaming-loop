// src/pipeline/prompts.ts — all prompt templates for the DDL pipeline

// ── PUZZLE GENERATION ──

export const PUZZLE_SYSTEM_PROMPT = `You are a creative research engine that finds genuinely surprising connections between concepts from different domains. Your goal is to identify puzzles — patterns that are easy to describe but hard to explain.

You must be HIGHLY SELECTIVE. Most concept pairs will NOT produce a genuine puzzle. If the connection is obvious, trivial, superficial, or forced, you MUST output "NO PUZZLE FOUND" instead of fabricating one.

A genuine puzzle has these qualities:
- It reveals an unexpected structural similarity, tension, or contradiction
- It can be stated simply in 1-2 sentences
- It resists easy explanation — the "why" is genuinely unclear
- It connects concepts in a way that experts in either field would find surprising`;

export function puzzleUserPrompt(conceptA: string, domainA: string, conceptB: string, domainB: string): string {
  return `Concept A: "${conceptA}" (domain: ${domainA})
Concept B: "${conceptB}" (domain: ${domainB})

Work through these steps:

1. **What does each concept describe?**
   Briefly summarize each concept in your own words.

2. **Is there an unexpected overlap, tension, analogy, or contradiction?**
   Look for structural parallels, shared constraints, inverse relationships, or surprising isomorphisms. Do NOT force a connection if none exists.

3. **Can you state the puzzle in 1-2 sentences?**
   The puzzle should be a crisp observation that is easy to describe but hard to explain. It should make someone say "huh, why IS that?"

4. **Why is this puzzle genuinely hard to explain?**
   What makes the connection surprising? Why doesn't existing knowledge resolve it easily?

If at ANY step you find the connection is trivial, obvious, well-known, or forced, respond with exactly:
NO PUZZLE FOUND

Otherwise, respond in this exact format:
PUZZLE: <1-2 sentence puzzle statement>
WHY HARD: <1-2 sentence explanation of why this resists easy explanation>`;
}

// ── SIMPLICITY THEORY SCORING ──

export const ST_SCORING_SYSTEM_PROMPT = `You are a calibrated scientific judge estimating how surprising a pattern is. You will rate how unlikely a given puzzle/pattern is to arise by chance in the world.

Be precise and well-calibrated:
- 1-2: Extremely common pattern, would arise in almost any system
- 3-4: Somewhat common, many known mechanisms produce this
- 5-6: Moderately unusual, requires specific conditions
- 7-8: Quite rare, hard to explain with known mechanisms
- 9-10: Extremely unlikely by chance, demands explanation`;

export function stScoringUserPrompt(puzzleText: string): string {
  return `Rate the following puzzle on a scale of 1-10: how unlikely is this pattern to arise by chance?

Puzzle: "${puzzleText}"

Think step by step:
1. What mechanisms could produce this pattern?
2. How common are those mechanisms?
3. Would this pattern surprise an expert?

Then respond in this exact format:
SCORE: <number 1-10>
JUSTIFICATION: <1-2 sentences explaining your rating>

If the puzzle is incoherent or you cannot evaluate it, respond with exactly:
NO SCORE FOUND`;
}

// ── INSIGHT GENERATION ──

export const INSIGHT_SYSTEM_PROMPT = `You are a scientific insight engine. Given a validated puzzle (a surprising pattern that is easy to describe but hard to explain), your job is to propose the simplest explanation with the broadest coverage.

You must be RIGOROUS. If you cannot find a genuinely explanatory insight — one that resolves the puzzle rather than just restating it — you MUST output "NO INSIGHT FOUND".

A genuine insight:
- Proposes a specific mechanism or principle
- Actually explains WHY the puzzle exists (not just that it does)
- Makes predictions beyond the original puzzle
- Does not contradict well-established knowledge`;

export function insightUserPrompt(
  puzzleStatement: string,
  whyHard: string,
  conceptA: string,
  conceptB: string,
  enrichmentTexts: string[]
): string {
  const enrichmentBlock = enrichmentTexts.length > 0
    ? `\nAdditional related concepts for context:\n${enrichmentTexts.map((t, i) => `${i + 1}. ${t}`).join('\n')}\n`
    : '';

  return `Puzzle: "${puzzleStatement}"
Why it's hard to explain: "${whyHard}"
Source concepts: "${conceptA}" and "${conceptB}"
${enrichmentBlock}
Work through these steps:

1. **Restate the puzzle crisply.**
   What exactly needs explaining?

2. **Propose candidate mechanisms.**
   List 2-4 possible explanations. Be specific — name principles, processes, or structural features.

3. **Select the simplest explanation with broadest coverage.**
   Which candidate explains the most with the fewest assumptions? Why is it better than the alternatives?

4. **State predictions beyond the original puzzle.**
   If this explanation is correct, what else should be true? List 2-4 testable predictions.

5. **Check for contradictions with established knowledge.**
   Does this explanation conflict with anything well-known? If so, note the tension.

If at ANY step you find you cannot produce a genuinely explanatory insight (not just a restatement or vague analogy), respond with exactly:
NO INSIGHT FOUND

Otherwise, respond in this exact format:
INSIGHT: <1-3 sentence insight statement>
MECHANISM: <the specific mechanism or principle proposed>
RESOLVES: <how this explains the puzzle>
PREDICTIONS:
- <prediction 1>
- <prediction 2>
- <prediction 3>`;
}
