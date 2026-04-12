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

/**
 * An entry from shannon's `## N. Exploitation Queue` structured JSON. Shannon
 * emits one of these arrays per per-phase analysis deliverable (auth / authz /
 * injection / ssrf / xss / …). Every field is optional because shannon's
 * schema has drifted between releases — we read defensively.
 */
interface ShannonQueueEntry {
  readonly ID?: string;
  readonly vulnerability_type?: string;
  readonly externally_exploitable?: boolean;
  readonly source_endpoint?: string;
  readonly vulnerable_code_location?: string;
  readonly missing_defense?: string;
  readonly exploitation_hypothesis?: string;
  readonly suggested_exploit_technique?: string;
  readonly confidence?: string;
  readonly severity?: string;
  readonly notes?: string;
}

/**
 * Every shannon finding is a DAST result by definition — shannon only runs
 * in Phase 3 (exploitation) and reports on behaviors it verified against a
 * live target. The specific vulnerability family (injection / auth / ssrf /
 * xss / …) is preserved in the finding title via shannon's ID prefix
 * (`AUTH-VULN-03`, `INJ-VULN-01`, …), so we don't lose information by
 * collapsing the `category` field to 'dast'.
 */
const SHANNON_CATEGORY = 'dast';

/**
 * Shannon doesn't emit an explicit severity on every queue entry — its
 * `confidence` field is about detection certainty, not impact. We derive a
 * reasonable severity from whichever fields are present:
 *   1. explicit `severity` (if shannon ever adds one)
 *   2. explicit `confidence` mapped: High→HIGH, Medium→MEDIUM, Low→LOW
 *   3. `externally_exploitable: true` → HIGH, else MEDIUM
 *   4. fallback HIGH (shannon findings are DAST-confirmed by design)
 */
function severityFromEntry(entry: ShannonQueueEntry): Severity {
  if (entry.severity !== undefined) {
    return normalizeSeverity(entry.severity);
  }
  if (entry.confidence !== undefined) {
    const c = entry.confidence.trim().toLowerCase();
    if (c === 'high' || c === 'confirmed') return 'HIGH';
    if (c === 'medium') return 'MEDIUM';
    if (c === 'low') return 'LOW';
  }
  if (entry.externally_exploitable === true) return 'HIGH';
  if (entry.externally_exploitable === false) return 'MEDIUM';
  return 'HIGH';
}

/**
 * Pull every JSON block tagged as an Exploitation Queue out of a shannon
 * markdown document. Shannon's section headers look like:
 *   ## 4. Exploitation Queue
 *   ## 5. Exploitation Queue
 *   ## 7. Exploitation Queue (JSON)
 * and the JSON is the FIRST fenced ```json block after the header. A
 * deliverable that found nothing emits `[]` there; we skip empty arrays.
 *
 * Returns a flat list of queue entries across all deliverables merged into
 * the input string. The caller dedupes by fingerprint.
 */
export function extractExploitationQueueEntries(raw: string): ShannonQueueEntry[] {
  const entries: ShannonQueueEntry[] = [];
  // Matches: `## <anything> Exploitation Queue <anything>\n<anything>\n\`\`\`json\n<captured JSON>\n\`\`\``
  // The /g + explicit indexing lets us scan multiple queue sections.
  const QUEUE_RE = /##[^\n]*Exploitation Queue[^\n]*\n([\s\S]*?)```json\s*\n([\s\S]*?)```/g;
  let match = QUEUE_RE.exec(raw);
  while (match !== null) {
    // Regex has two capture groups; the second always exists when match
    // succeeds. ESLint's narrower doesn't understand regex groups, so we
    // assert via indexing.
    const jsonBlock: string = match[2];
    try {
      const parsed: unknown = JSON.parse(jsonBlock);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (item !== null && typeof item === 'object') {
            entries.push(item as ShannonQueueEntry);
          }
        }
      }
    } catch {
      // Shannon occasionally emits prose inside its json fence on failed
      // runs — ignore and continue to the next queue section.
    }
    match = QUEUE_RE.exec(raw);
  }
  return entries;
}

function buildFindingFromQueueEntry(entry: ShannonQueueEntry): NormalizedFinding | null {
  const id = entry.ID?.trim();
  if (id === undefined || id === '') return null;

  const vulnType = entry.vulnerability_type?.replace(/_/g, ' ').trim() ?? 'Shannon finding';
  const endpoint = entry.source_endpoint?.trim();
  const title = `${id}: ${vulnType}`;

  // Build a description that captures the most important shannon fields
  // without dumping everything. Trimmed to ~2 KB so it fits in a SQLite row
  // and the markdown renderer without bloat.
  const parts: string[] = [];
  if (entry.missing_defense !== undefined) {
    parts.push(`**Missing defense:** ${entry.missing_defense}`);
  }
  if (entry.exploitation_hypothesis !== undefined) {
    parts.push(`**Exploitation path:** ${entry.exploitation_hypothesis}`);
  }
  if (entry.vulnerable_code_location !== undefined) {
    parts.push(`**Location:** ${entry.vulnerable_code_location}`);
  }
  if (entry.suggested_exploit_technique !== undefined) {
    parts.push(`**Technique:** ${entry.suggested_exploit_technique}`);
  }
  if (entry.confidence !== undefined) {
    parts.push(`**Confidence:** ${entry.confidence}`);
  }
  if (entry.notes !== undefined) {
    parts.push(`**Notes:** ${entry.notes}`);
  }
  const description = parts.join('\n\n').slice(0, 2000) || `Shannon finding ${id}`;

  const exploitProofParts: string[] = [];
  if (entry.exploitation_hypothesis !== undefined) exploitProofParts.push(entry.exploitation_hypothesis);
  if (entry.notes !== undefined) exploitProofParts.push(entry.notes);
  const exploitProof =
    exploitProofParts.length > 0 ? exploitProofParts.join('\n\n').slice(0, 2000) : 'see Shannon report';

  return {
    scanner: 'shannon',
    fingerprint: shortHash(`shannon:${id}:${endpoint ?? ''}`),
    title,
    description,
    severity: severityFromEntry(entry),
    category: SHANNON_CATEGORY,
    normalizedScore: 0,
    endpoint,
    exploitProof,
  };
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
    // Also tail workflow.log to surface shannon's per-phase progress
    // ("pre-recon", "recon", "vulnerability-exploitation", "reporting") so
    // the user sees progress instead of a blank terminal for 60+ minutes.
    const workflowLogPath = join(workspaceDir, 'workflow.log');
    const pollOutcome = await this.pollForCompletion(
      deliverablesDir,
      sessionJsonPath,
      workflowLogPath,
      context.scanId,
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
    workflowLogPath: string,
    scanId: string,
    budgetMs: number,
  ): Promise<{
    status: 'completed' | 'failed' | 'timeout';
    reportMarkdown?: string;
    sessionStatus?: string;
  }> {
    const pollIntervalMs = 5_000;
    const deadline = Date.now() + Math.max(budgetMs, 0);
    const seenPhaseEvents = new Set<string>();

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

      // 2. Scan workflow.log for phase transitions we haven't logged yet.
      //    Shannon writes `[PHASE] Starting: <name>` / `[PHASE] Completed:
      //    <name>` markers, plus `[save_deliverable]` events when files land.
      //    Tailing the log and re-logging deltas gives sentinel users
      //    real-time shannon progress visibility.
      this.emitShannonProgressEvents(workflowLogPath, seenPhaseEvents, scanId);

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
   * Scan the shannon workflow.log for phase / deliverable events we haven't
   * logged yet. Emits one sentinel log line per newly-seen event. `seen`
   * is a Set of event keys that caller carries across poll iterations so
   * we don't re-log the same line.
   *
   * Extracts three event kinds:
   *   - `[PHASE] Starting: <name>`
   *   - `[PHASE] Completed: <name>`
   *   - `[save_deliverable] ... <filename>.md` (when shannon drops a file)
   */
  private emitShannonProgressEvents(
    workflowLogPath: string,
    seen: Set<string>,
    scanId: string,
  ): void {
    if (!existsSync(workflowLogPath)) return;
    let raw: string;
    try {
      raw = readFileSync(workflowLogPath, 'utf8');
    } catch {
      return;
    }

    // Only inspect recent-ish log tail to keep re-parsing cheap. shannon's
    // workflow.log can grow to several MB over an hour-long run.
    const tail = raw.length > 256_000 ? raw.slice(raw.length - 256_000) : raw;
    const lines = tail.split('\n');

    const PHASE_RE = /\[PHASE\]\s+(Starting|Completed):\s+(.+?)\s*$/;
    const DELIVERABLE_RE = /save[_-]deliverable.*?([a-zA-Z0-9_-]+\.md)/;

    for (const line of lines) {
      const phaseMatch = PHASE_RE.exec(line);
      if (phaseMatch !== null) {
        const [, verb, name] = phaseMatch;
        const key = `phase:${verb}:${name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        logger.info(
          { scanId, phase: name, verb },
          `shannon ${verb.toLowerCase()} phase ${name}`,
        );
        continue;
      }
      const deliverableMatch = DELIVERABLE_RE.exec(line);
      if (deliverableMatch !== null) {
        const filename = deliverableMatch[1];
        const key = `deliverable:${filename}`;
        if (seen.has(key)) continue;
        seen.add(key);
        logger.info({ scanId, deliverable: filename }, `shannon wrote ${filename}`);
      }
    }
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
    const seen = new Set<string>();

    // 1. Preferred path: shannon's per-phase deliverables contain
    //    structured JSON queues under `## N. Exploitation Queue` sections.
    //    Each queue entry is a typed vulnerability with stable field names
    //    (ID, vulnerability_type, source_endpoint, missing_defense, …).
    for (const entry of extractExploitationQueueEntries(raw)) {
      const finding = buildFindingFromQueueEntry(entry);
      if (finding === null || seen.has(finding.fingerprint)) continue;
      seen.add(finding.fingerprint);
      findings.push(finding);
    }

    // 2. Legacy / sample-report path: old shannon format where each vuln
    //    is a `## Finding N: <title>` section with bullet fields. Kept for
    //    backward compatibility and for the unit-test fixtures that ship
    //    with this scanner.
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
      const fingerprint = shortHash(`shannon:${title}:${target ?? ''}`);
      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);

      findings.push({
        scanner: this.name,
        fingerprint,
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
          // SECURITY: whitelist env vars — do NOT spread process.env into
          // the shannon subprocess. The host may have AWS keys, GitHub tokens,
          // or other secrets that should not leak to Shannon's docker workers.
          env: {
            PATH: process.env.PATH ?? '',
            HOME: process.env.HOME ?? '',
            TERM: process.env.TERM ?? 'dumb',
            NO_COLOR: '1',
            // Shannon needs its own agent CLI config
            SHANNON_AGENT_CLI: process.env.SHANNON_AGENT_CLI ?? process.env.SENTINEL_GOVERNOR_CLI ?? '',
            // Docker Desktop on Windows needs these
            ...(process.platform === 'win32' && {
              APPDATA: process.env.APPDATA ?? '',
              LOCALAPPDATA: process.env.LOCALAPPDATA ?? '',
              USERPROFILE: process.env.USERPROFILE ?? '',
              MSYS_NO_PATHCONV: '1',
            }),
          },
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
