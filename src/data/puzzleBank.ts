// src/data/puzzleBank.ts — Puzzle storage and retrieval

import { ChromaClient, Collection } from "chromadb";
import type { Puzzle } from "../shared/types.js";
import { embed } from "./embedder.js";

let puzzleCollection: Collection | null = null;
const COLLECTION_NAME = "ddl_puzzles";

async function getCollection(): Promise<Collection> {
  if (!puzzleCollection) {
    const client = new ChromaClient();
    puzzleCollection = await client.getOrCreateCollection({
      name: COLLECTION_NAME,
    });
  }
  return puzzleCollection;
}

export async function storePuzzle(puzzle: Puzzle): Promise<void> {
  const collection = await getCollection();

  const embedding = await embed(puzzle.puzzleStatement);

  await collection.upsert({
    ids: [puzzle.id],
    embeddings: [embedding],
    documents: [puzzle.puzzleStatement],
    metadatas: [
      {
        conceptA: puzzle.conceptPairIds[0],
        conceptB: puzzle.conceptPairIds[1],
        whyHardToExplain: puzzle.whyHardToExplain,
        descriptionComplexity: puzzle.stScore.descriptionComplexity,
        generationComplexity: puzzle.stScore.generationComplexity,
        unexpectedness: puzzle.stScore.unexpectedness,
        createdAt: puzzle.createdAt.toISOString(),
        status: puzzle.status,
      },
    ],
  });
}

export async function getAllValidatedPuzzles(): Promise<Puzzle[]> {
  const collection = await getCollection();
  const count = await collection.count();
  if (count === 0) return [];

  const result = await collection.get({
    where: { status: "validated" },
    include: ["documents", "metadatas"],
  });

  return result.ids.map((id, i) => chromaResultToPuzzle(id, result.documents[i], result.metadatas[i]));
}

export async function getAllPuzzles(): Promise<Puzzle[]> {
  const collection = await getCollection();
  const count = await collection.count();
  if (count === 0) return [];

  const result = await collection.get({
    include: ["documents", "metadatas"],
  });

  return result.ids.map((id, i) => chromaResultToPuzzle(id, result.documents[i], result.metadatas[i]));
}

export async function getPuzzleById(id: string): Promise<Puzzle | null> {
  const collection = await getCollection();
  const result = await collection.get({
    ids: [id],
    include: ["documents", "metadatas"],
  });

  if (!result.ids.length) return null;
  return chromaResultToPuzzle(result.ids[0], result.documents[0], result.metadatas[0]);
}

function chromaResultToPuzzle(id: string, doc: string | null, meta: any): Puzzle {
  return {
    id,
    conceptPairIds: [meta.conceptA as string, meta.conceptB as string],
    puzzleStatement: doc ?? "",
    whyHardToExplain: (meta.whyHardToExplain as string) ?? "",
    stScore: {
      descriptionComplexity: (meta.descriptionComplexity as number) ?? 0,
      generationComplexity: (meta.generationComplexity as number) ?? 0,
      unexpectedness: (meta.unexpectedness as number) ?? 0,
    },
    createdAt: meta.createdAt ? new Date(meta.createdAt as string) : new Date(),
    status: (meta.status as "validated" | "discarded") ?? "validated",
  };
}
