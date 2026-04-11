/**
 * AgentAdapter — abstracts the governor CLI subprocess.
 *
 * Three concrete implementations (Claude / Codex / Gemini) all spawn the
 * vendor CLI in print mode and capture stdout. The selection is made at
 * runtime via `SENTINEL_GOVERNOR_CLI` (claude / codex / gemini), defaulting
 * to whichever binary is on PATH.
 *
 * Critical invariants:
 *   - 5-minute hard timeout via AbortController (Invariant #7)
 *   - argv array only — NEVER a shell string (Invariant #5)
 *   - Failure → typed error → caller falls back to mechanical path
 *
 * NOTE: This is the ONLY file in `src/governor/*` permitted to import
 * `node:child_process`. The governor never spawns scanners; only its own CLI.
 */

import { spawn } from 'node:child_process';
import { GovernorInvalidResponseError, GovernorTimeoutError } from '../common/errors.js';
import { createLogger } from '../common/logger.js';

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

const logger = createLogger({ module: 'governor.agent-adapter' });

export interface AgentQueryOptions {
  readonly timeoutMs?: number;
  readonly env?: Readonly<Record<string, string>>;
}

export interface AgentAdapter {
  readonly name: 'claude' | 'codex' | 'gemini';
  query(prompt: string, options?: AgentQueryOptions): Promise<string>;
}

interface SpawnConfig {
  readonly bin: string;
  readonly buildArgs: (prompt: string) => readonly string[];
}

/**
 * Run a CLI subprocess with a 5-minute timeout. Pure helper that all three
 * adapters delegate to so the timeout / abort / error handling lives in one place.
 */
async function runCli(
  config: SpawnConfig,
  prompt: string,
  options: AgentQueryOptions,
): Promise<string> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const args = config.buildArgs(prompt);
  const env = { ...process.env, NO_COLOR: '1', ...(options.env ?? {}) };

  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    const child = spawn(config.bin, [...args], {
      signal: controller.signal,
      stdio: ['ignore', 'pipe', 'pipe'],
      env,
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    child.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      const aborted = controller.signal.aborted || err.name === 'AbortError';
      logger.warn({ bin: config.bin, err: err.message, aborted }, 'agent-adapter spawn error');
      if (aborted) {
        reject(new GovernorTimeoutError(`Governor CLI ${config.bin} exceeded ${timeoutMs}ms timeout`, { timeoutMs }));
      } else {
        reject(new GovernorInvalidResponseError(`Governor CLI ${config.bin} spawn failed: ${err.message}`));
      }
    });

    child.on('close', (code: number | null) => {
      clearTimeout(timer);
      if (controller.signal.aborted) {
        reject(new GovernorTimeoutError(`Governor CLI ${config.bin} exceeded ${timeoutMs}ms timeout`, { timeoutMs }));
        return;
      }
      if (code !== 0) {
        const stderr = Buffer.concat(stderrChunks).toString('utf8').trim();
        reject(
          new GovernorInvalidResponseError(
            `Governor CLI ${config.bin} exited with code ${code}: ${stderr.slice(0, 500)}`,
            { exitCode: code ?? undefined },
          ),
        );
        return;
      }
      const stdout = Buffer.concat(stdoutChunks).toString('utf8').trim();
      if (stdout === '') {
        reject(new GovernorInvalidResponseError(`Governor CLI ${config.bin} returned empty output`));
        return;
      }
      resolve(stdout);
    });
  });
}

export class ClaudeCliAdapter implements AgentAdapter {
  public readonly name = 'claude';
  public query(prompt: string, options: AgentQueryOptions = {}): Promise<string> {
    return runCli(
      { bin: 'claude', buildArgs: (p) => ['--print', p] },
      prompt,
      options,
    );
  }
}

export class CodexCliAdapter implements AgentAdapter {
  public readonly name = 'codex';
  public query(prompt: string, options: AgentQueryOptions = {}): Promise<string> {
    return runCli(
      { bin: 'codex', buildArgs: (p) => ['--print', p] },
      prompt,
      options,
    );
  }
}

export class GeminiCliAdapter implements AgentAdapter {
  public readonly name = 'gemini';
  public query(prompt: string, options: AgentQueryOptions = {}): Promise<string> {
    return runCli(
      { bin: 'gemini', buildArgs: (p) => ['--prompt', p] },
      prompt,
      options,
    );
  }
}

/** Select an adapter from `SENTINEL_GOVERNOR_CLI`, falling back to claude → codex → gemini. */
export function createAgentAdapter(preference?: string): AgentAdapter {
  const choice = (preference ?? process.env.SENTINEL_GOVERNOR_CLI ?? 'claude').toLowerCase();
  if (choice === 'codex') return new CodexCliAdapter();
  if (choice === 'gemini') return new GeminiCliAdapter();
  return new ClaudeCliAdapter();
}
