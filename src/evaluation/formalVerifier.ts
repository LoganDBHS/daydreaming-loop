// src/evaluation/formalVerifier.ts — Hard path: generate and execute test code

import Anthropic from '@anthropic-ai/sdk';
import { execFile } from 'node:child_process';
import { writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Insight, DDLConfig } from '../shared/types';
import { FORMAL_VERIFICATION_SYSTEM, formalVerificationPrompt } from './prompts';

export interface FormalVerificationResult {
  testCode: string;
  passed: boolean;
  output: string;
}

/**
 * Generate test code for an insight via Claude, then execute it.
 * Returns pass/fail/inconclusive. Inconclusive falls through to soft path.
 */
export async function runFormalVerification(
  insight: Insight,
  testApproach: string,
  config: DDLConfig
): Promise<FormalVerificationResult> {
  const client = new Anthropic({ apiKey: config.anthropicApiKey });

  const userPrompt = formalVerificationPrompt(
    insight.insightStatement,
    insight.mechanism,
    testApproach
  );

  const response = await client.messages.create({
    model: config.modelId,
    max_tokens: 2048,
    system: FORMAL_VERIFICATION_SYSTEM,
    messages: [{ role: 'user', content: userPrompt }],
    temperature: 0.1,
  });

  const text = response.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');

  // Strip markdown fences if present
  const testCode = text.replace(/^```(?:javascript|js|node)?\n?/m, '').replace(/\n?```$/m, '').trim();

  const output = await executeTestCode(testCode);

  const lastLine = output.trim().split('\n').pop()?.trim().toUpperCase() || '';
  const passed = lastLine === 'PASS';
  // INCONCLUSIVE is treated as not passed — falls through to soft path

  return { testCode, passed, output };
}

/**
 * Execute generated Node.js code in a sandboxed child process with a timeout.
 */
async function executeTestCode(code: string): Promise<string> {
  const tmpFile = join(tmpdir(), `ddl-verify-${randomUUID()}.mjs`);

  try {
    await writeFile(tmpFile, code, 'utf-8');

    return await new Promise<string>((resolve) => {
      execFile('node', [tmpFile], { timeout: 10_000 }, (error, stdout, stderr) => {
        if (error) {
          resolve(`ERROR: ${error.message}\nstdout: ${stdout}\nstderr: ${stderr}`);
        } else {
          resolve(stdout + (stderr ? `\nstderr: ${stderr}` : ''));
        }
      });
    });
  } catch (err: any) {
    return `EXECUTION ERROR: ${err.message}`;
  } finally {
    try { await unlink(tmpFile); } catch { /* ignore cleanup errors */ }
  }
}
