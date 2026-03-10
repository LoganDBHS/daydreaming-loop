// src/dashboard/index.ts — public exports for the dashboard
export { createServer } from './server';
export { addCandidate, getCandidate, getAllCandidates, getPendingCandidates, getReviewedCandidates, submitDecision, getDecision, getAllDecisions, getStats } from './reviewStore';
export { logPuzzleDiscarded, logInsightDiscarded, logReviewDecision, logGeneric, readLogs } from './logger';
