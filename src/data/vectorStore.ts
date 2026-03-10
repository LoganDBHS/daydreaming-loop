// src/data/vectorStore.ts — ChromaDB setup, CRUD operations

import { ChromaClient, Collection } from "chromadb";
import { randomUUID } from "node:crypto";
import type { Concept } from "../shared/types.js";
import { embed } from "./embedder.js";

let client: ChromaClient | null = null;
let conceptCollection: Collection | null = null;

const COLLECTION_NAME = "ddl_concepts";

async function getClient(): Promise<ChromaClient> {
  if (!client) {
    client = new ChromaClient();
  }
  return client;
}

export async function getCollection(): Promise<Collection> {
  if (!conceptCollection) {
    const c = await getClient();
    conceptCollection = await c.getOrCreateCollection({
      name: COLLECTION_NAME,
      metadata: { "hnsw:space": "cosine" },
    });
  }
  return conceptCollection;
}

export async function addConcept(
  text: string,
  source: string,
  domain: string,
  metadata?: Partial<Concept["metadata"]>
): Promise<Concept> {
  const collection = await getCollection();
  const embedding = await embed(text);
  const id = randomUUID();
  const now = new Date();

  const conceptMeta: Concept["metadata"] = {
    addedBy: metadata?.addedBy ?? "system",
    addedAt: now,
    confidence: metadata?.confidence ?? "established",
    sourceType: metadata?.sourceType ?? "manual",
  };

  // ChromaDB metadata must be flat string/number/boolean
  await collection.add({
    ids: [id],
    embeddings: [embedding],
    documents: [text],
    metadatas: [
      {
        source,
        domain,
        addedBy: conceptMeta.addedBy,
        addedAt: now.toISOString(),
        confidence: conceptMeta.confidence,
        sourceType: conceptMeta.sourceType,
      },
    ],
  });

  return { id, text, source, domain, embedding, metadata: conceptMeta };
}

export async function getConceptById(id: string): Promise<Concept> {
  const collection = await getCollection();
  const result = await collection.get({
    ids: [id],
    include: ["embeddings", "documents", "metadatas"],
  });

  if (!result.ids.length) {
    throw new Error(`Concept not found: ${id}`);
  }

  return chromaResultToConcept(result, 0);
}

export async function getAllConcepts(): Promise<Concept[]> {
  const collection = await getCollection();
  const count = await collection.count();
  if (count === 0) return [];

  const result = await collection.get({
    include: ["embeddings", "documents", "metadatas"],
  });

  return result.ids.map((_, i) => chromaResultToConcept(result, i));
}

export async function queryByEmbedding(
  embedding: number[],
  topK: number
): Promise<Array<{ concept: Concept; distance: number }>> {
  const collection = await getCollection();
  const count = await collection.count();
  if (count === 0) return [];

  const result = await collection.query({
    queryEmbeddings: [embedding],
    nResults: Math.min(topK, count),
    include: ["embeddings", "documents", "metadatas", "distances"],
  });

  if (!result.ids[0]) return [];

  return result.ids[0].map((_, i) => ({
    concept: chromaQueryToConcept(result, i),
    distance: result.distances?.[0]?.[i] ?? 0,
  }));
}

export async function queryByText(
  text: string,
  topK: number
): Promise<Array<{ concept: Concept; distance: number }>> {
  const embedding = await embed(text);
  return queryByEmbedding(embedding, topK);
}

export async function getConceptCount(): Promise<number> {
  const collection = await getCollection();
  return collection.count();
}

export async function deleteConcept(id: string): Promise<void> {
  const collection = await getCollection();
  await collection.delete({ ids: [id] });
}

export async function deleteAllConcepts(): Promise<void> {
  const c = await getClient();
  try {
    await c.deleteCollection({ name: COLLECTION_NAME });
  } catch {
    // Collection may not exist
  }
  conceptCollection = null;
}

// ── Helpers ──

function chromaResultToConcept(result: any, index: number): Concept {
  const meta = result.metadatas[index] ?? {};
  return {
    id: result.ids[index],
    text: result.documents[index] ?? "",
    source: (meta.source as string) ?? "",
    domain: (meta.domain as string) ?? "",
    embedding: result.embeddings?.[index] ?? [],
    metadata: {
      addedBy: (meta.addedBy as string) ?? "system",
      addedAt: meta.addedAt ? new Date(meta.addedAt as string) : new Date(),
      confidence: (meta.confidence as "established" | "speculative") ?? "established",
      sourceType: (meta.sourceType as "manual" | "document" | "url") ?? "manual",
    },
  };
}

function chromaQueryToConcept(result: any, index: number): Concept {
  const meta = result.metadatas?.[0]?.[index] ?? {};
  return {
    id: result.ids[0][index],
    text: result.documents?.[0]?.[index] ?? "",
    source: (meta.source as string) ?? "",
    domain: (meta.domain as string) ?? "",
    embedding: result.embeddings?.[0]?.[index] ?? [],
    metadata: {
      addedBy: (meta.addedBy as string) ?? "system",
      addedAt: meta.addedAt ? new Date(meta.addedAt as string) : new Date(),
      confidence: (meta.confidence as "established" | "speculative") ?? "established",
      sourceType: (meta.sourceType as "manual" | "document" | "url") ?? "manual",
    },
  };
}
