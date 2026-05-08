/**
 * `sentinel dashboard` — spawns the local Next.js dashboard.
 *
 * Defaults to binding `127.0.0.1:7777`. Non-loopback bind triggers a loud
 * warning before launch (CLAUDE.md no-network-by-default posture). The
 * dashboard is an out-of-process Next.js app at `apps/dashboard/`. CLI
 * invokes pnpm to run `next dev` inside that workspace.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';
import { rootLogger } from '../../common/logger.js';

export interface DashboardOptions {
  readonly port?: number;
  readonly bind?: string;
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

export async function dashboardCommand(options: DashboardOptions = {}): Promise<number> {
  const port =
    options.port ??
    (process.env.SENTINEL_DASHBOARD_PORT !== undefined
      ? Number(process.env.SENTINEL_DASHBOARD_PORT)
      : 7777);
  const bind = options.bind ?? process.env.SENTINEL_DASHBOARD_BIND ?? '127.0.0.1';

  if (!LOOPBACK.has(bind)) {
    rootLogger.warn(
      { bind, port },
      `dashboard binding to ${bind} (non-loopback). Anyone with network reachability to this host can read scan results, governor decisions, and per-tool AI reports. Set SENTINEL_DASHBOARD_BIND=127.0.0.1 to fix.`,
    );
  }

  const dashboardDir = resolvePath(process.cwd(), 'apps/dashboard');
  if (!existsSync(join(dashboardDir, 'package.json'))) {
    rootLogger.error(
      { dashboardDir },
      'apps/dashboard not found — run `pnpm install` from the sentinel root',
    );
    return 2;
  }

  rootLogger.info({ port, bind }, `starting dashboard on http://${bind}:${port}`);

  const isWindows = process.platform === 'win32';
  const cmd = isWindows ? 'pnpm.cmd' : 'pnpm';
  const args = [
    '--filter',
    '@sentinel/dashboard',
    'exec',
    'next',
    'dev',
    '--port',
    String(port),
    '--hostname',
    bind,
  ];

  return await new Promise<number>((resolveExit) => {
    const child = spawn(cmd, args, {
      cwd: process.cwd(),
      stdio: 'inherit',
      env: {
        ...process.env,
        SENTINEL_DASHBOARD_BIND: bind,
        SENTINEL_DASHBOARD_PORT: String(port),
      },
    });
    child.on('exit', (code) => {
      resolveExit(code ?? 0);
    });
    child.on('error', (err) => {
      rootLogger.error(
        { err: err.message },
        'failed to spawn dashboard process — is pnpm on PATH?',
      );
      resolveExit(1);
    });
  });
}
