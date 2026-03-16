// scripts/bulkIngest.ts — Bulk ingest URLs and/or local files into ChromaDB

import { readFile, readdir, stat } from "node:fs/promises";
import { join, extname } from "node:path";
import { addConceptsFromDocument, addConceptsFromURL } from "../src/data/index.js";

const SUPPORTED_EXTENSIONS = new Set([".txt", ".md", ".pdf", ".csv", ".json", ".html", ".htm"]);

function parseArgs(argv: string[]): { urls?: string; dir?: string; domain: string } {
  let urls: string | undefined;
  let dir: string | undefined;
  let domain = "general";

  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--urls" && argv[i + 1]) {
      urls = argv[++i];
    } else if (argv[i] === "--dir" && argv[i + 1]) {
      dir = argv[++i];
    } else if (argv[i] === "--domain" && argv[i + 1]) {
      domain = argv[++i];
    }
  }

  if (!urls && !dir) {
    console.error("Usage: npx tsx scripts/bulkIngest.ts --urls <file> --dir <directory> --domain <domain>");
    console.error("  At least one of --urls or --dir is required.");
    process.exit(1);
  }

  return { urls, dir, domain };
}

async function loadUrls(filePath: string): Promise<string[]> {
  const content = await readFile(filePath, "utf-8");
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

async function listFiles(dirPath: string): Promise<string[]> {
  const entries = await readdir(dirPath);
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(dirPath, entry);
    const info = await stat(fullPath);
    if (info.isFile() && SUPPORTED_EXTENSIONS.has(extname(entry).toLowerCase())) {
      files.push(fullPath);
    }
  }

  return files;
}

async function main() {
  const { urls, dir, domain } = parseArgs(process.argv);

  const urlList: string[] = urls ? await loadUrls(urls) : [];
  const fileList: string[] = dir ? await listFiles(dir) : [];
  const totalItems = urlList.length + fileList.length;

  if (totalItems === 0) {
    console.log("Nothing to ingest. Check your --urls file or --dir directory.");
    return;
  }

  console.log(`Ingesting ${totalItems} items into domain "${domain}"...\n`);

  let itemIndex = 0;
  let totalConcepts = 0;
  let failures = 0;

  for (const url of urlList) {
    itemIndex++;
    try {
      const concepts = await addConceptsFromURL(url, domain);
      totalConcepts += concepts.length;
      console.log(`[${itemIndex}/${totalItems}] ${concepts.length} concepts from ${url}`);
    } catch (err) {
      failures++;
      console.error(`[${itemIndex}/${totalItems}] FAILED ${url}: ${err instanceof Error ? err.message : err}`);
    }
  }

  for (const filePath of fileList) {
    itemIndex++;
    try {
      const concepts = await addConceptsFromDocument(filePath, domain);
      totalConcepts += concepts.length;
      console.log(`[${itemIndex}/${totalItems}] ${concepts.length} concepts from ${filePath}`);
    } catch (err) {
      failures++;
      console.error(`[${itemIndex}/${totalItems}] FAILED ${filePath}: ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log(`\nDone. ${totalConcepts} concepts added from ${totalItems - failures} sources. ${failures} failures.`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
