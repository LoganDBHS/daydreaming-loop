// src/data/chunker.ts — Document chunking logic

/**
 * Rough token estimate: ~4 characters per token for English text.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

const MIN_CHUNK_TOKENS = 100;
const MAX_CHUNK_TOKENS = 300;
const MIN_CHUNK_CHARS = MIN_CHUNK_TOKENS * 4; // ~400
const MAX_CHUNK_CHARS = MAX_CHUNK_TOKENS * 4; // ~1200

/**
 * Split text into concept-sized chunks (100-300 tokens each).
 *
 * Strategy:
 * - Split on paragraph breaks and section headers
 * - Never split mid-sentence
 * - Merge small paragraphs together
 * - Split large paragraphs at sentence boundaries
 */
export function chunkText(text: string): string[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  // Split on double newlines (paragraph breaks) and section headers (lines starting with #)
  const blocks = splitOnParagraphsAndHeaders(normalized);

  // Now merge small blocks and split large ones
  const chunks: string[] = [];
  let buffer = "";

  for (const block of blocks) {
    const combined = buffer ? buffer + "\n\n" + block : block;

    if (estimateTokens(combined) <= MAX_CHUNK_TOKENS) {
      buffer = combined;
    } else if (buffer && estimateTokens(buffer) >= MIN_CHUNK_TOKENS) {
      // Buffer is big enough on its own, flush it
      chunks.push(buffer.trim());
      // Start new buffer with current block
      if (estimateTokens(block) > MAX_CHUNK_TOKENS) {
        // Block itself is too big, split at sentence boundaries
        chunks.push(...splitAtSentences(block));
        buffer = "";
      } else {
        buffer = block;
      }
    } else {
      // Buffer too small, block too big to merge — split the block
      if (buffer) {
        // Try to add buffer to the first sentence-split chunk
        const subChunks = splitAtSentences(block);
        if (subChunks.length > 0) {
          const firstCombined = buffer + "\n\n" + subChunks[0];
          if (estimateTokens(firstCombined) <= MAX_CHUNK_TOKENS) {
            subChunks[0] = firstCombined;
          } else {
            chunks.push(buffer.trim());
          }
          chunks.push(...subChunks.map((c) => c.trim()));
        } else {
          chunks.push(buffer.trim());
        }
        buffer = "";
      } else {
        chunks.push(...splitAtSentences(block).map((c) => c.trim()));
      }
    }
  }

  if (buffer.trim()) {
    chunks.push(buffer.trim());
  }

  return chunks.filter((c) => c.length > 0);
}

/**
 * Split text on paragraph breaks (double newlines) and markdown headers.
 */
function splitOnParagraphsAndHeaders(text: string): string[] {
  // Split on double newlines or lines that start with # (markdown headers)
  const parts = text.split(/\n{2,}|(?=^#{1,6}\s)/m);
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

/**
 * Split a large block at sentence boundaries, trying to stay within token limits.
 * Never splits mid-sentence.
 */
function splitAtSentences(text: string): string[] {
  // Match sentences: text ending with . ! or ? followed by space or end
  const sentences = text.match(/[^.!?]*[.!?]+(?:\s|$)|[^.!?]+$/g);
  if (!sentences) return [text];

  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    const combined = current ? current + " " + sentence.trim() : sentence.trim();

    if (estimateTokens(combined) > MAX_CHUNK_TOKENS && current) {
      chunks.push(current.trim());
      current = sentence.trim();
    } else {
      current = combined;
    }
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks;
}

/**
 * For academic papers: extract structured sections as separate chunks.
 * Falls back to general chunking for non-academic text.
 */
export function chunkAcademicPaper(text: string): string[] {
  const sections: string[] = [];

  // Try to extract abstract
  const abstractMatch = text.match(/abstract\s*[:\n](.+?)(?=\n\s*(?:introduction|1[\.\s]|keywords))/is);
  if (abstractMatch) {
    sections.push(abstractMatch[1].trim());
  }

  // Extract numbered or named sections
  const sectionPattern = /(?:^|\n)(?:#{1,3}\s+|\d+\.?\s+)((?:introduction|methods?|results?|discussion|conclusion|findings|related work|background|approach)[^\n]*)\n([\s\S]*?)(?=\n(?:#{1,3}\s+|\d+\.?\s+)|$)/gi;

  let match;
  while ((match = sectionPattern.exec(text)) !== null) {
    const sectionContent = match[2].trim();
    if (sectionContent) {
      // Chunk each section individually
      sections.push(...chunkText(sectionContent));
    }
  }

  // If we couldn't extract structured sections, fall back to general chunking
  if (sections.length === 0) {
    return chunkText(text);
  }

  return sections;
}
