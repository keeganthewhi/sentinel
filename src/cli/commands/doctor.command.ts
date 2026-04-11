/**
 * `sentinel doctor` — verifies host toolchain readiness.
 *
 * Hard deps (exit non-zero on miss): node, docker, pnpm.
 * Soft deps (warn, exit 0 on miss): redis, scanner image, governor CLIs.
 */

import { spawn } from 'node:child_process';
import { rootLogger } from '../../common/logger.js';

interface ProbeResult {
  readonly tool: string;
  readonly version?: string;
  readonly available: boolean;
  readonly error?: string;
}

const PROBE_TIMEOUT_MS = 5_000;

function probe(bin: string, args: readonly string[]): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, PROBE_TIMEOUT_MS);
    const child = spawn(bin, [...args], { signal: controller.signal, stdio: ['ignore', 'pipe', 'pipe'] });
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

export async function doctorCommand(_options: DoctorOptions = {}): Promise<number> {
  const probes = await Promise.all([
    probe('node', ['--version']),
    probe('docker', ['--version']),
    probe('pnpm', ['--version']),
    probe('redis-cli', ['ping']),
    probe('claude', ['--version']),
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

  if (missing.length > 0) {
    rootLogger.error({ missing: missing.map((p) => p.tool) }, 'doctor: hard dependency missing');
    return 2;
  }
  return 0;
}
