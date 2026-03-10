// src/data/index.ts — Public exports for the data layer

// Vector store CRUD
export {
  addConcept,
  getConceptById,
  getAllConcepts,
  queryByText,
  queryByEmbedding,
  getConceptCount,
  deleteConcept,
  deleteAllConcepts,
} from "./vectorStore.js";

// Ingestion
export {
  addConceptFromText,
  addConceptsFromDocument,
  addConceptsFromURL,
} from "./ingest.js";

// Anti-correlated sampling
export {
  getRandomAntiCorrelatedPair,
  getRelatedConcepts,
} from "./sampler.js";

// Puzzle bank
export {
  storePuzzle,
  getAllValidatedPuzzles,
  getAllPuzzles,
  getPuzzleById,
} from "./puzzleBank.js";

// Embedding (for use by other modules if needed)
export { embed, embedBatch } from "./embedder.js";

// Chunking (for use by other modules if needed)
export { chunkText, chunkAcademicPaper } from "./chunker.js";
