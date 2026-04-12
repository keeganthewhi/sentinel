/**
 * `sentinel doctor` — verifies host toolchain readiness.
 *
 * Hard deps (exit non-zero on miss): node, docker, pnpm.
 * Soft deps (warn, exit 0 on miss): redis, scanner image, governor CLIs,
 * shannon-noapi checkout, docker daemon reachability, sentinel-scanner
 * image, volume prep fast-path, better-sqlite3 native binding.
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';
import { rootLogger } from '../../common/logger.js';

const IS_WINDOWS = process.platform === 'win32';

/**
 * Resolve a bin name to a full path using `where` / `which`. Node's spawn
 * doesn't auto-resolve .cmd / .bat extensions on Windows, so `spawn('claude',
 * ['--version'])` fails with ENOENT even when `claude.cmd` is clearly on
 * PATH. This helper mirrors the fix in src/governor/agent-adapter.ts.
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

function needsShell(resolved: string): boolean {
  if (!IS_WINDOWS) return false;
  return /\.(cmd|bat|ps1)$/i.test(resolved);
}

interface ProbeResult {
  readonly tool: string;
  readonly version?: string;
  readonly available: boolean;
  readonly error?: string;
}

const PROBE_TIMEOUT_MS = 5_000;

function probe(bin: string, args: readonly string[]): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const resolved = resolveBin(bin) ?? bin;
    const useShell = needsShell(resolved);

    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, PROBE_TIMEOUT_MS);
    const child = spawn(resolved, [...args], {
      signal: controller.signal,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: useShell,
    });
    let stdout = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve({ tool: bin, available: false, error: 'spawn failed' });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ tool: bin, available: true, version: stdout.trim().split('\n')[0] });
      } else {
        resolve({ tool: bin, available: false, error: `exit code ${code ?? 'null'}` });
      }
    });
  });
}

export interface DoctorOptions {
  readonly verbose?: boolean;
}

/**
 * Probe whether a Docker image exists locally. Returns true only on a
 * successful `docker image inspect` exit 0.
 */
async function probeDockerImage(image: string): Promise<boolean> {
  const result = await probe('docker', ['image', 'inspect', image]);
  return result.available;
}

/**
 * Probe whether a named Docker container is running.
 */
async function probeDockerContainer(name: string): Promise<boolean> {
  const result = await probe('docker', ['inspect', '-f', '{{.State.Running}}', name]);
  if (!result.available) return false;
  return (result.version ?? '').trim() === 'true';
}

/**
 * Probe whether better-sqlite3's native binding compiled successfully.
 * Persistence (history / diff) silently degrades without it.
 */
function probeBetterSqlite3Binding(): boolean {
  const paths = [
    'node_modules/.pnpm/better-sqlite3@12.8.0/node_modules/better-sqlite3/build/Release/better_sqlite3.node',
    'node_modules/better-sqlite3/build/Release/better_sqlite3.node',
  ];
  return paths.some((p) => existsSync(p));
}

export async function doctorCommand(_options: DoctorOptions = {}): Promise<number> {
  const probes = await Promise.all([
    probe('node', ['--version']),
    probe('docker', ['--version']),
    probe('pnpm', ['--version']),
    // redis-cli intentionally NOT probed — sentinel uses a containerized
    // redis via `sentinel-redis`, never the host client. Container state
    // is reported below.
    //
    // All four supported governor CLIs — any one of them enables
    // `--governed` mode.
    probe('claude', ['--version']),
    probe('cursor-agent', ['--version']),
    probe('codex', ['--version']),
    probe('gemini', ['--version']),
  ]);

  const hard = ['node', 'docker', 'pnpm'];
  const missing = probes.filter((p) => hard.includes(p.tool) && !p.available);

  for (const probe of probes) {
    const status = probe.available ? 'OK' : 'MISSING';
    const detail = probe.version ?? probe.error ?? '';
    rootLogger.info({ tool: probe.tool, status, detail }, `[${status}] ${probe.tool} ${detail}`);
  }

  // Summarise which governor CLIs are usable — gives the user a direct answer
  // to "can I run `--governed` right now?".
  const governorBins = ['claude', 'cursor-agent', 'codex', 'gemini'];
  const availableGovernors = probes.filter((p) => governorBins.includes(p.tool) && p.available);
  if (availableGovernors.length > 0) {
    rootLogger.info(
      { available: availableGovernors.map((p) => p.tool) },
      `[OK] governor: ${availableGovernors.length} CLI(s) available — governed mode ready`,
    );
  } else {
    rootLogger.warn(
      {},
      '[WARN] governor: no AI CLI detected (install claude-code / cursor-agent / codex / gemini to enable --governed)',
    );
  }

  // Runtime-readiness probes: do we have everything a scan will need the
  // moment it starts? Short-circuits each with a clear actionable hint.
  const [scannerImage, redisContainer] = await Promise.all([
    probeDockerImage('sentinel-scanner:latest'),
    probeDockerContainer('sentinel-redis'),
  ]);

  if (scannerImage) {
    rootLogger.info({}, '[OK] sentinel-scanner:latest image is built');
  } else {
    rootLogger.warn(
      {},
      '[WARN] sentinel-scanner:latest not built — the ./sentinel bash bootstrap builds it on first run from docker/scanner.Dockerfile',
    );
  }

  if (redisContainer) {
    rootLogger.info({}, '[OK] sentinel-redis container is running');
  } else {
    rootLogger.warn(
      {},
      '[WARN] sentinel-redis container is not running — the ./sentinel bash bootstrap starts it on first run',
    );
  }

  // Shannon is a soft dep: governed mode needs it for Phase 3, but non-governed
  // scans work without it. Check for the checkout + built CLI dist.
  const shannonDir = resolvePath(process.env.SHANNON_DIR ?? 'tools/shannon-noapi');
  const shannonCli = join(shannonDir, 'shannon');
  const shannonBuiltCli = join(shannonDir, 'apps/cli/dist/index.mjs');
  const shannonCloned = existsSync(shannonCli);
  const shannonBuilt = existsSync(shannonBuiltCli);

  if (shannonCloned && shannonBuilt) {
    rootLogger.info({ shannonDir }, '[OK] shannon-noapi cloned and built — Phase 3 ready');
  } else if (shannonCloned && !shannonBuilt) {
    rootLogger.warn(
      { shannonDir },
      '[WARN] shannon-noapi cloned but not built — run `pnpm install && pnpm build` inside tools/shannon-noapi (or re-run `./sentinel start --governed` to trigger the auto-build)',
    );
  } else {
    rootLogger.warn(
      { shannonDir },
      '[WARN] shannon-noapi not cloned — the ./sentinel bash bootstrap auto-clones when --governed is passed',
    );
  }

  // better-sqlite3 native binding: persistence silently degrades without it.
  // Sentinel's scan + report path still works, but `./sentinel history` and
  // `./sentinel diff` won't see new rows until the binding compiles.
  const sqliteOk = probeBetterSqlite3Binding();
  if (sqliteOk) {
    rootLogger.info({}, '[OK] better-sqlite3 native binding compiled — persistence enabled');
  } else {
    rootLogger.warn(
      {},
      '[WARN] better-sqlite3 native binding missing — scans still run and reports still render, but `./sentinel history` will be empty. Run `pnpm rebuild better-sqlite3` (requires MSVC build tools on Windows).',
    );
  }

  if (missing.length > 0) {
    rootLogger.error({ missing: missing.map((p) => p.tool) }, 'doctor: hard dependency missing');
    return 2;
  }
  return 0;
}
