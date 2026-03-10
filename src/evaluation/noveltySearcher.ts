// src/evaluation/noveltySearcher.ts — Patent-style literature novelty search

import Anthropic from '@anthropic-ai/sdk';
import { NoveltyResult, DDLConfig } from '../shared/types';
import { NOVELTY_SYSTEM, noveltyComparisonPrompt, noveltyQueryPrompt } from './prompts';

interface SemanticScholarPaper {
  paperId: string;
  title: string;
  abstract?: string;
  url: string;
}

/**
 * Search Semantic Scholar for existing work similar to the insight,
 * then ask Claude to compare and determine novelty.
 */
export async function runNoveltySearch(
  insightStatement: string,
  config: DDLConfig
): Promise<NoveltyResult> {
  const client = new Anthropic({ apiKey: config.anthropicApiKey });

  // Step 1: Extract a search query from the insight
  const searchQuery = await extractSearchQuery(client, insightStatement, config);

  // Step 2: Search Semantic Scholar
  const papers = await searchSemanticScholar(searchQuery, config.semanticScholarApiKey);

  // Step 3: Ask Claude to compare the insight against found papers
  return await compareWithPapers(client, insightStatement, papers, config);
}

async function extractSearchQuery(
  client: Anthropic,
  insightStatement: string,
  config: DDLConfig
): Promise<string> {
  const response = await client.messages.create({
    model: config.modelId,
    max_tokens: 100,
    messages: [{ role: 'user', content: noveltyQueryPrompt(insightStatement) }],
    temperature: 0.1,
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();

  return text || insightStatement.slice(0, 100);
}

async function searchSemanticScholar(
  query: string,
  apiKey?: string
): Promise<SemanticScholarPaper[]> {
  const encoded = encodeURIComponent(query);
  const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encoded}&limit=5&fields=paperId,title,abstract,url`;

  const headers: Record<string, string> = {};
  if (apiKey) {
    headers['x-api-key'] = apiKey;
  }

  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      return [];
    }

    const data = await res.json() as { data?: any[] };
    if (!Array.isArray(data.data)) return [];

    return data.data.map((p: any) => ({
      paperId: p.paperId || '',
      title: p.title || 'Untitled',
      abstract: p.abstract || undefined,
      url: p.url || `https://api.semanticscholar.org/paper/${p.paperId}`,
    }));
  } catch {
    // Network error or timeout — proceed without papers
    return [];
  }
}

async function compareWithPapers(
  client: Anthropic,
  insightStatement: string,
  papers: SemanticScholarPaper[],
  config: DDLConfig
): Promise<NoveltyResult> {
  const paperList = papers.map((p) => ({
    title: p.title,
    abstract: p.abstract,
    url: p.url,
  }));

  const userPrompt = noveltyComparisonPrompt(insightStatement, paperList);

  const response = await client.messages.create({
    model: config.modelId,
    max_tokens: 1024,
    system: NOVELTY_SYSTEM,
    messages: [{ role: 'user', content: userPrompt }],
    temperature: 0.2,
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');

  return parseNoveltyResponse(text);
}

function parseNoveltyResponse(text: string): NoveltyResult {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    // If we can't parse, assume novel (benefit of the doubt)
    return { existingWorks: [], isNovel: true };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);

    const existingWorks = Array.isArray(parsed.assessments)
      ? parsed.assessments.map((a: any) => ({
          title: String(a.title || ''),
          url: String(a.url || ''),
          similarityAssessment: String(a.similarityAssessment || ''),
        }))
      : [];

    return {
      existingWorks,
      isNovel: parsed.isNovel !== false, // default to novel if unclear
    };
  } catch {
    return { existingWorks: [], isNovel: true };
  }
}
