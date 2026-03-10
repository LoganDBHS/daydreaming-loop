// src/dashboard/routes.ts — API routes for the dashboard
import { Router, Request, Response } from 'express';
import { ReviewDecision } from '../shared/types';
import * as store from './reviewStore';
import { readLogs, logGeneric } from './logger';
import {
  addConceptFromText,
  addConceptsFromURL,
  addConceptsFromDocument,
} from '../data/index.js';
import { getAllConcepts, getConceptCount, deleteConcept } from '../data/index.js';
import multer from 'multer';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const upload = multer({
  dest: join(tmpdir(), 'ddl-uploads'),
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB
});

const router = Router();

// ── Pipeline runner (injected from main.ts) ──

export type PipelineRunner = (
  onStatus: (msg: string) => void,
  overrides?: { batchSize?: number },
) => Promise<{
  pairsProcessed: number;
  puzzlesValidated: number;
  insightsGenerated: number;
  candidatesAdded: number;
}>;

let pipelineRunner: PipelineRunner | null = null;
let pipelineStatus: {
  running: boolean;
  messages: string[];
  result: any | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
} = { running: false, messages: [], result: null, error: null, startedAt: null, finishedAt: null };

export function setPipelineRunner(runner: PipelineRunner) {
  pipelineRunner = runner;
}

router.post('/api/pipeline/run', (req: Request, res: Response) => {
  if (!pipelineRunner) {
    res.status(500).json({ error: 'Pipeline runner not configured' });
    return;
  }
  if (pipelineStatus.running) {
    res.status(409).json({ error: 'Pipeline is already running' });
    return;
  }

  const batchSize = req.body?.batchSize ? parseInt(req.body.batchSize) : undefined;

  pipelineStatus = {
    running: true,
    messages: [],
    result: null,
    error: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };

  res.json({ ok: true, message: 'Pipeline started' });

  // Run in background — response already sent
  const runner = pipelineRunner;
  Promise.resolve().then(() =>
    runner(
      (msg: string) => {
        pipelineStatus.messages.push(msg);
        console.log(`[pipeline] ${msg}`);
      },
      batchSize ? { batchSize } : undefined,
    )
  ).then((result) => {
    pipelineStatus.running = false;
    pipelineStatus.result = result;
    pipelineStatus.finishedAt = new Date().toISOString();
    console.log('[pipeline] Finished:', result);
  }).catch((err) => {
    pipelineStatus.running = false;
    pipelineStatus.error = err.message || String(err);
    pipelineStatus.finishedAt = new Date().toISOString();
    console.error('[pipeline] Error:', err);
  });
});

router.get('/api/pipeline/status', (_req: Request, res: Response) => {
  res.json(pipelineStatus);
});

// ── Candidates ──

router.get('/api/candidates', (_req: Request, res: Response) => {
  const filter = _req.query.filter as string | undefined;
  if (filter === 'pending') {
    res.json(store.getPendingCandidates());
  } else if (filter === 'reviewed') {
    res.json(store.getReviewedCandidates());
  } else {
    res.json(store.getAllCandidates());
  }
});

router.get('/api/candidates/:id', (req: Request, res: Response) => {
  const id = req.params.id as string;
  const candidate = store.getCandidate(id);
  if (!candidate) {
    res.status(404).json({ error: 'Candidate not found' });
    return;
  }
  const decision = store.getDecision(id);
  res.json({ candidate, decision: decision ?? null });
});

// ── Decisions ──

router.post('/api/decisions', (req: Request, res: Response) => {
  const body = req.body;
  if (!body.candidateId || !body.decision) {
    res.status(400).json({ error: 'candidateId and decision are required' });
    return;
  }
  const validDecisions = ['approved', 'rejected', 'investigate', 'refine'];
  if (!validDecisions.includes(body.decision)) {
    res.status(400).json({ error: `decision must be one of: ${validDecisions.join(', ')}` });
    return;
  }
  if (body.decision === 'rejected' && !body.rejectionReason) {
    res.status(400).json({ error: 'rejectionReason is required when rejecting' });
    return;
  }

  const decision: ReviewDecision = {
    candidateId: body.candidateId,
    decision: body.decision,
    rejectionReason: body.rejectionReason,
    expertNotes: body.expertNotes,
    reviewedAt: new Date(),
    reviewedBy: body.reviewedBy || 'expert',
  };

  store.submitDecision(decision);
  res.json({ ok: true, decision });
});

router.get('/api/decisions', (_req: Request, res: Response) => {
  res.json(store.getAllDecisions());
});

// ── Stats ──

router.get('/api/stats', (_req: Request, res: Response) => {
  res.json(store.getStats());
});

// ── Logs ──

router.get('/api/logs', (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 200;
  res.json(readLogs(limit));
});

// ── Concepts ──

router.get('/api/concepts', async (_req: Request, res: Response) => {
  try {
    const concepts = await getAllConcepts();
    res.json(concepts);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/api/concepts/count', async (_req: Request, res: Response) => {
  try {
    const count = await getConceptCount();
    res.json({ count });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/concepts/text', async (req: Request, res: Response) => {
  const { text, source, domain } = req.body;
  if (!text || !source || !domain) {
    res.status(400).json({ error: 'text, source, and domain are required' });
    return;
  }
  try {
    const concept = await addConceptFromText(text, source, domain);
    logGeneric('concept_added', { conceptId: concept.id, source, domain, sourceType: 'manual' });
    res.json({ ok: true, concept });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/concepts/url', async (req: Request, res: Response) => {
  const { url, domain } = req.body;
  if (!url || !domain) {
    res.status(400).json({ error: 'url and domain are required' });
    return;
  }
  try {
    const concepts = await addConceptsFromURL(url, domain);
    logGeneric('concepts_added_from_url', { url, domain, count: concepts.length });
    res.json({ ok: true, concepts, count: concepts.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/concepts/document', upload.single('file'), async (req: Request, res: Response) => {
  const file = req.file;
  const domain = req.body.domain;
  if (!file || !domain) {
    res.status(400).json({ error: 'file and domain are required' });
    return;
  }

  // Multer saves file with no extension — rename to preserve it
  const ext = (file.originalname.match(/\.[^.]+$/) || [''])[0];
  const tmpPath = file.path + ext;

  try {
    const { rename } = await import('node:fs/promises');
    await rename(file.path, tmpPath);
    const concepts = await addConceptsFromDocument(tmpPath, domain);
    logGeneric('concepts_added_from_document', { filename: file.originalname, domain, count: concepts.length });
    res.json({ ok: true, count: concepts.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  } finally {
    try { await unlink(tmpPath); } catch { /* ignore */ }
    try { await unlink(file.path); } catch { /* ignore */ }
  }
});

// ── Analytics ──

router.get('/api/analytics/rejections', (_req: Request, res: Response) => {
  const decisions = store.getAllDecisions();
  const rejections = decisions.filter((d) => d.decision === 'rejected');
  const reasons: Record<string, number> = {};
  for (const d of rejections) {
    const reason = d.rejectionReason || 'unknown';
    reasons[reason] = (reasons[reason] || 0) + 1;
  }
  res.json({
    totalDecisions: decisions.length,
    totalRejections: rejections.length,
    rejectionsByReason: reasons,
    approvalRate: decisions.length > 0
      ? ((decisions.filter((d) => d.decision === 'approved').length / decisions.length) * 100).toFixed(1) + '%'
      : 'N/A',
  });
});

router.delete('/api/concepts/:id', async (req: Request, res: Response) => {
  const id = req.params.id as string;
  try {
    await deleteConcept(id);
    logGeneric('concept_deleted', { conceptId: id });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
