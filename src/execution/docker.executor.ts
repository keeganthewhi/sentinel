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
import { Injectable } from '@nestjs/common';
import { createLogger } from '../common/logger.js';
import type { Logger } from 'pino';

export interface DockerRunOptions {
  readonly image: string;
  readonly command: readonly string[];
  readonly workspaceRepo?: string;
  readonly timeoutMs: number;
  readonly env?: Readonly<Record<string, string>>;
  /** Optional scanner name for log correlation. */
  readonly scanner?: string;
}

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

  if (options.workspaceRepo !== undefined) {
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
    const args = buildDockerArgs(options);
    const startedAt = Date.now();

    return new Promise((resolve) => {
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
      }, options.timeoutMs);

      const child = spawn('docker', args, {
        signal: controller.signal,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      const stdoutChunks: Buffer[] = [];
      const stderrChunks: Buffer[] = [];

      child.stdout.on('data', (chunk: Buffer) => {
        stdoutChunks.push(chunk);
      });
      child.stderr.on('data', (chunk: Buffer) => {
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
