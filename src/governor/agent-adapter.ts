/**
 * AgentAdapter — abstracts the governor CLI subprocess.
 *
 * Four concrete implementations — one per supported vendor CLI:
 *   - ClaudeCliAdapter    `claude -p <prompt>`        (Claude Code)
 *   - CursorCliAdapter    `cursor-agent -p <prompt>`  (Cursor CLI / agent mode)
 *   - CodexCliAdapter     `codex exec <prompt>`       (OpenAI Codex CLI)
 *   - GeminiCliAdapter    `gemini -p <prompt>`        (Google Gemini CLI)
 *
 * Selection order (highest priority first):
 *   1. explicit `preference` argument to createAgentAdapter()
 *   2. `SENTINEL_GOVERNOR_CLI` env var
 *   3. auto-detect: first of claude / cursor-agent / codex / gemini on PATH
 *
 * Critical invariants:
 *   - 8-hour hard timeout via AbortController (CLAUDE.md Invariant #7)
 *   - argv array only — NEVER a shell string (Invariant #5)
 *   - Failure → typed error → caller (governor services) falls back to mechanical
 *
 * This is the ONLY file in `src/governor/*` permitted to import
 * `node:child_process`. The governor never spawns scanners, only its own CLI.
 */

import { spawn, spawnSync } from 'node:child_process';
import { GovernorInvalidResponseError, GovernorTimeoutError } from '../common/errors.js';
import { createLogger } from '../common/logger.js';

const DEFAULT_TIMEOUT_MS = 8 * 60 * 60 * 1000; // 8 hours — governor calls on large repos need generous time
const IS_WINDOWS = process.platform === 'win32';

const logger = createLogger({ module: 'governor.agent-adapter' });

/**
 * Resolve a command name to a full executable path using `where` (Windows)
 * or `which` (Unix). Node's `child_process.spawn` does NOT auto-resolve .cmd /
 * .bat extensions on Windows — `spawn('claude', ...)` fails with ENOENT even
 * though `claude.cmd` exists on PATH. This helper fixes that.
 *
 * On Windows, prefers .cmd / .exe / .bat / .ps1 matches over extensionless
 * files (the extensionless files are usually bash wrappers Node can't exec).
 */
function resolveBin(name: string): string | null {
  const probeBin = IS_WINDOWS ? 'where' : 'which';
  try {
    const result = spawnSync(probeBin, [name], {
      timeout: 3_000,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, NO_COLOR: '1' },
    });
    if (result.status !== 0) return null;
    const stdout = result.stdout.toString('utf8');
    const lines = stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    if (lines.length === 0) return null;
    if (!IS_WINDOWS) return lines[0];
    const preferred = lines.find((l) => /\.(cmd|bat|exe|ps1)$/i.test(l));
    return preferred ?? lines[0];
  } catch {
    return null;
  }
}

export interface AgentQueryOptions {
  readonly timeoutMs?: number;
  readonly env?: Readonly<Record<string, string>>;
}

export type AgentName = 'claude' | 'cursor' | 'codex' | 'gemini';

export interface AgentAdapter {
  readonly name: AgentName;
  readonly bin: string;
  query(prompt: string, options?: AgentQueryOptions): Promise<string>;
}

interface SpawnConfig {
  readonly bin: string;
  readonly buildArgs: (prompt: string) => readonly string[];
}

/**
 * Run a CLI subprocess with an 8-hour timeout. Pure helper every adapter
 * delegates to so timeout / abort / error handling lives in one place.
 */
/**
 * Node's spawn on Windows refuses to execute .cmd / .bat files without
 * `{ shell: true }` since the CVE-2024-27980 fix (Node 18.20.2 / 20.12.2+).
 * Detect the wrapper extension and decide whether we need shell mode.
 */
function needsShell(resolved: string): boolean {
  if (!IS_WINDOWS) return false;
  return /\.(cmd|bat|ps1)$/i.test(resolved);
}

async function runCli(
  config: SpawnConfig,
  prompt: string,
  options: AgentQueryOptions,
): Promise<string> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  // Filter sensitive env vars from the governor subprocess. The governor
  // CLI connects to external AI services — env vars could leak via request
  // metadata or error logs on the AI provider side.
  const filteredEnv = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => {
      const upper = key.toUpperCase();
      if (upper.includes('API_KEY')) return false;
      if (upper.includes('SECRET')) return false;
      if (upper.includes('TOKEN') && upper !== 'CLAUDE_CODE_MAX_OUTPUT_TOKENS') return false;
      if (upper.startsWith('AWS_')) return false;
      if (upper.startsWith('GITHUB_')) return false;
      if (upper === 'GOOGLE_APPLICATION_CREDENTIALS') return false;
      if (upper === 'DATABASE_URL') return false;
      if (upper === 'REDIS_URL') return false;
      return true;
    }),
  );
  const env = { ...filteredEnv, NO_COLOR: '1', ...(options.env ?? {}) };

  // Resolve to a full path so Node can exec the binary on Windows. If
  // resolution fails, fall back to the bare name and let spawn surface ENOENT.
  let resolved = resolveBin(config.bin) ?? config.bin;
  const useShell = needsShell(resolved);

  // When shell:true, cmd.exe interprets backslashes in the executable path as
  // escape characters, mangling paths like C:\Users\... into C:Users...
  // Forward slashes work correctly on Windows in both shell and non-shell mode.
  if (useShell) {
    resolved = resolved.replace(/\\/g, '/');
  }

  // For stdin mode we pass no inline prompt — the prompt goes down stdin
  // which avoids the Windows 8191-char cmd.exe argv limit when running
  // .cmd wrappers with shell:true, and also avoids cmd.exe quote mangling.
  const argv = config.buildArgs('');

  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    const child = spawn(resolved, [...argv], {
      signal: controller.signal,
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
      // shell:true is required on Windows for .cmd/.bat wrappers per
      // Node.js CVE-2024-27980 hardening. Node escapes the argv array
      // safely before handing it to cmd.exe.
      shell: useShell,
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    // Stdin errors are emitted asynchronously — the child can die mid-write
    // (CLI rejects argv, API quota exhausted, bad flag) and Node will
    // otherwise surface an unhandled 'error' event on the stream and crash
    // the whole Node process. Swallow it here; the `close` / `error` handler
    // below will report the real underlying failure from the child.
    child.stdin.on('error', (err: NodeJS.ErrnoException) => {
      logger.debug(
        { bin: config.bin, code: err.code, err: err.message },
        'agent-adapter stdin write failed — child likely exited early',
      );
    });

    // Feed the prompt through stdin.
    try {
      child.stdin.write(prompt);
      child.stdin.end();
    } catch (err) {
      clearTimeout(timer);
      reject(
        new GovernorInvalidResponseError(
          `Governor CLI ${config.bin} stdin write failed: ${(err as Error).message}`,
        ),
      );
      return;
    }

    child.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      const aborted = controller.signal.aborted || err.name === 'AbortError';
      logger.warn({ bin: config.bin, err: err.message, aborted }, 'agent-adapter spawn error');
      if (aborted) {
        reject(
          new GovernorTimeoutError(
            `Governor CLI ${config.bin} exceeded ${timeoutMs}ms timeout`,
            { timeoutMs },
          ),
        );
      } else {
        reject(
          new GovernorInvalidResponseError(`Governor CLI ${config.bin} spawn failed: ${err.message}`),
        );
      }
    });

    child.on('close', (code: number | null) => {
      clearTimeout(timer);
      if (controller.signal.aborted) {
        reject(
          new GovernorTimeoutError(
            `Governor CLI ${config.bin} exceeded ${timeoutMs}ms timeout`,
            { timeoutMs },
          ),
        );
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

// Each adapter's `buildArgs` intentionally IGNORES the prompt argument — the
// prompt is always piped through stdin in runCli(), avoiding argv length
// limits and Windows cmd.exe quote mangling. The no-op `_unused` parameter
// keeps the SpawnConfig contract symmetric with any future adapter that
// wants to inline the prompt.

export class ClaudeCliAdapter implements AgentAdapter {
  public readonly name = 'claude' as const;
  public readonly bin = 'claude';
  public query(prompt: string, options: AgentQueryOptions = {}): Promise<string> {
    // `claude -p` in non-interactive mode reads the prompt from stdin when no
    // inline argument is given.
    return runCli(
      { bin: this.bin, buildArgs: (_unused) => ['-p'] },
      prompt,
      options,
    );
  }
}

export class CursorCliAdapter implements AgentAdapter {
  public readonly name = 'cursor' as const;
  public readonly bin = 'cursor-agent';
  public query(prompt: string, options: AgentQueryOptions = {}): Promise<string> {
    // cursor-agent supports `-p` / `--print` for non-interactive single-shot
    // queries; the prompt is read from stdin when the flag is used alone.
    return runCli(
      { bin: this.bin, buildArgs: (_unused) => ['-p'] },
      prompt,
      options,
    );
  }
}

export class CodexCliAdapter implements AgentAdapter {
  public readonly name = 'codex' as const;
  public readonly bin = 'codex';
  public query(prompt: string, options: AgentQueryOptions = {}): Promise<string> {
    // The OpenAI codex CLI `codex exec -` (or with no prompt argument) reads
    // the prompt from stdin in non-interactive mode.
    return runCli(
      { bin: this.bin, buildArgs: (_unused) => ['exec', '-'] },
      prompt,
      options,
    );
  }
}

export class GeminiCliAdapter implements AgentAdapter {
  public readonly name = 'gemini' as const;
  public readonly bin = 'gemini';
  public query(prompt: string, options: AgentQueryOptions = {}): Promise<string> {
    // Google's @google/gemini-cli rejects `-p` when it is passed without an
    // inline value ("Not enough arguments following: p"), even though the
    // other three CLIs accept that pattern for stdin input. Invoking
    // `gemini` with no flags and piping the prompt via stdin works: the
    // CLI detects a non-TTY stdin and runs non-interactively — we get a
    // single streamed response on stdout, then it exits.
    return runCli(
      { bin: this.bin, buildArgs: (_unused) => [] },
      prompt,
      options,
    );
  }
}

const ADAPTER_REGISTRY: Readonly<Record<AgentName, () => AgentAdapter>> = {
  claude: () => new ClaudeCliAdapter(),
  cursor: () => new CursorCliAdapter(),
  codex: () => new CodexCliAdapter(),
  gemini: () => new GeminiCliAdapter(),
};

/** Attempt selection order when no preference is set. */
const AUTO_DETECT_ORDER: readonly AgentName[] = ['claude', 'cursor', 'codex', 'gemini'];

function normalizeChoice(raw: string | undefined): AgentName | null {
  if (raw === undefined) return null;
  const value = raw.trim().toLowerCase();
  if (value === '') return null;
  if (value === 'claude' || value === 'claude-code') return 'claude';
  if (value === 'cursor' || value === 'cursor-agent' || value === 'cursor-cli') return 'cursor';
  if (value === 'codex' || value === 'openai-codex') return 'codex';
  if (value === 'gemini' || value === 'google-gemini') return 'gemini';
  return null;
}

/**
 * Best-effort detection: resolves the bin via `where` / `which`. Faster and
 * more cross-platform-safe than spawning `<bin> --version` directly (the
 * latter fails on Windows for .cmd wrappers).
 */
function isOnPath(bin: string): boolean {
  return resolveBin(bin) !== null;
}

/**
 * Detect which CLIs are available on the current host. Used by `./sentinel doctor`
 * and by the auto-detection fallback inside `createAgentAdapter`.
 */
export function detectAvailableAgents(): readonly AgentName[] {
  const available: AgentName[] = [];
  for (const name of AUTO_DETECT_ORDER) {
    const adapter = ADAPTER_REGISTRY[name]();
    if (isOnPath(adapter.bin)) available.push(name);
  }
  return available;
}

/**
 * Select an adapter using the priority chain:
 *   1. explicit preference argument
 *   2. SENTINEL_GOVERNOR_CLI env var
 *   3. first CLI on PATH in AUTO_DETECT_ORDER (claude → cursor → codex → gemini)
 *   4. claude (final fallback — query() will fail loudly if the binary is missing)
 */
export function createAgentAdapter(preference?: string): AgentAdapter {
  const explicit = normalizeChoice(preference);
  if (explicit !== null) return ADAPTER_REGISTRY[explicit]();

  const envChoice = normalizeChoice(process.env.SENTINEL_GOVERNOR_CLI);
  if (envChoice !== null) return ADAPTER_REGISTRY[envChoice]();

  for (const name of AUTO_DETECT_ORDER) {
    const adapter = ADAPTER_REGISTRY[name]();
    if (isOnPath(adapter.bin)) {
      logger.info({ adapter: name, bin: adapter.bin }, 'auto-detected governor CLI');
      // Persist the detection so downstream code (e.g. Shannon's env
      // whitelist in shannon.scanner.ts) can read which CLI was chosen.
      process.env.SENTINEL_GOVERNOR_CLI = name;
      return adapter;
    }
  }

  // Nothing found on PATH — return claude and let the runtime fail on first query.
  logger.warn({}, 'no governor CLI found on PATH — defaulting to claude');
  return new ClaudeCliAdapter();
}
