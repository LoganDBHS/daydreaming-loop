// src/evaluation/prompts.ts — all evaluation prompt templates

// ── DOMAIN ROUTING ──

export const ROUTING_SYSTEM = `You are a domain classification expert. Your ONLY job is to determine whether a proposed insight can be formally tested through code execution, mathematical proof, simulation, or data query.

You must be conservative: only route to the "hard" path if there is a clear, concrete formal test. Vague testability does not count.`;

export function routingPrompt(insightStatement: string, mechanism: string): string {
  return `Analyze this insight and determine if it can be formally verified:

INSIGHT: ${insightStatement}
MECHANISM: ${mechanism}

Can this insight be tested through any of these methods?
1. Writing and executing code that would confirm or falsify it
2. Constructing a mathematical proof or disproof
3. Running a simulation that would produce expected vs actual results
4. Querying an existing dataset for confirming/disconfirming evidence

Respond in JSON:
{
  "path": "hard" | "soft",
  "reasoning": "one sentence explaining why",
  "testApproach": "if hard, describe the test in one sentence; if soft, null"
}`;
}

// ── FORMAL VERIFICATION (HARD PATH) ──

export const FORMAL_VERIFICATION_SYSTEM = `You are an expert programmer and verification specialist. Write minimal, focused test code that directly tests the given insight. The code must be self-contained Node.js that can run without external dependencies beyond the standard library. Print PASS or FAIL as the final output line.`;

export function formalVerificationPrompt(
  insightStatement: string,
  mechanism: string,
  testApproach: string
): string {
  return `Write executable Node.js code to formally test this insight.

INSIGHT: ${insightStatement}
MECHANISM: ${mechanism}
TEST APPROACH: ${testApproach}

Requirements:
- Self-contained Node.js (no npm packages)
- Must print exactly "PASS" or "FAIL" as the last line of stdout
- If the test is inconclusive, print "INCONCLUSIVE"
- Keep it under 100 lines
- Include comments explaining what is being tested

Return ONLY the code, no markdown fences.`;
}

// ── PREDICTIVE FERTILITY ──

export const FERTILITY_SYSTEM = `You are a scientific prediction analyst. Your job is to extract concrete, falsifiable predictions from proposed insights. You value specificity over quantity — vague predictions are worthless.`;

export function fertilityPrompt(
  insightStatement: string,
  mechanism: string,
  puzzleStatement: string
): string {
  return `Given this insight and the puzzle it addresses, generate 3-5 novel, specific, falsifiable predictions that would follow IF the insight is correct.

PUZZLE: ${puzzleStatement}
INSIGHT: ${insightStatement}
MECHANISM: ${mechanism}

For each prediction, rate on 1-10:
- specificity: How specific and concrete is this prediction? (1=vague, 10=precise measurable outcome)
- independence: How independent is this from the original insight? (1=just restating, 10=surprising new territory)
- checkability: How feasible is it to actually check this? (1=requires god-like knowledge, 10=could check today)

Then give an overall fertility score 1-10 for the insight as a whole.

Respond in JSON:
{
  "predictions": [
    {
      "prediction": "specific falsifiable statement",
      "specificity": N,
      "independence": N,
      "checkability": N
    }
  ],
  "overallScore": N,
  "reasoning": "one sentence justifying the overall score"
}`;
}

// ── ADVERSARIAL STRESS TEST ──

export const ADVERSARIAL_SYSTEM = `You are a ruthless, adversarial critic. You are NOT here to be fair, balanced, or encouraging. Your ONLY purpose is to DESTROY the proposed insight by finding every possible flaw, weakness, and failure mode.

You have seen thousands of LLM-generated "insights" that sound profound but contain nothing. You are an expert at detecting rhetorical mimicry — text that uses the STRUCTURE of insight (surprising connections, bold claims, mechanistic language) without the SUBSTANCE.

Your scoring is HARSH. A score of 7+ means the insight survived your best attacks. Most insights score 3-5. An insight that merely sounds good gets a 2.

You are the immune system against intellectual garbage. Act like it.`;

export function adversarialPrompt(
  insightStatement: string,
  mechanism: string,
  howItResolvesPuzzle: string,
  puzzleStatement: string
): string {
  return `DESTROY this insight. Find every flaw. Be merciless.

PUZZLE: ${puzzleStatement}
PROPOSED INSIGHT: ${insightStatement}
PROPOSED MECHANISM: ${mechanism}
HOW IT CLAIMS TO RESOLVE THE PUZZLE: ${howItResolvesPuzzle}

Apply ALL SIX attack vectors. For each, describe your strongest attack and rate severity 0-10 (10 = fatal flaw found):

1. LOGICAL COHERENCE: Does the reasoning actually follow? Are there hidden assumptions, circular logic, or non-sequiturs? Does the mechanism actually connect cause to effect, or does it just assert a connection?

2. COUNTEREXAMPLES: Can you construct specific, concrete scenarios where this insight predicts something that is obviously false? The more concrete and obvious the counterexample, the higher the severity.

3. ESTABLISHED KNOWLEDGE CONTRADICTIONS: Does this contradict well-established findings in any relevant field? Would an expert in the relevant domain immediately flag something wrong?

4. SIMPLER EXISTING EXPLANATION: Is there a simpler, already-known explanation for the same phenomenon? Occam's razor — if a textbook explanation already covers this, the "insight" adds nothing.

5. UNFALSIFIABILITY: Could this insight wiggle out of any possible disconfirmation? Does it make claims so vague or flexible that nothing could ever prove it wrong? An unfalsifiable insight is useless.

6. RHETORICAL MIMICRY (MOST IMPORTANT): Does this SOUND like an insight without BEING one? Check for:
   - Impressive-sounding jargon that doesn't add precision
   - "Surprising" connections that are actually trivial or tautological
   - Mechanistic language ("via", "through", "by means of") masking the absence of an actual mechanism
   - Claims that feel profound on first read but dissolve into nothing on analysis
   - Structure that mimics academic insight (novel framing, cross-domain analogy) without content

Then give an overall resilience score 1-10. This is how well the insight SURVIVED your attacks, NOT how good your attacks were. 10 = you couldn't land a serious blow. 1 = the insight is empty.

Respond in JSON:
{
  "attacks": [
    {
      "vector": "logical_coherence",
      "severity": N,
      "finding": "your strongest attack"
    },
    {
      "vector": "counterexamples",
      "severity": N,
      "finding": "your strongest attack"
    },
    {
      "vector": "established_knowledge",
      "severity": N,
      "finding": "your strongest attack"
    },
    {
      "vector": "simpler_explanation",
      "severity": N,
      "finding": "your strongest attack"
    },
    {
      "vector": "unfalsifiability",
      "severity": N,
      "finding": "your strongest attack"
    },
    {
      "vector": "rhetorical_mimicry",
      "severity": N,
      "finding": "your strongest attack"
    }
  ],
  "overallResilience": N,
  "summary": "one sentence verdict"
}`;
}

// ── EXPLANATORY UNIFICATION ──

export const UNIFICATION_SYSTEM = `You are an expert at evaluating explanatory power. Given an insight and a set of puzzles, determine which puzzles the insight could plausibly help explain. Be rigorous — a tenuous connection scores low.`;

export function unificationPrompt(
  insightStatement: string,
  mechanism: string,
  puzzles: Array<{ id: string; puzzleStatement: string }>
): string {
  const puzzleList = puzzles
    .map((p, i) => `  ${i + 1}. [${p.id}] ${p.puzzleStatement}`)
    .join('\n');

  return `Evaluate whether this insight can explain each of the following puzzles.

INSIGHT: ${insightStatement}
MECHANISM: ${mechanism}

PUZZLES:
${puzzleList}

For EACH puzzle, rate relevance 1-10:
- 1-3: No real connection
- 4-6: Tangential or very indirect connection
- 7-8: Plausible explanatory link
- 9-10: Directly and convincingly explains this puzzle

Respond in JSON:
{
  "puzzlesResolved": [
    { "puzzleId": "the id", "relevanceScore": N, "reasoning": "one sentence" }
  ]
}`;
}

// ── NOVELTY SEARCH ──

export const NOVELTY_SYSTEM = `You are a literature and patent review specialist. Compare a proposed insight against existing published academic papers AND granted/pending patents to determine if the insight is genuinely novel or already known. Treat patent claims with the same weight as academic publications — if a patent already claims the same core idea, the insight is not novel.`;

export function noveltyComparisonPrompt(
  insightStatement: string,
  papers: Array<{ title: string; abstract?: string; url: string; source?: string }>
): string {
  const paperList = papers
    .map(
      (p, i) =>
        `  ${i + 1}. [${p.source === 'google_patents' ? 'PATENT' : p.source === 'patent_search' ? 'PATENT-RELATED' : 'PAPER'}] "${p.title}"${p.abstract ? `\n     Abstract: ${p.abstract}` : ''}\n     URL: ${p.url}`
    )
    .join('\n');

  return `Compare this insight against existing published academic papers and patents.

INSIGHT: ${insightStatement}

EXISTING WORK FOUND (academic papers and patents):
${paperList || '  (No relevant papers or patents found)'}

For each paper or patent, assess whether it already contains the same core idea as the insight. Pay special attention to patent claims — a patent claiming the same mechanism or application means the insight is not novel.

Respond in JSON:
{
  "assessments": [
    {
      "title": "paper or patent title",
      "url": "paper or patent url",
      "similarityAssessment": "how similar — does this paper/patent already make the same claim?"
    }
  ],
  "isNovel": true/false,
  "reasoning": "one sentence overall verdict"
}`;
}

export function noveltyQueryPrompt(insightStatement: string): string {
  return `Extract the core empirical claim from this insight as a concise search query (5-10 words, suitable for searching academic papers and patent databases):

INSIGHT: ${insightStatement}

Respond with ONLY the search query, nothing else.`;
}

// ── GROUNDING CHECK ──

export const GROUNDING_SYSTEM = `You are a fact-checker. Extract key factual claims from an insight and evaluate whether any contradict well-established knowledge. Be precise — flag only genuine contradictions, not mere disagreements with current theories.

When Wikidata facts are provided, use them as a primary source of structured knowledge. Wikidata is a curated, community-maintained knowledge base — treat its facts as reliable unless you have strong reason to believe otherwise. Cross-reference the insight's claims against both the Wikidata facts and your own training data.`;

export function groundingEntityExtractionPrompt(insightStatement: string, mechanism: string): string {
  return `Extract the key named entities and factual claims from this insight that could be verified against a structured knowledge base like Wikidata.

INSIGHT: ${insightStatement}
MECHANISM: ${mechanism}

For each entity, provide a search term suitable for looking up in Wikidata.
Focus on: people, organizations, scientific concepts, biological entities, chemical compounds, historical events, locations, and quantifiable facts.

Respond in JSON:
{
  "entities": [
    {
      "name": "the entity or concept name",
      "searchTerm": "best search term for Wikidata lookup",
      "relevantProperties": ["short descriptions of what facts to check, e.g. 'instance of', 'part of', 'discovered by'"]
    }
  ],
  "claims": [
    {
      "claim": "a specific factual claim made by the insight",
      "entitiesInvolved": ["entity names involved in this claim"]
    }
  ]
}`;
}

export function groundingPrompt(
  insightStatement: string,
  mechanism: string,
  wikidataContext?: string
): string {
  const wikidataSection = wikidataContext
    ? `\nWIKIDATA FACTS (structured knowledge from Wikidata for entities mentioned in the insight):\n${wikidataContext}\n\nUse these Wikidata facts as an additional source of ground truth when evaluating claims. If a claim contradicts a Wikidata fact, flag it and cite "Wikidata" as the source.\n`
    : '';

  return `Extract and verify the key factual claims in this insight.

INSIGHT: ${insightStatement}
MECHANISM: ${mechanism}
${wikidataSection}
1. List every factual claim (explicit or implied) that the insight depends on.
2. For each claim, assess if it contradicts well-established knowledge.
3. Only flag genuine contradictions with established facts, not speculative disagreements.
4. ${wikidataContext ? 'Cross-reference claims against both the Wikidata facts above and your own knowledge.' : 'Use your knowledge of established facts across relevant fields.'}

Respond in JSON:
{
  "claims": [
    {
      "claim": "the factual claim",
      "status": "supported" | "contradicted" | "unverifiable",
      "contradictedBy": "what established fact contradicts this, if any",
      "source": "field or reference (use 'Wikidata' when applicable)"
    }
  ],
  "isGrounded": true/false,
  "reasoning": "one sentence overall verdict"
}`;
}
