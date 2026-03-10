// src/data/ingest.ts — Expert input handlers (text, document, URL)

import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import type { Concept } from "../shared/types.js";
import { addConcept } from "./vectorStore.js";
import { chunkText, chunkAcademicPaper } from "./chunker.js";

/**
 * Ingest a single text concept directly.
 */
export async function addConceptFromText(
  text: string,
  source: string,
  domain: string,
  metadata?: Partial<Concept["metadata"]>
): Promise<Concept> {
  return addConcept(text, source, domain, {
    ...metadata,
    sourceType: "manual",
  });
}

/**
 * Ingest a document file by chunking it and adding each chunk as a concept.
 * Supports .txt, .md, .pdf, .csv, .json, .html files.
 */
export async function addConceptsFromDocument(
  filePath: string,
  domain: string,
  metadata?: Partial<Concept["metadata"]>
): Promise<Concept[]> {
  const ext = extname(filePath).toLowerCase();
  let content: string;

  if (ext === ".pdf") {
    content = await extractPdfText(filePath);
  } else if (ext === ".html" || ext === ".htm") {
    const raw = await readFile(filePath, "utf-8");
    content = stripHtml(raw);
  } else if (ext === ".csv") {
    const raw = await readFile(filePath, "utf-8");
    content = csvToText(raw);
  } else if (ext === ".json") {
    const raw = await readFile(filePath, "utf-8");
    content = jsonToText(raw);
  } else {
    // .txt, .md, and other text files
    content = await readFile(filePath, "utf-8");
  }

  const isAcademic = looksAcademic(content);
  const chunks = isAcademic ? chunkAcademicPaper(content) : chunkText(content);

  const concepts: Concept[] = [];
  for (const chunk of chunks) {
    const concept = await addConcept(chunk, filePath, domain, {
      ...metadata,
      sourceType: "document",
    });
    concepts.push(concept);
  }

  return concepts;
}

/**
 * Ingest content from a URL by fetching it, chunking, and adding each chunk.
 */
export async function addConceptsFromURL(
  url: string,
  domain: string,
  metadata?: Partial<Concept["metadata"]>
): Promise<Concept[]> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch URL ${url}: ${res.status} ${res.statusText}`);
  }

  const contentType = res.headers.get("content-type") ?? "";
  let text: string;

  if (contentType.includes("application/pdf")) {
    const buffer = Buffer.from(await res.arrayBuffer());
    const pdfParse = require("pdf-parse") as (buf: Buffer) => Promise<{ text: string }>;
    const pdf = await pdfParse(buffer);
    text = pdf.text;
  } else if (contentType.includes("text/html")) {
    const html = await res.text();
    text = stripHtml(html);
  } else {
    text = await res.text();
  }

  const chunks = chunkText(text);
  const concepts: Concept[] = [];

  for (const chunk of chunks) {
    const concept = await addConcept(chunk, url, domain, {
      ...metadata,
      sourceType: "url",
    });
    concepts.push(concept);
  }

  return concepts;
}

/**
 * Extract text from a PDF file using pdf-parse.
 */
async function extractPdfText(filePath: string): Promise<string> {
  const buffer = await readFile(filePath);
  // pdf-parse v1 exports a single function
  const pdfParse = require("pdf-parse") as (buf: Buffer) => Promise<{ text: string }>;
  const pdf = await pdfParse(buffer);
  return pdf.text;
}

/**
 * Simple heuristic to detect academic-style papers.
 */
function looksAcademic(text: string): boolean {
  const lower = text.toLowerCase();
  const markers = ["abstract", "introduction", "methodology", "method", "results", "conclusion", "references"];
  const found = markers.filter((m) => lower.includes(m));
  return found.length >= 3;
}

/**
 * Basic HTML stripping — removes tags and collapses whitespace.
 */
function stripHtml(html: string): string {
  return html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "")
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Convert CSV to readable text — each row becomes a readable line.
 */
function csvToText(csv: string): string {
  const lines = csv.trim().split("\n");
  if (lines.length < 2) return csv;

  const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  const rows = lines.slice(1).map((line) => {
    const values = line.split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
    return headers.map((h, i) => `${h}: ${values[i] ?? ""}`).join(", ");
  });

  return rows.join("\n");
}

/**
 * Convert JSON to readable text — extracts string values recursively.
 */
function jsonToText(raw: string): string {
  try {
    const data = JSON.parse(raw);
    const parts: string[] = [];
    extractStrings(data, parts);
    return parts.join("\n\n");
  } catch {
    return raw;
  }
}

function extractStrings(obj: unknown, parts: string[], depth = 0): void {
  if (depth > 10) return;
  if (typeof obj === "string" && obj.length > 20) {
    parts.push(obj);
  } else if (Array.isArray(obj)) {
    for (const item of obj) extractStrings(item, parts, depth + 1);
  } else if (obj && typeof obj === "object") {
    for (const value of Object.values(obj)) extractStrings(value, parts, depth + 1);
  }
}
