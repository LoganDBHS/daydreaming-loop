// src/dashboard/logger.ts — JSON-lines pipeline logger
import * as fs from 'fs';
import * as path from 'path';

const LOG_DIR = path.join(__dirname, '../../logs');
const LOG_FILE = path.join(LOG_DIR, 'pipeline.jsonl');

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

interface LogEntry {
  timestamp: string;
  type: string;
  [key: string]: unknown;
}

function writeEntry(entry: LogEntry) {
  ensureLogDir();
  fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n');
}

export function logPuzzleDiscarded(puzzleId: string, uScore: number, reason: string) {
  writeEntry({
    timestamp: new Date().toISOString(),
    type: 'puzzle_discarded',
    puzzleId,
    uScore,
    reason,
  });
}

export function logInsightDiscarded(
  insightId: string,
  compositeScore: number,
  failedStage: string,
  scores: Record<string, number>,
) {
  writeEntry({
    timestamp: new Date().toISOString(),
    type: 'insight_discarded',
    insightId,
    compositeScore,
    failedStage,
    scores,
  });
}

export function logReviewDecision(
  candidateId: string,
  decision: string,
  rejectionReason?: string,
  expertNotes?: string,
) {
  writeEntry({
    timestamp: new Date().toISOString(),
    type: 'review_decision',
    candidateId,
    decision,
    rejectionReason,
    expertNotes,
  });
}

export function logGeneric(type: string, data: Record<string, unknown>) {
  writeEntry({ timestamp: new Date().toISOString(), type, ...data });
}

export function readLogs(limit = 200): LogEntry[] {
  ensureLogDir();
  if (!fs.existsSync(LOG_FILE)) return [];
  const lines = fs.readFileSync(LOG_FILE, 'utf-8').trim().split('\n').filter(Boolean);
  return lines.slice(-limit).map((l) => JSON.parse(l));
}
