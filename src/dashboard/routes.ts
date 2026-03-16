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
import { chunkText } from '../data/index.js';
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

export type PipelineProgress = { current: number; total: number; phase: string };

export type PipelineRunner = (
  onStatus: (msg: string, progress?: PipelineProgress) => void,
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
  progress: PipelineProgress | null;
  result: any | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
} = { running: false, messages: [], progress: null, result: null, error: null, startedAt: null, finishedAt: null };

// ── Pipeline run history (persisted to disk) ──

import * as fs from 'fs';

const PERSIST_DIR = join(process.cwd(), 'data');
const HISTORY_FILE = join(PERSIST_DIR, 'pipeline-history.json');

function ensurePersistDir() {
  if (!fs.existsSync(PERSIST_DIR)) fs.mkdirSync(PERSIST_DIR, { recursive: true });
}

interface PipelineHistoryEntry {
  startedAt: string;
  finishedAt: string;
  result: any | null;
  error: string | null;
  duration: number; // ms
  batchSize: number | undefined;
}

const HISTORY_CAP = 100;

function loadHistory(): PipelineHistoryEntry[] {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
    }
  } catch { /* ignore corrupt file */ }
  return [];
}

function saveHistory() {
  ensurePersistDir();
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(pipelineHistory, null, 2));
}

const pipelineHistory: PipelineHistoryEntry[] = loadHistory();

function pushHistory(entry: PipelineHistoryEntry) {
  pipelineHistory.unshift(entry); // newest first
  if (pipelineHistory.length > HISTORY_CAP) {
    pipelineHistory.length = HISTORY_CAP;
  }
  saveHistory();
}

// ── Schedule state (in-memory) ──

interface ScheduleState {
  intervalMinutes: number;
  batchSize: number;
  active: boolean;
  createdAt: string;
  lastRunAt: string | null;
  nextRunAt: string | null;
  runCount: number;
  timerId: ReturnType<typeof setInterval> | null;
}

let schedule: ScheduleState | null = null;

export function setPipelineRunner(runner: PipelineRunner) {
  pipelineRunner = runner;
}

// ── SSE clients for pipeline streaming ──
let sseClients: Response[] = [];

function broadcastSSE(data: object) {
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    try { client.write(payload); } catch { /* ignore dead clients */ }
  }
}

router.get('/api/pipeline/stream', (req: Request, res: Response) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
  res.write('\n');
  sseClients.push(res);

  // If pipeline is already running, send current messages + latest progress
  if (pipelineStatus.running) {
    for (let i = 0; i < pipelineStatus.messages.length; i++) {
      const isLast = i === pipelineStatus.messages.length - 1;
      res.write(`data: ${JSON.stringify({ type: 'status', message: pipelineStatus.messages[i], progress: isLast ? pipelineStatus.progress : null })}\n\n`);
    }
  }

  req.on('close', () => {
    sseClients = sseClients.filter((c) => c !== res);
  });
});

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
    progress: null,
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
      (msg: string, progress?: PipelineProgress) => {
        pipelineStatus.messages.push(msg);
        if (progress) pipelineStatus.progress = progress;
        console.log(`[pipeline] ${msg}`);
        broadcastSSE({ type: 'status', message: msg, progress: progress ?? pipelineStatus.progress });
      },
      batchSize ? { batchSize } : undefined,
    )
  ).then((result) => {
    pipelineStatus.running = false;
    pipelineStatus.result = result;
    pipelineStatus.finishedAt = new Date().toISOString();
    console.log('[pipeline] Finished:', result);
    broadcastSSE({ type: 'complete', result });
    pushHistory({
      startedAt: pipelineStatus.startedAt!,
      finishedAt: pipelineStatus.finishedAt,
      result,
      error: null,
      duration: new Date(pipelineStatus.finishedAt).getTime() - new Date(pipelineStatus.startedAt!).getTime(),
      batchSize,
    });
  }).catch((err) => {
    pipelineStatus.running = false;
    pipelineStatus.error = err.message || String(err);
    pipelineStatus.finishedAt = new Date().toISOString();
    console.error('[pipeline] Error:', err);
    broadcastSSE({ type: 'error', error: pipelineStatus.error });
    pushHistory({
      startedAt: pipelineStatus.startedAt!,
      finishedAt: pipelineStatus.finishedAt,
      result: null,
      error: pipelineStatus.error,
      duration: new Date(pipelineStatus.finishedAt).getTime() - new Date(pipelineStatus.startedAt!).getTime(),
      batchSize,
    });
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
  } else if (filter === 'approved' || filter === 'rejected' || filter === 'investigate' || filter === 'refine') {
    // Filter reviewed candidates by specific decision type
    const reviewed = store.getReviewedCandidates();
    res.json(reviewed.filter((r) => r.decision.decision === filter));
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

router.post('/api/concepts/bulk-urls', upload.single('file'), async (req: Request, res: Response) => {
  const file = req.file;
  const domain = req.body.domain;
  if (!file || !domain) {
    res.status(400).json({ error: 'file and domain are required' });
    return;
  }

  try {
    const { readFile } = await import('node:fs/promises');
    const content = await readFile(file.path, 'utf-8');
    const urls = content.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('#'));

    if (urls.length === 0) {
      res.status(400).json({ error: 'No URLs found in file' });
      return;
    }

    const results: { url: string; count: number; error?: string }[] = [];
    let totalConcepts = 0;

    for (const url of urls) {
      try {
        const concepts = await addConceptsFromURL(url, domain);
        totalConcepts += concepts.length;
        results.push({ url, count: concepts.length });
        logGeneric('concepts_added_from_url', { url, domain, count: concepts.length });
      } catch (err: any) {
        results.push({ url, count: 0, error: err.message });
      }
    }

    const failures = results.filter(r => r.error).length;
    res.json({ ok: true, totalConcepts, totalUrls: urls.length, failures, results });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  } finally {
    try { await unlink(file.path); } catch { /* ignore */ }
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

// ── Chunk Staging (review before adding to vector store) ──

router.post('/api/concepts/document/stage', upload.single('file'), async (req: Request, res: Response) => {
  const file = req.file;
  const domain = req.body.domain;
  if (!file || !domain) {
    res.status(400).json({ error: 'file and domain are required' });
    return;
  }

  const ext = (file.originalname.match(/\.[^.]+$/) || [''])[0];
  const tmpPath = file.path + ext;

  try {
    const { rename, readFile } = await import('node:fs/promises');
    const { extname } = await import('node:path');

    await rename(file.path, tmpPath);

    const fileExt = extname(tmpPath).toLowerCase();
    let content: string;

    if (fileExt === '.html' || fileExt === '.htm') {
      const raw = await readFile(tmpPath, 'utf-8');
      content = raw
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
        .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
        .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim();
    } else if (fileExt === '.pdf') {
      const buffer = await readFile(tmpPath);
      const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>;
      const pdf = await pdfParse(buffer);
      content = pdf.text;
    } else {
      content = await readFile(tmpPath, 'utf-8');
    }

    const chunks = chunkText(content);
    const staged = chunks.map((text, i) => ({
      index: i,
      text,
      source: file.originalname,
      domain,
      estimatedTokens: Math.ceil(text.length / 4),
    }));

    res.json({ ok: true, chunks: staged, totalChunks: staged.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  } finally {
    try { await unlink(tmpPath); } catch { /* ignore */ }
    try { await unlink(file.path); } catch { /* ignore */ }
  }
});

router.post('/api/concepts/url/stage', async (req: Request, res: Response) => {
  const { url, domain } = req.body;
  if (!url || !domain) {
    res.status(400).json({ error: 'url and domain are required' });
    return;
  }

  try {
    const fetchRes = await fetch(url);
    if (!fetchRes.ok) {
      res.status(400).json({ error: `Failed to fetch URL: ${fetchRes.status} ${fetchRes.statusText}` });
      return;
    }

    const contentType = fetchRes.headers.get('content-type') ?? '';
    let text: string;

    if (contentType.includes('application/pdf')) {
      const buffer = Buffer.from(await fetchRes.arrayBuffer());
      const pdfParse = require('pdf-parse') as (buf: Buffer) => Promise<{ text: string }>;
      const pdf = await pdfParse(buffer);
      text = pdf.text;
    } else if (contentType.includes('text/html')) {
      const html = await fetchRes.text();
      text = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
        .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '')
        .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim();
    } else {
      text = await fetchRes.text();
    }

    const chunks = chunkText(text);
    const staged = chunks.map((chunkText, i) => ({
      index: i,
      text: chunkText,
      source: url,
      domain,
      estimatedTokens: Math.ceil(chunkText.length / 4),
    }));

    res.json({ ok: true, chunks: staged, totalChunks: staged.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/concepts/staged/approve', async (req: Request, res: Response) => {
  const { chunks, domain } = req.body;
  if (!chunks || !Array.isArray(chunks) || !domain) {
    res.status(400).json({ error: 'chunks (array) and domain are required' });
    return;
  }

  try {
    const added: any[] = [];
    for (const chunk of chunks) {
      if (!chunk.text) continue;
      const concept = await addConceptFromText(
        chunk.text,
        chunk.source || 'staged-review',
        chunk.domain || domain,
      );
      added.push(concept);
    }
    logGeneric('staged_chunks_approved', { domain, approvedCount: added.length, totalOffered: chunks.length });
    res.json({ ok: true, count: added.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Batch Scheduling ──

function runScheduledPipeline() {
  if (!pipelineRunner || pipelineStatus.running || !schedule) return;

  const batchSize = schedule.batchSize;
  pipelineStatus = {
    running: true,
    messages: [],
    progress: null,
    result: null,
    error: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };

  schedule.lastRunAt = new Date().toISOString();
  schedule.runCount++;
  if (schedule.intervalMinutes > 0) {
    schedule.nextRunAt = new Date(Date.now() + schedule.intervalMinutes * 60_000).toISOString();
  }

  const runner = pipelineRunner;
  Promise.resolve().then(() =>
    runner(
      (msg: string) => {
        pipelineStatus.messages.push(msg);
        console.log(`[scheduled-pipeline] ${msg}`);
        broadcastSSE({ type: 'status', message: msg });
      },
      { batchSize },
    )
  ).then((result) => {
    pipelineStatus.running = false;
    pipelineStatus.result = result;
    pipelineStatus.finishedAt = new Date().toISOString();
    logGeneric('scheduled_pipeline_complete', { result, runCount: schedule?.runCount });
    console.log('[scheduled-pipeline] Finished:', result);
    broadcastSSE({ type: 'complete', result });
    pushHistory({
      startedAt: pipelineStatus.startedAt!,
      finishedAt: pipelineStatus.finishedAt,
      result,
      error: null,
      duration: new Date(pipelineStatus.finishedAt).getTime() - new Date(pipelineStatus.startedAt!).getTime(),
      batchSize,
    });
  }).catch((err) => {
    pipelineStatus.running = false;
    pipelineStatus.error = err.message || String(err);
    pipelineStatus.finishedAt = new Date().toISOString();
    logGeneric('scheduled_pipeline_error', { error: pipelineStatus.error, runCount: schedule?.runCount });
    console.error('[scheduled-pipeline] Error:', err);
    broadcastSSE({ type: 'error', error: pipelineStatus.error });
    pushHistory({
      startedAt: pipelineStatus.startedAt!,
      finishedAt: pipelineStatus.finishedAt,
      result: null,
      error: pipelineStatus.error,
      duration: new Date(pipelineStatus.finishedAt).getTime() - new Date(pipelineStatus.startedAt!).getTime(),
      batchSize,
    });
  });
}

router.post('/api/schedule', (req: Request, res: Response) => {
  if (!pipelineRunner) {
    res.status(500).json({ error: 'Pipeline runner not configured' });
    return;
  }

  const intervalMinutes = parseInt(req.body?.intervalMinutes);
  const batchSize = parseInt(req.body?.batchSize) || 5;

  if (!intervalMinutes || intervalMinutes < 1) {
    res.status(400).json({ error: 'intervalMinutes is required and must be >= 1' });
    return;
  }

  // Cancel existing schedule if any
  if (schedule?.timerId) {
    clearInterval(schedule.timerId);
  }

  const timerId = setInterval(runScheduledPipeline, intervalMinutes * 60_000);

  schedule = {
    intervalMinutes,
    batchSize,
    active: true,
    createdAt: new Date().toISOString(),
    lastRunAt: null,
    nextRunAt: new Date(Date.now() + intervalMinutes * 60_000).toISOString(),
    runCount: 0,
    timerId,
  };

  logGeneric('schedule_created', { intervalMinutes, batchSize });

  res.json({
    ok: true,
    schedule: {
      intervalMinutes: schedule.intervalMinutes,
      batchSize: schedule.batchSize,
      active: schedule.active,
      createdAt: schedule.createdAt,
      nextRunAt: schedule.nextRunAt,
    },
  });
});

router.get('/api/schedule', (_req: Request, res: Response) => {
  if (!schedule) {
    res.json({ active: false });
    return;
  }
  res.json({
    active: schedule.active,
    intervalMinutes: schedule.intervalMinutes,
    batchSize: schedule.batchSize,
    createdAt: schedule.createdAt,
    lastRunAt: schedule.lastRunAt,
    nextRunAt: schedule.nextRunAt,
    runsCompleted: schedule.runCount,
  });
});

router.delete('/api/schedule', (_req: Request, res: Response) => {
  if (!schedule) {
    res.status(404).json({ error: 'No schedule is active' });
    return;
  }
  if (schedule.timerId) {
    clearInterval(schedule.timerId);
  }
  logGeneric('schedule_cancelled', { runCount: schedule.runCount });
  schedule = null;
  res.json({ ok: true, message: 'Schedule cancelled' });
});

// ── Runtime Config (in-memory overrides) ──

let configOverrides: Record<string, any> = {};

router.get('/api/config', (_req: Request, res: Response) => {
  // Return current effective config (env defaults + any overrides)
  res.json({
    antiCorrelationWindow: configOverrides.antiCorrelationWindow ?? parseFloat(process.env.DDL_ANTI_CORRELATION_WINDOW || '0.2'),
    defaultPairSize: configOverrides.defaultPairSize ?? parseInt(process.env.DDL_DEFAULT_PAIR_SIZE || '2'),
    batchSize: configOverrides.batchSize ?? parseInt(process.env.DDL_BATCH_SIZE || '5'),
    stThresholdPercentile: configOverrides.stThresholdPercentile ?? parseFloat(process.env.DDL_ST_THRESHOLD_PERCENTILE || '0.95'),
    stWindowSize: configOverrides.stWindowSize ?? parseInt(process.env.DDL_ST_WINDOW_SIZE || '50'),
    fertilityThreshold: configOverrides.fertilityThreshold ?? parseFloat(process.env.DDL_FERTILITY_THRESHOLD || '4'),
    resilienceThreshold: configOverrides.resilienceThreshold ?? parseFloat(process.env.DDL_RESILIENCE_THRESHOLD || '4'),
    compositeThreshold: configOverrides.compositeThreshold ?? parseFloat(process.env.DDL_COMPOSITE_THRESHOLD || '5.0'),
    compositeWeights: configOverrides.compositeWeights ?? {
      fertility: parseFloat(process.env.DDL_WEIGHT_FERTILITY || '0.35'),
      resilience: parseFloat(process.env.DDL_WEIGHT_RESILIENCE || '0.35'),
      unification: parseFloat(process.env.DDL_WEIGHT_UNIFICATION || '0.30'),
    },
  });
});

router.put('/api/config', (req: Request, res: Response) => {
  const body = req.body;
  if (!body || typeof body !== 'object') {
    res.status(400).json({ error: 'Request body must be a JSON object' });
    return;
  }

  // Store overrides — these get picked up on next pipeline run via env or direct read
  const allowedKeys = [
    'antiCorrelationWindow', 'defaultPairSize', 'batchSize',
    'stThresholdPercentile', 'stWindowSize',
    'fertilityThreshold', 'resilienceThreshold', 'compositeThreshold',
    'compositeWeights',
  ];
  for (const key of allowedKeys) {
    if (body[key] !== undefined) {
      configOverrides[key] = body[key];
    }
  }

  // Also set env vars so loadConfig() in main.ts picks them up
  if (body.antiCorrelationWindow != null) process.env.DDL_ANTI_CORRELATION_WINDOW = String(body.antiCorrelationWindow);
  if (body.defaultPairSize != null) process.env.DDL_DEFAULT_PAIR_SIZE = String(body.defaultPairSize);
  if (body.batchSize != null) process.env.DDL_BATCH_SIZE = String(body.batchSize);
  if (body.stThresholdPercentile != null) process.env.DDL_ST_THRESHOLD_PERCENTILE = String(body.stThresholdPercentile);
  if (body.stWindowSize != null) process.env.DDL_ST_WINDOW_SIZE = String(body.stWindowSize);
  if (body.fertilityThreshold != null) process.env.DDL_FERTILITY_THRESHOLD = String(body.fertilityThreshold);
  if (body.resilienceThreshold != null) process.env.DDL_RESILIENCE_THRESHOLD = String(body.resilienceThreshold);
  if (body.compositeThreshold != null) process.env.DDL_COMPOSITE_THRESHOLD = String(body.compositeThreshold);
  if (body.compositeWeights) {
    if (body.compositeWeights.fertility != null) process.env.DDL_WEIGHT_FERTILITY = String(body.compositeWeights.fertility);
    if (body.compositeWeights.resilience != null) process.env.DDL_WEIGHT_RESILIENCE = String(body.compositeWeights.resilience);
    if (body.compositeWeights.unification != null) process.env.DDL_WEIGHT_UNIFICATION = String(body.compositeWeights.unification);
  }

  logGeneric('config_updated', body);
  res.json({ ok: true, config: body });
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

  // Recommendations based on rejection patterns
  const recommendations: string[] = [];
  const totalRejections = rejections.length;
  if (totalRejections > 0) {
    const topReason = Object.entries(reasons).sort((a, b) => b[1] - a[1])[0];
    if (topReason) {
      const [reason, count] = topReason;
      const pct = (count / totalRejections) * 100;
      if (reason === 'already_known' && pct > 30) {
        recommendations.push('Novelty search may need strengthening — most rejections are "already_known".');
      }
      if (reason === 'trivially_obvious' && pct > 30) {
        recommendations.push('Surprise threshold (ST) may be too low — many insights are trivially obvious.');
      }
      if (reason === 'factually_wrong' && pct > 20) {
        recommendations.push('Consider adding a factual verification stage to the pipeline.');
      }
      if (reason === 'too_vague' && pct > 25) {
        recommendations.push('Insight generation prompts may need more specificity constraints.');
      }
      if (reason === 'not_actionable' && pct > 25) {
        recommendations.push('Fertility evaluation may need recalibration — insights lack actionability.');
      }
      if (reason === 'rhetorical_mimicry' && pct > 20) {
        recommendations.push('Adversarial stress testing should be strengthened to catch rhetorical mimicry.');
      }
    }
    if (decisions.length > 0) {
      const approvalRate = decisions.filter((d) => d.decision === 'approved').length / decisions.length;
      if (approvalRate < 0.05 && decisions.length >= 5) {
        recommendations.push('Very low approval rate — consider relaxing composite threshold or reviewing concept quality.');
      }
      if (approvalRate > 0.5 && decisions.length >= 5) {
        recommendations.push('Very high approval rate — pipeline may not be generating enough volume or thresholds are too strict pre-review.');
      }
    }
  }

  // Acceptance rate history — group decisions by date
  const rateByDate: Record<string, { approved: number; total: number }> = {};
  for (const d of decisions) {
    const date = new Date(d.reviewedAt).toISOString().slice(0, 10);
    if (!rateByDate[date]) rateByDate[date] = { approved: 0, total: 0 };
    rateByDate[date].total++;
    if (d.decision === 'approved') rateByDate[date].approved++;
  }
  const acceptanceRateHistory = Object.entries(rateByDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, { approved, total }]) => ({
      date,
      rate: total > 0 ? parseFloat(((approved / total) * 100).toFixed(1)) : 0,
    }));

  // Rejections by stage — use log data
  const logs = readLogs(10000);
  const rejectionsByStage: Record<string, number> = {
    puzzle_discarded: 0,
    insight_discarded: 0,
    expert_rejected: totalRejections,
  };
  for (const log of logs) {
    if (log.type === 'puzzle_discarded') {
      rejectionsByStage.puzzle_discarded++;
    } else if (log.type === 'insight_discarded') {
      rejectionsByStage.insight_discarded++;
    }
  }

  res.json({
    totalDecisions: decisions.length,
    totalRejections: rejections.length,
    rejectionsByReason: reasons,
    approvalRate: decisions.length > 0
      ? ((decisions.filter((d) => d.decision === 'approved').length / decisions.length) * 100).toFixed(1) + '%'
      : 'N/A',
    recommendations,
    acceptanceRateHistory,
    rejectionsByStage,
  });
});

// ── Adaptive Threshold Recommendation ──

router.get('/api/analytics/threshold-recommendation', (_req: Request, res: Response) => {
  const decisions = store.getAllDecisions();
  const logs = readLogs(10000);

  // Calculate acceptance rate from decisions
  const totalDecisions = decisions.length;
  const approved = decisions.filter((d) => d.decision === 'approved').length;
  const acceptanceRate = totalDecisions > 0 ? (approved / totalDecisions) * 100 : null;

  // Gather discarded insight scores from logs for calibration
  const discardedInsightScores: number[] = [];
  for (const log of logs) {
    if (log.type === 'insight_discarded' && typeof log.compositeScore === 'number') {
      discardedInsightScores.push(log.compositeScore);
    }
  }

  // Gather evaluated insight scores
  const evaluatedScores: number[] = [];
  for (const log of logs) {
    if (log.type === 'insight_evaluated' && typeof log.compositeScore === 'number') {
      evaluatedScores.push(log.compositeScore);
    }
  }

  // Current thresholds from env (defaults match main.ts loadConfig)
  const currentCompositeThreshold = parseFloat(process.env.DDL_COMPOSITE_THRESHOLD || '5.0');
  const currentFertilityThreshold = parseFloat(process.env.DDL_FERTILITY_THRESHOLD || '4');
  const currentResilienceThreshold = parseFloat(process.env.DDL_RESILIENCE_THRESHOLD || '4');

  let direction: 'tighten' | 'loosen' | 'maintain' = 'maintain';
  let reasoning: string;
  const recommendedThresholds = {
    compositeThreshold: currentCompositeThreshold,
    fertilityThreshold: currentFertilityThreshold,
    resilienceThreshold: currentResilienceThreshold,
  };

  if (acceptanceRate === null || totalDecisions < 3) {
    reasoning = 'Not enough decisions to make a recommendation. Need at least 3 reviewed decisions.';
  } else if (acceptanceRate > 15) {
    direction = 'tighten';
    reasoning = `Acceptance rate is ${acceptanceRate.toFixed(1)}% (above 15%). Too many candidates are passing through — tighten thresholds to improve signal-to-noise.`;
    // Increase thresholds by 10-20% depending on how far above 15%
    const factor = 1 + Math.min((acceptanceRate - 15) / 100, 0.2);
    recommendedThresholds.compositeThreshold = parseFloat((currentCompositeThreshold * factor).toFixed(2));
    recommendedThresholds.fertilityThreshold = parseFloat((currentFertilityThreshold * factor).toFixed(2));
    recommendedThresholds.resilienceThreshold = parseFloat((currentResilienceThreshold * factor).toFixed(2));
  } else if (acceptanceRate < 2) {
    direction = 'loosen';
    reasoning = `Acceptance rate is ${acceptanceRate.toFixed(1)}% (below 2%). Too few candidates are passing — loosen thresholds to avoid discarding potentially valuable insights.`;
    // Decrease thresholds by 10-15%
    const factor = 1 - Math.min((2 - acceptanceRate) / 20, 0.15);
    recommendedThresholds.compositeThreshold = parseFloat((currentCompositeThreshold * factor).toFixed(2));
    recommendedThresholds.fertilityThreshold = parseFloat((currentFertilityThreshold * factor).toFixed(2));
    recommendedThresholds.resilienceThreshold = parseFloat((currentResilienceThreshold * factor).toFixed(2));
  } else {
    reasoning = `Acceptance rate is ${acceptanceRate.toFixed(1)}% (between 2-15%). Thresholds appear well-calibrated.`;
  }

  res.json({
    acceptanceRate: acceptanceRate !== null ? acceptanceRate.toFixed(1) + '%' : null,
    totalDecisions,
    approved,
    direction,
    recommendation: reasoning,
    currentThresholds: {
      compositeThreshold: currentCompositeThreshold,
      fertilityThreshold: currentFertilityThreshold,
      resilienceThreshold: currentResilienceThreshold,
    },
    suggestedChanges: direction !== 'maintain' ? recommendedThresholds : undefined,
    discardedInsightCount: discardedInsightScores.length,
    avgDiscardedScore: discardedInsightScores.length > 0
      ? parseFloat((discardedInsightScores.reduce((a, b) => a + b, 0) / discardedInsightScores.length).toFixed(2))
      : null,
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

// ── Citation Import (BibTeX / RIS) ──

function parseBibtex(bibtex: string): Array<{ title: string; abstract: string; author: string; year: string }> {
  const entries: Array<{ title: string; abstract: string; author: string; year: string }> = [];
  // Match entries like @article{key, ...}, @inproceedings{key, ...}, etc.
  const entryRegex = /@\w+\s*\{[^,]*,([\s\S]*?)(?=\n@|\s*$)/g;
  let match: RegExpExecArray | null;
  while ((match = entryRegex.exec(bibtex)) !== null) {
    const body = match[1];
    const getField = (name: string): string => {
      const re = new RegExp(`${name}\\s*=\\s*(?:\\{([^}]*)\\}|"([^"]*)"|([0-9]+))`, 'i');
      const m = re.exec(body);
      return (m?.[1] ?? m?.[2] ?? m?.[3] ?? '').trim();
    };
    const title = getField('title');
    const abstract_ = getField('abstract');
    const author = getField('author');
    const year = getField('year');
    if (title) {
      entries.push({ title, abstract: abstract_, author, year });
    }
  }
  return entries;
}

function parseRIS(ris: string): Array<{ title: string; abstract: string; author: string; year: string }> {
  const entries: Array<{ title: string; abstract: string; author: string; year: string }> = [];
  const records = ris.split(/^ER\s\s-/m);
  for (const record of records) {
    const trimmed = record.trim();
    if (!trimmed) continue;
    const getTag = (tag: string): string => {
      const re = new RegExp(`^${tag}\\s\\s-\\s(.*)$`, 'gm');
      const values: string[] = [];
      let m: RegExpExecArray | null;
      while ((m = re.exec(trimmed)) !== null) {
        values.push(m[1].trim());
      }
      return values.join('; ');
    };
    const title = getTag('TI') || getTag('T1');
    const abstract_ = getTag('AB') || getTag('N2');
    const author = getTag('AU') || getTag('A1');
    const year = getTag('PY') || getTag('Y1');
    if (title) {
      entries.push({ title, abstract: abstract_, author, year: year.replace(/\/.*$/, '') });
    }
  }
  return entries;
}

router.post('/api/concepts/bibtex', async (req: Request, res: Response) => {
  const { bibtex, domain } = req.body;
  if (!bibtex || !domain) {
    res.status(400).json({ error: 'bibtex and domain are required' });
    return;
  }
  try {
    const entries = parseBibtex(bibtex);
    let count = 0;
    for (const entry of entries) {
      const text = entry.abstract
        ? `${entry.title}. ${entry.abstract}`
        : entry.title;
      const source = [entry.author, entry.year].filter(Boolean).join(' ') || 'BibTeX import';
      await addConceptFromText(text, source, domain);
      count++;
    }
    logGeneric('concepts_added_from_bibtex', { domain, count, totalEntries: entries.length });
    res.json({ ok: true, count });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/api/concepts/ris', async (req: Request, res: Response) => {
  const { ris, domain } = req.body;
  if (!ris || !domain) {
    res.status(400).json({ error: 'ris and domain are required' });
    return;
  }
  try {
    const entries = parseRIS(ris);
    let count = 0;
    for (const entry of entries) {
      const text = entry.abstract
        ? `${entry.title}. ${entry.abstract}`
        : entry.title;
      const source = [entry.author, entry.year].filter(Boolean).join(' ') || 'RIS import';
      await addConceptFromText(text, source, domain);
      count++;
    }
    logGeneric('concepts_added_from_ris', { domain, count, totalEntries: entries.length });
    res.json({ ok: true, count });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── Pipeline History ──

router.get('/api/pipeline/history', (_req: Request, res: Response) => {
  res.json(pipelineHistory);
});

// ── Export Routes ──

router.get('/api/export/approved', (_req: Request, res: Response) => {
  const format = ((_req.query.format as string) || 'json').toLowerCase();
  const reviewed = store.getReviewedCandidates();
  const approved = reviewed.filter((r) => r.decision.decision === 'approved');

  if (format === 'csv') {
    const header = 'insight_id,insight_statement,mechanism,puzzle_statement,concept_a,concept_b,composite_score,fertility,resilience,unification,is_novel,is_grounded,approved_at,expert_notes';
    const rows = approved.map((r) => {
      const c = r.candidate;
      const d = r.decision;
      const csvEsc = (s: string) => '"' + (s || '').replace(/"/g, '""').replace(/\n/g, ' ') + '"';
      return [
        csvEsc(c.insight.id),
        csvEsc(c.insight.insightStatement),
        csvEsc(c.insight.mechanism),
        csvEsc(c.puzzle.puzzleStatement),
        csvEsc(c.sourceConcepts[0]?.text || ''),
        csvEsc(c.sourceConcepts[1]?.text || ''),
        c.evaluation.compositeScore,
        c.evaluation.fertility?.overallScore ?? '',
        c.evaluation.adversarial?.overallResilience ?? '',
        c.evaluation.unification?.unificationScore ?? '',
        c.evaluation.novelty.isNovel,
        c.evaluation.grounding.isGrounded,
        csvEsc(String(d.reviewedAt)),
        csvEsc(d.expertNotes || ''),
      ].join(',');
    });
    const csv = header + '\n' + rows.join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="ddl-approved-insights.csv"');
    res.send(csv);
  } else if (format === 'markdown') {
    let md = '# DDL Approved Insights\n\n';
    md += `Exported at: ${new Date().toISOString()}\n`;
    md += `Total approved: ${approved.length}\n\n---\n\n`;
    for (const r of approved) {
      const c = r.candidate;
      const d = r.decision;
      md += `## ${c.insight.insightStatement}\n\n`;
      md += `**ID:** ${c.insight.id}\n\n`;
      md += `**Mechanism:** ${c.insight.mechanism}\n\n`;
      md += `### Source Puzzle\n\n${c.puzzle.puzzleStatement}\n\n`;
      md += `**Why surprising:** ${c.puzzle.whyHardToExplain}\n\n`;
      md += `### Source Concepts\n\n`;
      md += `- **${c.sourceConcepts[0]?.domain || 'N/A'}:** ${c.sourceConcepts[0]?.text || 'N/A'} *(${c.sourceConcepts[0]?.source || ''})*\n`;
      md += `- **${c.sourceConcepts[1]?.domain || 'N/A'}:** ${c.sourceConcepts[1]?.text || 'N/A'} *(${c.sourceConcepts[1]?.source || ''})*\n\n`;
      md += `### Evaluation Scores\n\n`;
      md += `| Metric | Score |\n|--------|-------|\n`;
      md += `| Composite | ${c.evaluation.compositeScore} |\n`;
      if (c.evaluation.fertility) md += `| Fertility | ${c.evaluation.fertility.overallScore} |\n`;
      if (c.evaluation.adversarial) md += `| Resilience | ${c.evaluation.adversarial.overallResilience} |\n`;
      if (c.evaluation.unification) md += `| Unification | ${c.evaluation.unification.unificationScore} |\n`;
      md += `| Novel | ${c.evaluation.novelty.isNovel ? 'Yes' : 'No'} |\n`;
      md += `| Grounded | ${c.evaluation.grounding.isGrounded ? 'Yes' : 'No'} |\n\n`;
      if (d.expertNotes) md += `**Expert Notes:** ${d.expertNotes}\n\n`;
      md += `**Approved at:** ${d.reviewedAt}\n\n---\n\n`;
    }
    res.setHeader('Content-Type', 'text/markdown');
    res.setHeader('Content-Disposition', 'attachment; filename="ddl-approved-insights.md"');
    res.send(md);
  } else {
    // JSON (default)
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="ddl-approved-insights.json"');
    res.json(approved);
  }
});

router.get('/api/export/candidates', (_req: Request, res: Response) => {
  const format = ((_req.query.format as string) || 'json').toLowerCase();
  const allCandidates = store.getAllCandidates();
  const allDecisions = store.getAllDecisions();

  const combined = allCandidates.map((c) => {
    const decision = allDecisions.find((d) => d.candidateId === c.insight.id);
    return { candidate: c, decision: decision ?? null };
  });

  if (format === 'csv') {
    const header = 'insight_id,insight_statement,mechanism,puzzle_statement,concept_a,concept_b,composite_score,fertility,resilience,unification,is_novel,is_grounded,decision,rejection_reason,reviewed_at,expert_notes';
    const rows = combined.map((r) => {
      const c = r.candidate;
      const d = r.decision;
      const csvEsc = (s: string) => '"' + (s || '').replace(/"/g, '""').replace(/\n/g, ' ') + '"';
      return [
        csvEsc(c.insight.id),
        csvEsc(c.insight.insightStatement),
        csvEsc(c.insight.mechanism),
        csvEsc(c.puzzle.puzzleStatement),
        csvEsc(c.sourceConcepts[0]?.text || ''),
        csvEsc(c.sourceConcepts[1]?.text || ''),
        c.evaluation.compositeScore,
        c.evaluation.fertility?.overallScore ?? '',
        c.evaluation.adversarial?.overallResilience ?? '',
        c.evaluation.unification?.unificationScore ?? '',
        c.evaluation.novelty.isNovel,
        c.evaluation.grounding.isGrounded,
        csvEsc(d?.decision || 'pending'),
        csvEsc(d?.rejectionReason || ''),
        csvEsc(d ? String(d.reviewedAt) : ''),
        csvEsc(d?.expertNotes || ''),
      ].join(',');
    });
    const csv = header + '\n' + rows.join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="ddl-all-candidates.csv"');
    res.send(csv);
  } else {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="ddl-all-candidates.json"');
    res.json(combined);
  }
});

router.get('/api/export/analytics', (_req: Request, res: Response) => {
  const decisions = store.getAllDecisions();
  const rejections = decisions.filter((d) => d.decision === 'rejected');
  const reasons: Record<string, number> = {};
  for (const d of rejections) {
    const reason = d.rejectionReason || 'unknown';
    reasons[reason] = (reasons[reason] || 0) + 1;
  }

  const logs = readLogs(10000);
  const rejectionsByStage: Record<string, number> = {
    puzzle_discarded: 0,
    insight_discarded: 0,
    expert_rejected: rejections.length,
  };
  for (const log of logs) {
    if (log.type === 'puzzle_discarded') rejectionsByStage.puzzle_discarded++;
    else if (log.type === 'insight_discarded') rejectionsByStage.insight_discarded++;
  }

  const totalDecisions = decisions.length;
  const approved = decisions.filter((d) => d.decision === 'approved').length;

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', 'attachment; filename="ddl-analytics.json"');
  res.json({
    exportedAt: new Date().toISOString(),
    totalDecisions,
    approved,
    rejected: rejections.length,
    approvalRate: totalDecisions > 0 ? ((approved / totalDecisions) * 100).toFixed(1) + '%' : 'N/A',
    rejectionsByReason: reasons,
    rejectionsByStage,
    currentThresholds: {
      compositeThreshold: parseFloat(process.env.DDL_COMPOSITE_THRESHOLD || '5.0'),
      fertilityThreshold: parseFloat(process.env.DDL_FERTILITY_THRESHOLD || '4'),
      resilienceThreshold: parseFloat(process.env.DDL_RESILIENCE_THRESHOLD || '4'),
    },
  });
});

export default router;
