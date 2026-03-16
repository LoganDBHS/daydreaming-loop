// src/dashboard/reviewStore.ts — persisted store for review candidates and decisions
import fs from 'fs';
import path from 'path';
import { ReviewCandidate, ReviewDecision } from '../shared/types';
import { logReviewDecision } from './logger';

// ── File persistence setup ──

// Use process.cwd() since tsx resolves __dirname to '.'
const DATA_DIR = path.join(process.cwd(), 'data');
const CANDIDATES_FILE = path.join(DATA_DIR, 'review-candidates.json');
const DECISIONS_FILE = path.join(DATA_DIR, 'review-decisions.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadMap<T>(filePath: string): Map<string, T> {
  if (!fs.existsSync(filePath)) return new Map();
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const entries: [string, T][] = JSON.parse(raw);
    return new Map(entries);
  } catch {
    return new Map();
  }
}

function persistMap<T>(filePath: string, map: Map<string, T>) {
  const entries = Array.from(map.entries());
  fs.writeFileSync(filePath, JSON.stringify(entries, null, 2));
}

// ── Load existing data on module init ──

const candidates = loadMap<ReviewCandidate>(CANDIDATES_FILE);
const decisions = loadMap<ReviewDecision>(DECISIONS_FILE);

// ── Candidates ──

export function addCandidate(candidate: ReviewCandidate) {
  candidates.set(candidate.insight.id, candidate);
  persistMap(CANDIDATES_FILE, candidates);
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
  persistMap(DECISIONS_FILE, decisions);
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
