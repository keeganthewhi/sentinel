/**
 * DockerExecutor — the single choke point for spawning scanner subprocesses.
 *
 * Invariants (enforced by `buildArgs`):
 *   - argv array only, never a shell string
 *   - --rm so the container self-deletes on exit
 *   - workspace mounted read-only at /workspace
 *   - timeout enforced via AbortController — timedOut=true on abort
 *
 * `exitCode: null` means the process was killed by signal (abort or OS) —
 * callers MUST treat this as a failure regardless of timedOut.
 */

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { createLogger } from '../common/logger.js';
import type { Logger } from 'pino';

export interface DockerRunOptions {
  readonly image: string;
  readonly command: readonly string[];
  /**
   * Host path for a 9P bind mount. Exactly ONE of `workspaceRepo` or
   * `workspaceVolume` should be set — when both are provided, `workspaceVolume`
   * wins so callers can upgrade from bind-mount to volume transparently.
   */
  readonly workspaceRepo?: string;
  /**
   * Docker named volume. When set, emits `-v <name>:/workspace:ro` instead of a
   * host bind mount. Used by the pipeline to avoid Docker Desktop 9P overhead
   * on Windows (see `workspace-volume.ts`).
   */
  readonly workspaceVolume?: string;
  readonly timeoutMs: number;
  readonly env?: Readonly<Record<string, string>>;
  /** Optional scanner name for log correlation. */
  readonly scanner?: string;
  /**
   * Optional explicit container name. When set, `docker run --name <name>` is
   * emitted so the executor can `docker kill <name>` on abort. `DockerExecutor.run`
   * generates one automatically if the caller leaves this undefined.
   */
  readonly containerName?: string;
  /**
   * Per-container memory cap (e.g. `'4g'`, `'512m'`). Passed through as
   * `docker run --memory=<value>`. Defaults to `'4g'` when omitted so a
   * single runaway scanner can't OOM-kill the host. Set to the empty
   * string to explicitly disable the cap.
   */
  readonly memoryLimit?: string;
  /**
   * Per-container CPU cap in virtual CPUs (e.g. `'2'`, `'1.5'`). Passed
   * through as `docker run --cpus=<value>`. Defaults to `'2'`. Set to
   * the empty string to disable.
   */
  readonly cpuLimit?: string;
}

/** Defaults applied when caller doesn't specify. Tuned for a laptop with
 *  16 GB RAM and 8 cores running 5 concurrent Phase 1 scanners: 5 × 4 GB
 *  is oversubscribed (by design — scanners rarely hit the cap), but it
 *  keeps a single bad actor from grabbing everything. */
const DEFAULT_MEMORY_LIMIT = '4g';
const DEFAULT_CPU_LIMIT = '2';

export interface DockerRunResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  readonly timedOut: boolean;
}

/**
 * Build the `docker run` argv array from the options. Kept as a pure function
 * so it can be unit-tested without spawning a real subprocess.
 */
export function buildDockerArgs(options: DockerRunOptions): string[] {
  const args: string[] = ['run', '--rm'];

  if (options.containerName !== undefined) {
    args.push('--name', options.containerName);
  }

  // Container hardening — defense in depth.
  //   --security-opt=no-new-privileges — prevents privilege escalation via
  //     setuid/setgid binaries inside the container.
  //   --cap-drop=ALL — (applied from the caller if needed) drops all Linux
  //     capabilities by default.
  //   --memory / --cpus — per-container resource caps (defaults below).
  //
  // NOTE: --read-only is NOT used for scanner containers. Scanners require
  // writable filesystem for their own cache/config:
  //   - Trivy: ~/.cache/trivy/db/ (vulnerability DB downloaded on first run)
  //   - Semgrep: ~/.semgrep/ (rule cache, metrics)
  //   - Nuclei: ~/.config/nuclei/ (template metadata)
  // The workspace volume is already mounted :ro, which is the important
  // protection (scanners can't modify the target repo). The other
  // hardening flags (no-new-privileges, cap-drop, resource limits) bound
  // the blast radius if a scanner is compromised.
  args.push('--security-opt=no-new-privileges');

  const memory = options.memoryLimit ?? DEFAULT_MEMORY_LIMIT;
  if (memory !== '') {
    args.push(`--memory=${memory}`);
  }
  const cpus = options.cpuLimit ?? DEFAULT_CPU_LIMIT;
  if (cpus !== '') {
    args.push(`--cpus=${cpus}`);
  }

  // Prefer volume over host path when both are set — the volume is faster on
  // Docker Desktop for Windows and equivalent everywhere else.
  if (options.workspaceVolume !== undefined) {
    args.push('-v', `${options.workspaceVolume}:/workspace:ro`);
  } else if (options.workspaceRepo !== undefined) {
    args.push('-v', `${options.workspaceRepo}:/workspace:ro`);
  }

  if (options.env !== undefined) {
    for (const [key, value] of Object.entries(options.env)) {
      args.push('-e', `${key}=${value}`);
    }
  }

  args.push(options.image);
  args.push(...options.command);

  return args;
}

@Injectable()
export class DockerExecutor {
  private readonly logger: Logger = createLogger({ module: 'docker-executor' });

  public async run(options: DockerRunOptions): Promise<DockerRunResult> {
    // Always pass --name so we can docker-kill the container on abort.
    // Aborting the node subprocess only kills the `docker` CLI process —
    // the dockerd-managed container keeps running until we explicitly kill it.
    const containerName =
      options.containerName ??
      `sentinel-${options.scanner ?? 'run'}-${randomBytes(4).toString('hex')}`;
    const args = buildDockerArgs({ ...options, containerName });
    const startedAt = Date.now();

    return new Promise((resolve) => {
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
        // Fire-and-forget: kill the daemon-side container so it doesn't keep
        // eating CPU/disk after we've stopped reading its output.
        const killer = spawn('docker', ['kill', containerName], {
          stdio: 'ignore',
          detached: false,
        });
        killer.on('error', () => {
          // container already gone, or docker CLI unavailable — ignore
        });
      }, options.timeoutMs);

      const child = spawn('docker', args, {
        signal: controller.signal,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      // Hard cap on buffered output to prevent OOM from a runaway scanner.
      // 50 MB is generous for any structured output (trivy JSON, semgrep JSON,
      // nuclei JSONL, nmap XML) while still preventing a malicious scanner
      // from crashing the Node process with multi-GB output.
      const MAX_BUFFER_BYTES = 50 * 1024 * 1024;
      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];
      let stdoutSize = 0;
      let stderrSize = 0;
      let bufferOverflow = false;

      child.stdout.on('data', (chunk: Buffer) => {
        stdoutSize += chunk.length;
        if (stdoutSize > MAX_BUFFER_BYTES) {
          if (!bufferOverflow) {
            bufferOverflow = true;
            this.logger.warn(
              { scanner: options.scanner, container: containerName, bytes: stdoutSize },
              'scanner stdout exceeded 50 MB buffer limit — killing container',
            );
            child.kill('SIGTERM');
          }
          return;
        }
        stdoutChunks.push(chunk);
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderrSize += chunk.length;
        if (stderrSize > MAX_BUFFER_BYTES) return; // silently drop excess stderr
        stderrChunks.push(chunk);
      });

      const finalize = (exitCode: number | null, timedOut: boolean): void => {
        clearTimeout(timer);
        const durationMs = Date.now() - startedAt;
        const stdout = Buffer.concat(stdoutChunks).toString('utf8');
        const stderr = Buffer.concat(stderrChunks).toString('utf8');
        this.logger.debug(
          {
            scanner: options.scanner,
            container: containerName,
            exitCode,
            durationMs,
            timedOut,
            stdoutBytes: stdout.length,
            stderrBytes: stderr.length,
          },
          'docker run completed',
        );
        resolve({ exitCode, stdout, stderr, durationMs, timedOut });
      };

      child.on('error', (err: NodeJS.ErrnoException) => {
        // Spawn error (docker not on PATH, abort, etc.) — still finalize as failure.
        const timedOut = err.name === 'AbortError' || controller.signal.aborted;
        this.logger.warn(
          { scanner: options.scanner, err: err.message, timedOut },
          'docker spawn error',
        );
        finalize(null, timedOut);
      });

      child.on('close', (code: number | null) => {
        const timedOut = controller.signal.aborted;
        finalize(code, timedOut);
      });
    });
  }
}
