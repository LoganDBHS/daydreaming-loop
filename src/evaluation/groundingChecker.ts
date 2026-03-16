// src/evaluation/groundingChecker.ts — Knowledge graph fact-checking with Wikidata integration

import { claudeClient } from '../shared/claudeClient';
import { GroundingResult, DDLConfig } from '../shared/types';
import { GROUNDING_SYSTEM, groundingPrompt, groundingEntityExtractionPrompt } from './prompts';

// ── Wikidata types ──

interface WikidataEntity {
  id: string;           // e.g. "Q5" for human
  label: string;
  description: string;
}

interface WikidataFact {
  entityId: string;
  entityLabel: string;
  property: string;
  propertyLabel: string;
  value: string;
}

interface ExtractedEntity {
  name: string;
  searchTerm: string;
  relevantProperties: string[];
}

interface ExtractedClaim {
  claim: string;
  entitiesInvolved: string[];
}

// ── Wikidata API helpers ──

const WIKIDATA_SEARCH_URL = 'https://www.wikidata.org/w/api.php';
const WIKIDATA_SPARQL_URL = 'https://query.wikidata.org/sparql';
const WIKIDATA_TIMEOUT = 8_000;

/**
 * Search for a Wikidata entity by name using the wbsearchentities API.
 * Returns the top match, or null if nothing found.
 */
async function searchWikidataEntity(searchTerm: string): Promise<WikidataEntity | null> {
  const params = new URLSearchParams({
    action: 'wbsearchentities',
    search: searchTerm,
    language: 'en',
    format: 'json',
    limit: '1',
    origin: '*',
  });

  try {
    const res = await fetch(`${WIKIDATA_SEARCH_URL}?${params}`, {
      headers: { 'User-Agent': 'DDL-GroundingChecker/1.0' },
      signal: AbortSignal.timeout(WIKIDATA_TIMEOUT),
    });

    if (!res.ok) return null;

    const data = await res.json() as {
      search?: Array<{ id: string; label: string; description: string }>;
    };

    if (!data.search || data.search.length === 0) return null;

    const match = data.search[0];
    return {
      id: match.id,
      label: match.label || searchTerm,
      description: match.description || '',
    };
  } catch {
    return null;
  }
}

/**
 * Query Wikidata SPARQL endpoint for key properties of a given entity.
 * Returns a list of (property, value) facts about the entity.
 */
async function queryWikidataProperties(entityId: string): Promise<WikidataFact[]> {
  // Query up to 20 notable properties for the entity.
  // We filter to properties that are likely useful for fact-checking:
  // instance of, subclass of, part of, has cause, discoverer, inception, etc.
  const sparql = `
SELECT ?propLabel ?valLabel WHERE {
  wd:${entityId} ?prop ?statement .
  ?statement ?ps ?val .
  ?property wikibase:claim ?prop .
  ?property wikibase:statementProperty ?ps .
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
LIMIT 20
  `.trim();

  try {
    const res = await fetch(WIKIDATA_SPARQL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/sparql-results+json',
        'User-Agent': 'DDL-GroundingChecker/1.0',
      },
      body: `query=${encodeURIComponent(sparql)}`,
      signal: AbortSignal.timeout(WIKIDATA_TIMEOUT),
    });

    if (!res.ok) return [];

    const data = await res.json() as {
      results?: {
        bindings?: Array<{
          propLabel?: { value: string };
          valLabel?: { value: string };
        }>;
      };
    };

    if (!data.results?.bindings) return [];

    return data.results.bindings
      .filter((b) => b.propLabel?.value && b.valLabel?.value)
      .map((b) => ({
        entityId,
        entityLabel: '', // filled in by caller
        property: '',
        propertyLabel: b.propLabel!.value,
        value: b.valLabel!.value,
      }));
  } catch {
    return [];
  }
}

/**
 * Look up a single entity on Wikidata: search by name, then fetch its properties.
 */
async function lookupEntity(
  searchTerm: string
): Promise<{ entity: WikidataEntity; facts: WikidataFact[] } | null> {
  const entity = await searchWikidataEntity(searchTerm);
  if (!entity) return null;

  const facts = await queryWikidataProperties(entity.id);
  // Fill in entity labels on the facts
  for (const f of facts) {
    f.entityLabel = entity.label;
  }

  return { entity, facts };
}

/**
 * Query Wikidata for multiple entities in parallel.
 * Returns a formatted string summarizing all found facts, or null if nothing was found.
 */
async function queryWikidata(
  entities: ExtractedEntity[]
): Promise<string | null> {
  if (entities.length === 0) return null;

  // Limit to 5 entities to avoid excessive API calls
  const entitiesToLookup = entities.slice(0, 5);

  const results = await Promise.all(
    entitiesToLookup.map((e) => lookupEntity(e.searchTerm))
  );

  const sections: string[] = [];

  for (let i = 0; i < entitiesToLookup.length; i++) {
    const result = results[i];
    if (!result) continue;

    const { entity, facts } = result;
    if (facts.length === 0) {
      sections.push(
        `- ${entity.label} (${entity.id}): ${entity.description || 'No description'}`
      );
      continue;
    }

    const factLines = facts
      .slice(0, 10) // limit facts per entity
      .map((f) => `  * ${f.propertyLabel}: ${f.value}`)
      .join('\n');

    sections.push(
      `- ${entity.label} (${entity.id}): ${entity.description || 'No description'}\n${factLines}`
    );
  }

  if (sections.length === 0) return null;

  return sections.join('\n\n');
}

// ── Entity extraction via Claude ──

/**
 * Ask Claude to extract named entities and factual claims from the insight
 * so we know what to look up on Wikidata.
 */
async function extractEntitiesAndClaims(
  client: typeof claudeClient,
  insightStatement: string,
  mechanism: string,
  config: DDLConfig
): Promise<{ entities: ExtractedEntity[]; claims: ExtractedClaim[] }> {
  const response = await client.messages.create({
    model: config.modelId,
    max_tokens: 512,
    messages: [{
      role: 'user',
      content: groundingEntityExtractionPrompt(insightStatement, mechanism),
    }],
    temperature: 0.1,
  });

  const text = response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('');

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { entities: [], claims: [] };

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    const entities: ExtractedEntity[] = Array.isArray(parsed.entities)
      ? parsed.entities.map((e: any) => ({
          name: String(e.name || ''),
          searchTerm: String(e.searchTerm || e.name || ''),
          relevantProperties: Array.isArray(e.relevantProperties)
            ? e.relevantProperties.map(String)
            : [],
        }))
      : [];

    const claims: ExtractedClaim[] = Array.isArray(parsed.claims)
      ? parsed.claims.map((c: any) => ({
          claim: String(c.claim || ''),
          entitiesInvolved: Array.isArray(c.entitiesInvolved)
            ? c.entitiesInvolved.map(String)
            : [],
        }))
      : [];

    return { entities, claims };
  } catch {
    return { entities: [], claims: [] };
  }
}

// ── Main grounding check ──

/**
 * Extract key factual claims from an insight and check whether any
 * contradict well-established knowledge. Uses Wikidata for structured
 * fact lookup when possible, falling back to Claude-only if Wikidata
 * is unavailable or returns no results.
 */
export async function runGroundingCheck(
  insightStatement: string,
  mechanism: string,
  config: DDLConfig
): Promise<GroundingResult> {
  const client = claudeClient;

  // Step 1: Extract entities and claims from the insight using Claude
  let wikidataContext: string | undefined;
  try {
    const { entities } = await extractEntitiesAndClaims(
      client,
      insightStatement,
      mechanism,
      config
    );

    // Step 2: Look up those entities on Wikidata
    if (entities.length > 0) {
      const context = await queryWikidata(entities);
      if (context) {
        wikidataContext = context;
      }
    }
  } catch {
    // Wikidata integration failed — fall back to Claude-only approach
    wikidataContext = undefined;
  }

  // Step 3: Run grounding check with Claude, including Wikidata context if available
  const userPrompt = groundingPrompt(insightStatement, mechanism, wikidataContext);

  const response = await client.messages.create({
    model: config.modelId,
    max_tokens: 1024,
    system: GROUNDING_SYSTEM,
    messages: [{ role: 'user', content: userPrompt }],
    temperature: 0.2,
  });

  const text = response.content
    .filter((block) => block.type === 'text')
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
