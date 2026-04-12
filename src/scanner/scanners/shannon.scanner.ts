/**
 * Shannon scanner — AI-powered DAST exploitation (Phase 3).
 *
 * Spawns the `tools/shannon-noapi/shannon start` CLI as a subprocess.
 * Shannon orchestrates its OWN docker worker + Temporal infra, runs a
 * multi-phase pentest pipeline against the target URL, and drops a
 * markdown report into `tools/shannon-noapi/workspaces/<workspace>/
 * deliverables/report.md`. We read that file after the subprocess exits
 * and parse the `## Finding N: <title>` sections into NormalizedFindings.
 *
 * Key integration points:
 *   - Shannon auto-detects the host's authenticated agent CLI
 *     (claude / codex / gemini) and uses it directly — no API keys.
 *     This matches Sentinel's governor design: both tools share the
 *     same subscription-backed CLI.
 *   - Shannon is spawned from the shannon-noapi directory so its local
 *     `./workspaces/` and `.env` write alongside it, not in Sentinel root.
 *   - The subprocess timeout respects `context.scannerTimeoutMs`. On
 *     timeout we send SIGTERM (via AbortController) AND invoke
 *     `shannon stop` to clean up any worker containers shannon spawned
 *     through its own docker orchestration — aborting the shannon CLI
 *     alone leaves daemon-managed containers running.
 *   - Phase 3 only runs at all when the governor escalated at least one
 *     finding (enforced by phase-three-exploit.ts). An empty escalation
 *     list means the scanner returns success with zero findings.
 *
 * Critical invariant: this is a SCANNER, not governor code. It is
 * allowed to spawn subprocesses (CLAUDE.md Invariant #4 forbids
 * src/governor/* from spawning, not src/scanner/*).
 */

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  BaseScanner,
  type ScanContext,
  type ScannerResult,
} from '../types/scanner.interface.js';
import type { NormalizedFinding, Severity } from '../types/finding.interface.js';
import { shortHash } from './fingerprint.helper.js';
import { createLogger } from '../../common/logger.js';

const SECTION_RE = /^##\s+Finding\s+\d+\s*:\s*(.+)$/m;
const SEVERITY_RE = /^[-*]\s*severity\s*:\s*([A-Za-z]+)/im;
const TARGET_RE = /^[-*]\s*target\s*:\s*(.+)$/im;
const PROOF_BLOCK_RE = /(?:exploit\s*proof|poc)\s*:\s*\|?\s*\n([\s\S]*?)(?=\n##\s|$)/i;

const IS_WINDOWS = process.platform === 'win32';

/**
 * Resolve the shannon CLI location relative to the current process.
 * Read lazily so tests can override `process.env.SHANNON_DIR` at runtime
 * without re-importing the module.
 */
function getShannonDir(): string {
  return process.env.SHANNON_DIR ?? 'tools/shannon-noapi';
}

const logger = createLogger({ module: 'scanner.shannon' });

function normalizeSeverity(raw: string | undefined): Severity {
  if (raw === undefined) return 'HIGH';
  const upper = raw.trim().toUpperCase();
  if (upper === 'CRITICAL' || upper === 'HIGH' || upper === 'MEDIUM' || upper === 'LOW' || upper === 'INFO') {
    return upper;
  }
  return 'HIGH';
}

function extractSections(raw: string): string[] {
  const sections: string[] = [];
  const lines = raw.split('\n');
  let current: string[] | null = null;
  for (const line of lines) {
    if (/^##\s+Finding\s+\d+\s*:/.test(line)) {
      if (current !== null) sections.push(current.join('\n'));
      current = [line];
    } else if (current !== null) {
      current.push(line);
    }
  }
  if (current !== null) sections.push(current.join('\n'));
  return sections;
}

interface SubprocessResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

export class ShannonScanner extends BaseScanner {
  public readonly name = 'shannon';
  public readonly phase = 3 as const;
  public readonly requiresUrl = true;

  public async execute(context: ScanContext): Promise<ScannerResult> {
    // Shannon runs whenever Phase 3 is selected. Per Sentinel's governed-mode
    // contract, the scan must not require a live target URL: if the user did
    // not provide `--url`, we pass `code-only` to shannon, which triggers
    // shannon's code-only pipeline (source-only SAST + dependency analysis
    // without any live web probing). That's the whole point of governed mode:
    // it should work on any repo whether or not staging is reachable.
    const shannonUrl =
      context.targetUrl !== undefined && context.targetUrl.trim() !== ''
        ? context.targetUrl
        : 'code-only';

    const shannonDirAbs = resolvePath(getShannonDir());
    const shannonCli = join(shannonDirAbs, 'shannon');
    if (!existsSync(shannonCli)) {
      return {
        scanner: this.name,
        findings: [],
        rawOutput: '',
        executionTimeMs: 0,
        success: false,
        error: `shannon CLI not found at ${shannonCli} — run "pnpm install && pnpm build" inside tools/shannon-noapi`,
      };
    }

    const workspace = `sentinel-${context.scanId.slice(0, 8)}`;
    const workspaceDir = join(shannonDirAbs, 'workspaces', workspace);
    mkdirSync(workspaceDir, { recursive: true });

    const deliverablesDir = join(workspaceDir, 'deliverables');
    const sessionJsonPath = join(workspaceDir, 'session.json');
    const startedAt = Date.now();

    logger.info(
      {
        scanId: context.scanId,
        workspace,
        targetUrl: shannonUrl,
        timeoutMs: context.scannerTimeoutMs,
      },
      'spawning shannon start',
    );

    // Shannon's `shannon start` CLI typically returns within ~15 s after the
    // docker worker registers its workflow in session.json — it does NOT
    // block on the worker's actual execution. We spawn the CLI with a short
    // handshake timeout, then poll for either a completed deliverables
    // report or a terminal session.json status, up to the scan-level budget.
    const cliHandshakeTimeoutMs = Math.min(120_000, context.scannerTimeoutMs);
    const cliResult = await this.spawnShannon(
      shannonDirAbs,
      shannonUrl,
      context.targetRepo,
      workspace,
      cliHandshakeTimeoutMs,
    );

    if (cliResult.exitCode !== 0 && !cliResult.timedOut) {
      // Hard spawn failure — shannon's CLI refused to start. No worker
      // container will come up, no point polling.
      const stderrSnippet = cliResult.stderr.trim().slice(0, 500);
      const stdoutSnippet = cliResult.stdout.trim().slice(0, 500);
      return {
        scanner: this.name,
        findings: [],
        rawOutput: cliResult.stdout,
        executionTimeMs: Date.now() - startedAt,
        success: false,
        error: `shannon CLI failed to start: exit ${cliResult.exitCode ?? 'null'}: ${stderrSnippet || stdoutSnippet || '<no output>'}`,
      };
    }

    // Poll until one of:
    //   1. a new deliverables/*.md file exists (shannon produced its report)
    //   2. session.json status becomes "completed" / "failed" / "cancelled"
    //   3. scanner budget exhausted
    const pollOutcome = await this.pollForCompletion(
      deliverablesDir,
      sessionJsonPath,
      context.scannerTimeoutMs - (Date.now() - startedAt),
    );

    const executionTimeMs = Date.now() - startedAt;
    const rawOutput = pollOutcome.reportMarkdown ?? '';

    if (pollOutcome.status === 'timeout') {
      await this.cleanupShannonContainers(shannonDirAbs);
      return {
        scanner: this.name,
        findings: rawOutput === '' ? [] : this.parseOutput(rawOutput),
        rawOutput,
        executionTimeMs,
        success: false,
        error: `shannon did not finish within ${context.scannerTimeoutMs}ms — workspace left at ${workspaceDir}`,
        timedOut: true,
      };
    }

    if (pollOutcome.status === 'failed') {
      return {
        scanner: this.name,
        findings: rawOutput === '' ? [] : this.parseOutput(rawOutput),
        rawOutput,
        executionTimeMs,
        success: false,
        error: `shannon workflow ended with status "${pollOutcome.sessionStatus ?? 'unknown'}"`,
      };
    }

    if (rawOutput === '') {
      return {
        scanner: this.name,
        findings: [],
        rawOutput: '',
        executionTimeMs,
        success: true,
        error: 'shannon finished but produced no deliverables markdown',
      };
    }

    const findings = this.parseOutput(rawOutput);
    logger.info(
      { scanId: context.scanId, findings: findings.length, executionTimeMs },
      'shannon run complete',
    );
    return {
      scanner: this.name,
      findings,
      rawOutput,
      executionTimeMs,
      success: true,
    };
  }

  /**
   * Poll shannon's workspace for completion. Shannon's worker writes its
   * deliverables into `workspace/deliverables/*.md` and updates
   * `workspace/session.json` with its workflow status. We check both every
   * few seconds until one of them signals completion (or timeout).
   *
   * Returns the latest deliverables markdown (merged across files) and a
   * status tag: `completed` | `failed` | `timeout`.
   */
  private async pollForCompletion(
    deliverablesDir: string,
    sessionJsonPath: string,
    budgetMs: number,
  ): Promise<{
    status: 'completed' | 'failed' | 'timeout';
    reportMarkdown?: string;
    sessionStatus?: string;
  }> {
    const pollIntervalMs = 5_000;
    const deadline = Date.now() + Math.max(budgetMs, 0);

    while (Date.now() < deadline) {
      // 1. Session status (fastest, just one file read).
      let sessionStatus: string | undefined;
      try {
        if (existsSync(sessionJsonPath)) {
          const raw = readFileSync(sessionJsonPath, 'utf8');
          const parsed = JSON.parse(raw) as { session?: { status?: string } };
          sessionStatus = parsed.session?.status;
        }
      } catch {
        // best-effort — shannon may be mid-write
      }

      if (sessionStatus === 'completed') {
        const markdown = this.readDeliverablesMarkdown(deliverablesDir);
        return { status: 'completed', reportMarkdown: markdown, sessionStatus };
      }
      if (sessionStatus === 'failed' || sessionStatus === 'cancelled') {
        const markdown = this.readDeliverablesMarkdown(deliverablesDir);
        return { status: 'failed', reportMarkdown: markdown, sessionStatus };
      }

      await sleep(pollIntervalMs);
    }

    // Budget exhausted — return whatever partial deliverables exist.
    const markdown = this.readDeliverablesMarkdown(deliverablesDir);
    return { status: 'timeout', reportMarkdown: markdown };
  }

  /**
   * Read every markdown file in shannon's deliverables directory and
   * concatenate them with a separator. Shannon may emit multiple files
   * (report.md, summary.md, individual finding files) — we want them all.
   * Returns empty string if no markdown exists.
   */
  private readDeliverablesMarkdown(deliverablesDir: string): string {
    if (!existsSync(deliverablesDir)) return '';
    try {
      const entries = readdirSync(deliverablesDir);
      const parts: string[] = [];
      for (const entry of entries) {
        if (!entry.endsWith('.md')) continue;
        const full = join(deliverablesDir, entry);
        try {
          const stat = statSync(full);
          if (!stat.isFile()) continue;
          parts.push(`<!-- ${entry} -->\n${readFileSync(full, 'utf8')}`);
        } catch {
          // skip unreadable files
        }
      }
      return parts.join('\n\n');
    } catch {
      return '';
    }
  }

  public parseOutput(raw: string): readonly NormalizedFinding[] {
    if (raw.trim() === '') return [];
    const findings: NormalizedFinding[] = [];

    for (const section of extractSections(raw)) {
      const titleMatch = SECTION_RE.exec(section);
      if (titleMatch === null) continue;
      const title = titleMatch[1].trim();

      const severityMatch = SEVERITY_RE.exec(section);
      const targetMatch = TARGET_RE.exec(section);
      const proofMatch = PROOF_BLOCK_RE.exec(section);

      const severity = normalizeSeverity(severityMatch?.[1]);
      const target = targetMatch?.[1]?.trim();
      const proofRaw = proofMatch?.[1]?.trim() ?? '';
      const exploitProof = proofRaw === '' ? 'see Shannon report' : proofRaw;

      findings.push({
        scanner: this.name,
        fingerprint: shortHash(`shannon:${title}:${target ?? ''}`),
        title,
        description: `Shannon DAST: ${title}`,
        severity,
        category: 'dast',
        normalizedScore: 0,
        endpoint: target,
        exploitProof,
      });
    }

    return findings;
  }

  public isAvailable(): Promise<boolean> {
    return Promise.resolve(existsSync(join(resolvePath(getShannonDir()), 'shannon')));
  }

  /**
   * Spawn `node shannon start --url <url> --repo <repo> -w <workspace>`
   * with the shannon-noapi directory as cwd. Shannon is a Node script
   * (tools/shannon-noapi/shannon is `#!/usr/bin/env node` + dynamic
   * import), so we invoke it via `node` explicitly — the shebang path
   * resolution is unreliable on Windows.
   */
  private spawnShannon(
    shannonDirAbs: string,
    targetUrl: string,
    targetRepo: string,
    workspace: string,
    timeoutMs: number,
  ): Promise<SubprocessResult> {
    return new Promise((resolve) => {
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
      }, timeoutMs);

      const child = spawn(
        'node',
        [
          'shannon',
          'start',
          '--url',
          targetUrl,
          '--repo',
          targetRepo,
          '-w',
          workspace,
        ],
        {
          cwd: shannonDirAbs,
          signal: controller.signal,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, NO_COLOR: '1' },
          // Shannon is a plain node script — no shell needed on any platform.
          shell: false,
        },
      );

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      child.stdout.on('data', (chunk: Buffer) => {
        stdoutChunks.push(chunk);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderrChunks.push(chunk);
      });

      const finalize = (exitCode: number | null): void => {
        clearTimeout(timer);
        resolve({
          exitCode,
          stdout: Buffer.concat(stdoutChunks).toString('utf8'),
          stderr: Buffer.concat(stderrChunks).toString('utf8'),
          timedOut: controller.signal.aborted,
        });
      };

      child.on('error', () => {
        finalize(null);
      });
      child.on('close', (code: number | null) => {
        finalize(code);
      });
    });
  }

  /**
   * Fire-and-forget `shannon stop` to clean up worker containers that
   * shannon's own docker orchestration left behind after a timeout or
   * abort. Swallows every error — this is a best-effort cleanup hook.
   */
  private cleanupShannonContainers(shannonDirAbs: string): Promise<void> {
    return new Promise((resolve) => {
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
      }, 30_000);

      const child = spawn('node', ['shannon', 'stop', '--clean'], {
        cwd: shannonDirAbs,
        signal: controller.signal,
        stdio: 'ignore',
        env: { ...process.env, NO_COLOR: '1' },
        shell: false,
      });

      const done = (): void => {
        clearTimeout(timer);
        resolve();
      };
      child.on('error', done);
      child.on('close', done);
    });
  }
}

// Silence "unused" for the Windows-specific const so the module remains
// parseable on Linux/Mac without a lint exception.
void IS_WINDOWS;
