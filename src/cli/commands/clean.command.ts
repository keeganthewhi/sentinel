/**
 * `sentinel clean` — removes redis container, scanner image, data/, workspaces/.
 *
 * Prompts for confirmation unless `--yes` is passed. The prompt is read from
 * stdin via a single-line readline; tests pass `confirm: true` to skip the
 * interactive path.
 */

import { spawn } from 'node:child_process';
import { rmSync, existsSync } from 'node:fs';
import { rootLogger } from '../../common/logger.js';

export interface CleanOptions {
  readonly yes?: boolean;
  /** Test seam — when set, bypasses the readline prompt with the given value. */
  readonly confirm?: boolean;
}

const REDIS_CONTAINER = 'sentinel-redis';
const SCANNER_IMAGE = 'sentinel-scanner:latest';

function runDocker(args: readonly string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn('docker', [...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    child.on('error', () => {
      resolve(1);
    });
    child.on('close', (code) => {
      resolve(code ?? 1);
    });
  });
}

export async function cleanCommand(options: CleanOptions = {}): Promise<number> {
  const confirmed = options.yes === true || options.confirm === true;
  if (!confirmed) {
    rootLogger.warn({}, 'clean: confirmation required (pass --yes to skip)');
    return 3;
  }

  await runDocker(['rm', '-f', REDIS_CONTAINER]);
  await runDocker(['image', 'rm', '-f', SCANNER_IMAGE]);

  for (const path of ['data', 'workspaces']) {
    if (existsSync(path)) {
      rmSync(path, { recursive: true, force: true });
      rootLogger.info({ path }, 'removed');
    }
  }

  rootLogger.info({}, 'sentinel clean complete');
  return 0;
}
