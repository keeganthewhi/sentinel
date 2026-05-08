/**
 * Redis pub/sub publisher that mirrors in-process ProgressEmitter events to
 * a `sentinel:events` channel so the local Next.js dashboard
 * (apps/dashboard) can stream them to operators in real time.
 *
 * Design constraints (CLAUDE.md):
 *   - Mechanical-first (Critical Invariant #2): pipeline correctness MUST NOT
 *     depend on Redis. Every Redis error here is caught and logged; the scan
 *     keeps running.
 *   - Governor read-only (Critical Invariant #4): this file lives outside
 *     `src/governor/*`. It does not import `node:child_process`. It only
 *     subscribes to events emitted by the pipeline.
 *   - Zero hardcoding (Critical Invariant #11): the Redis URL flows from
 *     `SENTINEL_DASHBOARD_REDIS_URL` (preferred) or `REDIS_URL` (fallback),
 *     surfaced through the SyncModule injection token.
 *
 * The dashboard's SSE endpoint subscribes to the same channel and Zod-parses
 * each frame before relaying. Drift-lock spec
 * `src/sync/__tests__/dashboard-event-shapes.contract.spec.ts` asserts the
 * publisher's `kind` set matches the dashboard's discriminated union.
 */

import { Inject, Injectable, Optional } from '@nestjs/common';
import { Redis } from 'ioredis';
import { createLogger } from '../common/logger.js';
import {
  ProgressEmitter,
  type ProgressEvent,
} from '../report/progress/progress.emitter.js';

export const REDIS_EVENT_CHANNEL = 'sentinel:events';
export const REDIS_DASHBOARD_URL_TOKEN = 'REDIS_DASHBOARD_URL';

export type DashboardEvent =
  | { kind: 'scan-started'; scanId: string; targetRepo: string; governed: boolean; at: number }
  | { kind: 'phase-started'; scanId: string; phase: 1 | 2 | 3; at: number }
  | { kind: 'phase-ended'; scanId: string; phase: 1 | 2 | 3; at: number }
  | { kind: 'scanner-started'; scanId: string; phase: 1 | 2 | 3; scanner: string; at: number }
  | {
      kind: 'scanner-ended';
      scanId: string;
      scanner: string;
      success: boolean;
      durationMs: number;
      at: number;
    }
  | {
      kind: 'governor-decision';
      scanId: string;
      decisionType: string;
      fallback: boolean;
      rationale?: string;
      at: number;
    }
  | { kind: 'scan-ended'; scanId: string; durationMs: number; findingCount: number; at: number };

export const DASHBOARD_EVENT_KINDS: readonly DashboardEvent['kind'][] = [
  'scan-started',
  'phase-started',
  'phase-ended',
  'scanner-started',
  'scanner-ended',
  'governor-decision',
  'scan-ended',
];

@Injectable()
export class RedisEventPublisher {
  private readonly logger = createLogger({ module: 'sync.redis-event-publisher' });
  private redis: Redis | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly emitter: ProgressEmitter,
    @Optional() @Inject(REDIS_DASHBOARD_URL_TOKEN) private readonly url?: string,
  ) {}

  /**
   * Connect to Redis (lazy) and start mirroring ProgressEmitter events.
   * Called by the CLI after the NestJS context is built. No-op when no Redis
   * URL is configured; mechanical-first.
   */
  public start(): void {
    if (this.url === undefined || this.url.length === 0) {
      this.logger.debug('no redis url configured; dashboard live stream disabled');
      return;
    }
    try {
      this.redis = new Redis(this.url, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        enableOfflineQueue: false,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn({ err: message }, 'redis publisher init failed; dashboard live stream disabled');
      this.redis = null;
      return;
    }
    this.redis.on('error', (err: Error) => {
      this.logger.debug({ err: err.message }, 'redis publisher socket error (ignored)');
    });
    this.unsubscribe = this.emitter.on((evt) => {
      this.relay(evt);
    });
  }

  public async stop(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.redis !== null) {
      try {
        await this.redis.quit();
      } catch {
        this.redis.disconnect();
      }
      this.redis = null;
    }
  }

  /** Direct publish — exposed so the start command can emit scan lifecycle frames. */
  public publish(event: DashboardEvent): void {
    if (this.redis === null) return;
    let payload: string;
    try {
      payload = JSON.stringify(event);
    } catch {
      return;
    }
    this.redis.publish(REDIS_EVENT_CHANNEL, payload).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.debug({ err: message }, 'redis publish failed; dropping frame');
    });
  }

  private relay(evt: ProgressEvent): void {
    const at = Date.now();
    const scanId = evt.scanId ?? '';
    if (evt.type === 'phase.start' && evt.phase !== undefined) {
      this.publish({ kind: 'phase-started', scanId, phase: evt.phase, at });
      return;
    }
    if (evt.type === 'phase.end' && evt.phase !== undefined) {
      this.publish({ kind: 'phase-ended', scanId, phase: evt.phase, at });
      return;
    }
    if (
      evt.type === 'scanner.start' &&
      evt.scanner !== undefined &&
      evt.phase !== undefined
    ) {
      this.publish({ kind: 'scanner-started', scanId, phase: evt.phase, scanner: evt.scanner, at });
      return;
    }
    if (evt.type === 'scanner.end' && evt.scanner !== undefined) {
      this.publish({
        kind: 'scanner-ended',
        scanId,
        scanner: evt.scanner,
        success: evt.success ?? false,
        durationMs: evt.durationMs ?? 0,
        at,
      });
      return;
    }
    if (evt.type === 'governor.decision') {
      const next: DashboardEvent = {
        kind: 'governor-decision',
        scanId,
        decisionType: evt.message ?? 'unknown',
        fallback: evt.success === false,
        at,
        ...(evt.message !== undefined && { rationale: evt.message }),
      };
      this.publish(next);
    }
  }
}
