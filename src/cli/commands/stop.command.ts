/**
 * `sentinel stop` — stops the sentinel-redis container.
 */

import { spawn } from 'node:child_process';
import { rootLogger } from '../../common/logger.js';

const REDIS_CONTAINER = 'sentinel-redis';

export function stopCommand(): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn('docker', ['stop', REDIS_CONTAINER], { stdio: ['ignore', 'pipe', 'pipe'] });
    child.on('error', (err) => {
      rootLogger.warn({ err: err.message }, 'docker stop failed');
      resolve(1);
    });
    child.on('close', (code) => {
      if (code === 0) {
        rootLogger.info({}, 'sentinel-redis stopped');
        resolve(0);
      } else {
        rootLogger.warn({ code }, 'docker stop returned non-zero');
        resolve(1);
      }
    });
  });
}
