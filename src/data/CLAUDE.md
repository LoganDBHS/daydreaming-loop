# Data Layer Module

You are building the data layer for a Daydreaming Discovery Loop (DDL) system.
Your code lives ONLY in src/data/. Do not create or modify files outside this directory.

## What you're building

A knowledge management system that:
1. Lets domain experts easily input concepts (text, documents, URLs)
2. Chunks documents into concept-sized units (100-300 tokens)
3. Embeds concepts using a high-quality embedding model
4. Stores everything in a vector database (use ChromaDB)
5. Provides an anti-correlated sampler that returns concept pairs with LOW cosine similarity
6. Stores validated puzzles in a Puzzle Bank

## Files you own

- src/data/vectorStore.ts      — ChromaDB setup, CRUD operations
- src/data/chunker.ts          — document chunking logic
- src/data/embedder.ts         — embedding generation (use Voyage or OpenAI embeddings)
- src/data/sampler.ts          — anti-correlated concept pair sampling
- src/data/puzzleBank.ts       — puzzle storage and retrieval
- src/data/ingest.ts           — expert input handlers (text, document, URL)
- src/data/index.ts            — public exports

## Key exported functions (these are your API contract)

- addConcept(text, source, domain, metadata): Promise<Concept>
- addConceptsFromDocument(filePath, domain): Promise<Concept[]>
- addConceptsFromURL(url, domain): Promise<Concept[]>
- getRandomAntiCorrelatedPair(windowPercent?): Promise<ConceptPair>
- getRelatedConcepts(text, topK?): Promise<Concept[]>
- storePuzzle(puzzle): Promise<void>
- getAllValidatedPuzzles(): Promise<Puzzle[]>
- getConceptById(id): Promise<Concept>

## Import types from

import { Concept, ConceptPair, Puzzle, DDLConfig } from '../shared/types';

## Anti-correlated sampling algorithm

1. Pick a random concept from the database
2. Get ALL other concepts with their cosine similarity to the picked concept
3. Sort by ascending similarity (most distant first)
4. Sample from the bottom N% of the similarity distribution (N = antiCorrelationWindow from config, default 20%)
5. Return the pair with their cosine similarity score

## Chunking strategy

- Target chunk size: 100-300 tokens
- Split on paragraph breaks and section headers
- Never split mid-sentence
- For academic papers: extract abstract, each finding, each method, each conclusion as separate chunks

## Do NOT

- Touch any files outside src/data/
- Implement pipeline logic, evaluation, or UI
- Make assumptions about how your functions will be called — just expose clean async functions
