// src/dashboard/reviewStore.ts — in-memory store for review candidates and decisions
import { ReviewCandidate, ReviewDecision } from '../shared/types';
import { logReviewDecision } from './logger';

const candidates = new Map<string, ReviewCandidate>();
const decisions = new Map<string, ReviewDecision>();

// ── Candidates ──

export function addCandidate(candidate: ReviewCandidate) {
  candidates.set(candidate.insight.id, candidate);
}

export function getCandidate(insightId: string): ReviewCandidate | undefined {
  return candidates.get(insightId);
}

export function getAllCandidates(): ReviewCandidate[] {
  return Array.from(candidates.values());
}

export function getPendingCandidates(): ReviewCandidate[] {
  return getAllCandidates().filter((c) => !decisions.has(c.insight.id));
}

export function getReviewedCandidates(): Array<{ candidate: ReviewCandidate; decision: ReviewDecision }> {
  const results: Array<{ candidate: ReviewCandidate; decision: ReviewDecision }> = [];
  for (const [id, decision] of decisions) {
    const candidate = candidates.get(id);
    if (candidate) results.push({ candidate, decision });
  }
  return results;
}

// ── Decisions ──

export function submitDecision(decision: ReviewDecision) {
  decisions.set(decision.candidateId, decision);
  logReviewDecision(
    decision.candidateId,
    decision.decision,
    decision.rejectionReason,
    decision.expertNotes,
  );
}

export function getDecision(candidateId: string): ReviewDecision | undefined {
  return decisions.get(candidateId);
}

export function getAllDecisions(): ReviewDecision[] {
  return Array.from(decisions.values());
}

// ── Stats ──

export function getStats() {
  const allDecisions = getAllDecisions();
  return {
    totalCandidates: candidates.size,
    pending: candidates.size - decisions.size,
    approved: allDecisions.filter((d) => d.decision === 'approved').length,
    rejected: allDecisions.filter((d) => d.decision === 'rejected').length,
    investigating: allDecisions.filter((d) => d.decision === 'investigate').length,
    refined: allDecisions.filter((d) => d.decision === 'refine').length,
  };
}
