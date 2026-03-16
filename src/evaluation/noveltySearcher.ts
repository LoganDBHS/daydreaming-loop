// src/evaluation/noveltySearcher.ts — Patent-style literature novelty search

import { claudeClient } from '../shared/claudeClient';
import { NoveltyResult, DDLConfig } from '../shared/types';
import { NOVELTY_SYSTEM, noveltyComparisonPrompt, noveltyQueryPrompt } from './prompts';

interface SemanticScholarPaper {
  paperId: string;
  title: string;
  abstract?: string;
  url: string;
}

/** Unified representation for any prior-art result (paper or patent). */
interface PriorArtResult {
  title: string;
  abstract?: string;
  url: string;
  source: 'semantic_scholar' | 'google_patents' | 'patent_search';
}

/**
 * Search Semantic Scholar AND Google Patents for existing work similar to the
 * insight, then ask Claude to compare and determine novelty.
 */
export async function runNoveltySearch(
  insightStatement: string,
  config: DDLConfig
): Promise<NoveltyResult> {
  const client = claudeClient;

  // Step 1: Extract a search query from the insight
  const searchQuery = await extractSearchQuery(client, insightStatement, config);

  // Step 2: Search multiple sources in parallel
  const [academicPapers, patentResults, patentFocusedPapers] = await Promise.all([
    searchSemanticScholar(searchQuery, config.semanticScholarApiKey),
    searchGooglePatents(searchQuery),
    searchSemanticScholarPatents(searchQuery, config.semanticScholarApiKey),
  ]);

  // Step 3: Merge and deduplicate all prior-art results
  const allPriorArt = mergePriorArt(academicPapers, patentResults, patentFocusedPapers);

  // Step 4: Ask Claude to compare the insight against found papers and patents
  return await compareWithPapers(client, insightStatement, allPriorArt, config);
}

async function extractSearchQuery(
  client: typeof claudeClient,
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
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();

  return text || insightStatement.slice(0, 100);
}

async function searchSemanticScholar(
  query: string,
  apiKey?: string
): Promise<PriorArtResult[]> {
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
      title: p.title || 'Untitled',
      abstract: p.abstract || undefined,
      url: p.url || `https://api.semanticscholar.org/paper/${p.paperId}`,
      source: 'semantic_scholar' as const,
    }));
  } catch {
    // Network error or timeout — proceed without papers
    return [];
  }
}

/**
 * Search Semantic Scholar with patent-related keywords appended to the query.
 * This catches patent-related academic work and patent citations indexed by S2.
 */
async function searchSemanticScholarPatents(
  query: string,
  apiKey?: string
): Promise<PriorArtResult[]> {
  const patentQuery = `${query} patent application invention`;
  const encoded = encodeURIComponent(patentQuery);
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
      title: p.title || 'Untitled',
      abstract: p.abstract || undefined,
      url: p.url || `https://api.semanticscholar.org/paper/${p.paperId}`,
      source: 'patent_search' as const,
    }));
  } catch {
    return [];
  }
}

/**
 * Search Google Patents by scraping the search results page.
 * Google Patents has no free API, so we fetch the HTML search results and
 * extract patent titles, snippets, and URLs from the response.
 * Falls back gracefully if the request fails or is blocked.
 */
async function searchGooglePatents(query: string): Promise<PriorArtResult[]> {
  const encoded = encodeURIComponent(query);
  const url = `https://patents.google.com/xhr/query?url=q%3D${encoded}&exp=&num=5`;

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; DDL-NoveltySearcher/1.0)',
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      // Fall back to scraping the HTML search page
      return await searchGooglePatentsHtml(query);
    }

    const data = await res.json() as any;

    // Google Patents XHR returns results in data.results.cluster[].result[]
    const results: PriorArtResult[] = [];
    const clusters = data?.results?.cluster;
    if (Array.isArray(clusters)) {
      for (const cluster of clusters) {
        const clusterResults = cluster?.result;
        if (!Array.isArray(clusterResults)) continue;
        for (const r of clusterResults) {
          const patent = r?.patent;
          if (!patent) continue;
          const patentId = patent.publication_number || '';
          const title = patent.title || patent.invention_title || 'Untitled Patent';
          const snippet = patent.snippet || patent.abstract || undefined;
          results.push({
            title: typeof title === 'string' ? title : String(title),
            abstract: typeof snippet === 'string' ? snippet : undefined,
            url: `https://patents.google.com/patent/${patentId}`,
            source: 'google_patents',
          });
          if (results.length >= 5) break;
        }
        if (results.length >= 5) break;
      }
    }

    return results;
  } catch {
    // If XHR endpoint fails, try HTML scraping fallback
    return await searchGooglePatentsHtml(query);
  }
}

/**
 * Fallback: scrape Google Patents HTML search results page.
 * Extracts patent links and titles from the rendered search page.
 */
async function searchGooglePatentsHtml(query: string): Promise<PriorArtResult[]> {
  const encoded = encodeURIComponent(query);
  const url = `https://patents.google.com/?q=${encoded}&num=5`;

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; DDL-NoveltySearcher/1.0)',
        'Accept': 'text/html',
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) return [];

    const html = await res.text();
    const results: PriorArtResult[] = [];

    // Extract patent entries from the HTML using regex patterns
    // Google Patents renders results with <search-result-item> or <article> elements
    // containing patent IDs in href="/patent/XXXXX" and titles in <h3> or <span id="htmlContent">
    const patentLinkPattern = /\/patent\/([A-Z]{2}\d+[A-Z0-9]*)/g;
    const seenIds = new Set<string>();
    let match: RegExpExecArray | null;

    while ((match = patentLinkPattern.exec(html)) !== null) {
      const patentId = match[1];
      if (seenIds.has(patentId)) continue;
      seenIds.add(patentId);

      // Try to find a title near this patent reference
      const nearbyText = html.substring(
        Math.max(0, match.index - 500),
        Math.min(html.length, match.index + 500)
      );
      const titleMatch = nearbyText.match(/<(?:h[2-4]|span)[^>]*>([^<]{10,200})<\//);
      const title = titleMatch ? titleMatch[1].trim() : `Patent ${patentId}`;

      results.push({
        title,
        url: `https://patents.google.com/patent/${patentId}`,
        source: 'google_patents',
      });

      if (results.length >= 5) break;
    }

    return results;
  } catch {
    // Google Patents not reachable — not fatal, we still have Semantic Scholar results
    return [];
  }
}

/**
 * Merge and deduplicate prior-art results from multiple sources.
 * Deduplication is based on normalized title similarity.
 */
function mergePriorArt(...sources: PriorArtResult[][]): PriorArtResult[] {
  const seen = new Set<string>();
  const merged: PriorArtResult[] = [];

  for (const source of sources) {
    for (const item of source) {
      // Normalize title for dedup: lowercase, strip punctuation, collapse whitespace
      const normalizedTitle = item.title
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();

      if (seen.has(normalizedTitle)) continue;
      seen.add(normalizedTitle);
      merged.push(item);
    }
  }

  return merged;
}

async function compareWithPapers(
  client: typeof claudeClient,
  insightStatement: string,
  papers: PriorArtResult[],
  config: DDLConfig
): Promise<NoveltyResult> {
  const paperList = papers.map((p) => ({
    title: p.title,
    abstract: p.abstract,
    url: p.url,
    source: p.source,
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
    .filter((block) => block.type === 'text')
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
