/**
 * Per-scan Docker workspace volume helpers.
 *
 * Problem: Docker Desktop on Windows uses a 9P filesystem bridge to expose
 * host NTFS paths to containers. Per-file reads through 9P are extremely
 * slow for many-small-file workloads — semgrep against a ~50 MB NestJS
 * monorepo reads ~80 MB in 30+ minutes and never completes within the
 * executor budget.
 *
 * Fix: copy the repo ONCE into a per-scan Docker volume. Scanners then mount
 * the volume read-only and hit native ext4 instead of 9P.
 *
 * How the one-shot copy avoids 9P entirely:
 *   1. `docker volume create <vol>` — creates an empty named volume on the
 *      backend VM's ext4 filesystem.
 *   2. `docker create --name <staging> -v <vol>:/dst <image> true` — creates
 *      (but does not start) a helper container with the volume mounted.
 *   3. Spawn host `tar cf - --exclude=... -C <repo> .` — the tar binary
 *      reads the repo files via native NTFS syscalls (NOT through 9P).
 *   4. Pipe the tar stream into `docker cp - <staging>:/dst/`. docker cp
 *      reads stdin as a tar archive and extracts into the volume's
 *      backend-VM ext4 filesystem.
 *   5. `docker rm <staging>` — detach the helper, volume persists.
 *
 * Lifecycle (owned by PipelineService.run):
 *   1. `prepareWorkspaceVolume(scanId, repoAbs, image)` before Phase 1
 *   2. pass the returned volume name into the ScanContext
 *   3. `removeWorkspaceVolume(name)` in a `finally` block after Phase 4
 *
 * Security:
 *   - The staging container is created in `Created` state and destroyed
 *     immediately after copy. Nothing runs inside it.
 *   - Scanner containers mount the volume read-only; they cannot mutate it.
 *   - Volume name contains the scanId so concurrent scans do not collide.
 */

import { spawn } from 'node:child_process';
import { createLogger } from '../common/logger.js';

const logger = createLogger({ module: 'workspace-volume' });

/** Overall timeout for the populate step. 10 minutes is plenty for a ~1 GB repo. */
const POPULATE_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Paths we strip before copying so we don't waste time hauling `node_modules`
 * or generated artefacts into the volume. These match (but are independent
 * of) the per-scanner exclude lists — stripping here is purely an I/O win.
 */
const TAR_EXCLUDES: readonly string[] = [
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'coverage',
  '.cache',
  '.turbo',
  '.nuxt',
  'vendor',
];

interface ProcResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
}

function runDocker(args: readonly string[], timeoutMs: number): Promise<ProcResult> {
  return new Promise((resolve) => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    const child = spawn('docker', [...args], {
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
 * Pipe host `tar` into `docker cp`. Returns when BOTH children exit — the
 * success criterion is `tar` exit 0 AND `docker cp` exit 0.
 */
function tarToDockerCp(
  repoAbs: string,
  stagingContainer: string,
  timeoutMs: number,
): Promise<{ ok: boolean; detail: string }> {
  return new Promise((resolve) => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    const tarArgs: string[] = ['-c', '-C', repoAbs];
    for (const ex of TAR_EXCLUDES) {
      tarArgs.push(`--exclude=${ex}`);
    }
    tarArgs.push('.');

    const tarChild = spawn('tar', tarArgs, {
      signal: controller.signal,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const cpChild = spawn(
      'docker',
      ['cp', '-', `${stagingContainer}:/dst`],
      {
        signal: controller.signal,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );

    tarChild.stdout.pipe(cpChild.stdin);

    // Capture stderr from both for diagnostic output on failure.
    const tarErrChunks: Buffer[] = [];
    const cpErrChunks: Buffer[] = [];
    tarChild.stderr.on('data', (chunk: Buffer) => {
      tarErrChunks.push(chunk);
    });
    cpChild.stderr.on('data', (chunk: Buffer) => {
      cpErrChunks.push(chunk);
    });

    // Coalesce: resolve when BOTH have closed OR either errors out hard.
    let tarExit: number | null | undefined;
    let cpExit: number | null | undefined;

    const maybeFinish = (): void => {
      if (tarExit === undefined || cpExit === undefined) return;
      clearTimeout(timer);
      const ok = tarExit === 0 && cpExit === 0;
      const tarErr = Buffer.concat(tarErrChunks).toString('utf8').trim();
      const cpErr = Buffer.concat(cpErrChunks).toString('utf8').trim();
      const detail = ok
        ? ''
        : `tar exit=${tarExit ?? 'null'} docker-cp exit=${cpExit ?? 'null'} ` +
          `tar-stderr=${tarErr.slice(0, 300)} cp-stderr=${cpErr.slice(0, 300)}`;
      resolve({ ok, detail });
    };

    tarChild.on('error', () => {
      tarExit ??= null;
      try {
        cpChild.stdin.end();
      } catch {
        // pipe already closed
      }
      maybeFinish();
    });
    cpChild.on('error', () => {
      cpExit ??= null;
      maybeFinish();
    });
    tarChild.on('close', (code: number | null) => {
      tarExit = code;
      // tarChild.stdout.pipe already calls cpChild.stdin.end() on stdout close
      maybeFinish();
    });
    cpChild.on('close', (code: number | null) => {
      cpExit = code;
      maybeFinish();
    });
  });
}

/**
 * Create a per-scan Docker volume and copy the repository contents into it.
 * Returns the volume name on success, throws on failure.
 */
export async function prepareWorkspaceVolume(
  scanId: string,
  repoAbs: string,
  scannerImage: string,
): Promise<string> {
  // Use the full scanId (already a UUID, guaranteed unique) to prevent
  // volume name collisions between fast successive scans. The previous
  // scanId.slice(0,8)+Date.now() approach could collide within the same ms.
  const volumeName = `sentinel-ws-${scanId}`;
  const stagingName = `${volumeName}-staging`;

  // 1. Create an empty named volume.
  logger.info({ scanId, volume: volumeName }, 'creating workspace volume');
  const create = await runDocker(['volume', 'create', volumeName], 30_000);
  if (create.exitCode !== 0) {
    throw new Error(
      `failed to create workspace volume ${volumeName}: exit ${create.exitCode ?? 'null'} ${create.stderr.trim()}`,
    );
  }

  // 2. Create a stopped staging container with the volume mounted at /dst.
  //    We use the scanner image because it's already on disk; `true` is a
  //    cheap no-op entrypoint override that keeps the container in Created.
  logger.info({ scanId, container: stagingName }, 'creating staging container');
  const createCont = await runDocker(
    [
      'create',
      '--name',
      stagingName,
      '-v',
      `${volumeName}:/dst`,
      '--entrypoint',
      'sh',
      scannerImage,
      '-c',
      'true',
    ],
    30_000,
  );
  if (createCont.exitCode !== 0) {
    await runDocker(['volume', 'rm', '-f', volumeName], 10_000).catch(() => undefined);
    throw new Error(
      `failed to create staging container: exit ${createCont.exitCode ?? 'null'} ${createCont.stderr.trim()}`,
    );
  }

  // 3. Stream host-tar → docker-cp, which avoids 9P entirely.
  logger.info(
    { scanId, volume: volumeName, repoAbs },
    'streaming repo into volume via host tar → docker cp',
  );
  const copy = await tarToDockerCp(repoAbs, stagingName, POPULATE_TIMEOUT_MS);
  if (!copy.ok) {
    await runDocker(['rm', '-f', stagingName], 10_000).catch(() => undefined);
    await runDocker(['volume', 'rm', '-f', volumeName], 10_000).catch(() => undefined);
    throw new Error(`failed to populate workspace volume: ${copy.detail}`);
  }

  // 4. Remove the staging container — volume persists.
  await runDocker(['rm', '-f', stagingName], 30_000).catch(() => undefined);
  logger.info({ scanId, volume: volumeName }, 'workspace volume populated');
  return volumeName;
}

/**
 * Delete the per-scan volume. Swallows all errors — this runs in a
 * `finally` block and must never mask a pipeline error.
 */
export async function removeWorkspaceVolume(volumeName: string): Promise<void> {
  try {
    const result = await runDocker(['volume', 'rm', '-f', volumeName], 30_000);
    if (result.exitCode !== 0) {
      logger.warn(
        { volume: volumeName, stderr: result.stderr.trim().slice(0, 500) },
        'workspace volume removal returned non-zero — leaving volume in place',
      );
    } else {
      logger.debug({ volume: volumeName }, 'workspace volume removed');
    }
  } catch (err) {
    logger.warn(
      { volume: volumeName, err: (err as Error).message },
      'workspace volume removal threw — leaving volume in place',
    );
  }
}
