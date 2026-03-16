// src/shared/claudeClient.ts — Claude CLI wrapper that uses Max subscription
// Routes all LLM calls through the `claude` CLI instead of the Anthropic API,
// so they're billed against the Claude Max subscription.

import { spawn, execSync } from 'node:child_process';
import { platform } from 'node:os';

// Resolve the full path to claude CLI at module load to avoid PATH issues in subprocesses
let CLAUDE_CMD: string;
try {
  if (platform() === 'win32') {
    CLAUDE_CMD = execSync('where claude.cmd', { encoding: 'utf-8' }).trim().split('\n')[0].trim();
  } else {
    CLAUDE_CMD = execSync('which claude', { encoding: 'utf-8' }).trim();
  }
  console.log(`[claudeClient] Resolved CLI path: ${CLAUDE_CMD}`);
} catch {
  CLAUDE_CMD = platform() === 'win32' ? 'claude.cmd' : 'claude';
  console.warn(`[claudeClient] Could not resolve full CLI path, using: ${CLAUDE_CMD}`);
}

interface MessageCreateParams {
  model?: string;
  max_tokens?: number;
  system?: string;
  messages: Array<{ role: string; content: string }>;
  temperature?: number;
}

interface TextBlock {
  type: 'text';
  text: string;
}

interface MessageResponse {
  content: TextBlock[];
  model: string;
  role: string;
}

/**
 * Build a clean environment for the claude CLI subprocess.
 * Must strip all CLAUDE* env vars to avoid "nested session" errors,
 * but keep PATH and other essentials so node/claude can be found.
 */
function getCleanEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    // Strip Claude Code session vars that block nested execution
    if (key.startsWith('CLAUDECODE') || key.startsWith('CLAUDE_CODE')) continue;
    env[key] = value;
  }
  return env;
}

/**
 * Call the claude CLI with a prompt piped via stdin.
 * This avoids Windows command-line length limits (EINVAL errors).
 * Uses the Claude Max subscription instead of API credits.
 */
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

async function callClaudeOnce(
  prompt: string,
  model?: string,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let child;
    if (platform() === 'win32') {
      let cmd = `"${CLAUDE_CMD}" -p`;
      if (model) cmd += ` --model ${model}`;
      child = spawn(cmd, [], {
        env: getCleanEnv(),
        timeout: 120_000,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: true,
      });
    } else {
      const args = ['-p'];
      if (model) args.push('--model', model);
      child = spawn(CLAUDE_CMD, args, {
        env: getCleanEnv(),
        timeout: 120_000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    }

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
    child.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

    child.on('error', (err) => reject(new Error(`Failed to spawn claude CLI: ${err.message}`)));

    child.on('close', (code) => {
      if (!stdout.trim() && stderr.trim()) {
        reject(new Error(`Claude CLI error: ${stderr.trim()}`));
      } else if (code !== 0 && !stdout.trim()) {
        reject(new Error(`Claude CLI exited with code ${code}: ${stderr.trim()}`));
      } else {
        resolve(stdout.trim());
      }
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
}

async function callClaude(
  prompt: string,
  model?: string,
): Promise<string> {
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await callClaudeOnce(prompt, model);
    } catch (err: any) {
      lastError = err;
      console.warn(`[claudeClient] Attempt ${attempt}/${MAX_RETRIES} failed: ${err.message}`);
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS * attempt));
      }
    }
  }
  throw lastError;
}

/**
 * Drop-in replacement for `new Anthropic().messages.create()`.
 * Combines system prompt + user messages into a single CLI prompt.
 */
async function messagesCreate(params: MessageCreateParams): Promise<MessageResponse> {
  // Build the prompt from system + messages
  let fullPrompt = '';

  if (params.system) {
    fullPrompt += `<system>\n${params.system}\n</system>\n\n`;
  }

  for (const msg of params.messages) {
    if (msg.role === 'user') {
      fullPrompt += msg.content;
    } else if (msg.role === 'assistant') {
      fullPrompt += `\n\nAssistant: ${msg.content}\n\n`;
    }
  }

  const responseText = await callClaude(fullPrompt, params.model);

  return {
    content: [{ type: 'text', text: responseText }],
    model: params.model || 'claude-max',
    role: 'assistant',
  };
}

/**
 * A client object that mimics the Anthropic SDK interface.
 * Use this as a drop-in replacement for `new Anthropic()`.
 *
 * Usage:
 *   import { claudeClient } from '../shared/claudeClient';
 *   const response = await claudeClient.messages.create({ ... });
 */
export const claudeClient = {
  messages: {
    create: messagesCreate,
  },
};

/**
 * Factory function that returns a client — ignores apiKey/authToken
 * since we always use the CLI. Matches the `new Anthropic(opts)` pattern.
 */
export function createClaudeClient(_opts?: any) {
  return claudeClient;
}

// Type export for compatibility
export type ClaudeClient = typeof claudeClient;
