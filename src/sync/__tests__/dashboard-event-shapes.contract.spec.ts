/**
 * Drift-lock — dashboard SSE event shape ↔ sentinel publisher event shape.
 *
 * The sentinel core publishes events to a Redis pub/sub channel; the
 * Next.js dashboard subscribes via Server-Sent Events and Zod-parses each
 * frame. This spec asserts:
 *
 *   1. The set of `kind` discriminators in `apps/dashboard/lib/events.ts`
 *      matches the set in `src/sync/redis-event-publisher.ts`.
 *   2. The `REDIS_EVENT_CHANNEL` constant string matches across both files.
 *   3. No file under `src/sync/` reaches into `apps/` (one-way boundary).
 *
 * Drift here means a publisher emits a kind the dashboard cannot decode, or
 * the dashboard decodes a kind the publisher never emits — silent dropped
 * frames in production. The drift-lock is the only file that reads the
 * dashboard source via `fs.readFileSync`; the dashboard package is not in
 * the root TS project scope.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  DASHBOARD_EVENT_KINDS,
  REDIS_EVENT_CHANNEL as PUBLISHER_CHANNEL,
} from '../redis-event-publisher.js';

const ROOT = resolve(__dirname, '../../..');
const DASHBOARD_EVENTS_PATH = join(ROOT, 'apps/dashboard/lib/events.ts');
const PUBLISHER_PATH = join(ROOT, 'src/sync/redis-event-publisher.ts');
const SYNC_DIR = join(ROOT, 'src/sync');

function readDashboardKinds(): string[] {
  const src = readFileSync(DASHBOARD_EVENTS_PATH, 'utf8');
  // Match `kind: z.literal('...')` patterns inside the discriminated union.
  const matches = [...src.matchAll(/kind:\s*z\.literal\(\s*['"]([^'"]+)['"]\s*\)/g)];
  return matches.map((m) => m[1] ?? '').filter((s) => s.length > 0);
}

function readPublisherKinds(): string[] {
  const src = readFileSync(PUBLISHER_PATH, 'utf8');
  // Match `kind: '...'` literal field declarations inside the DashboardEvent
  // type union.
  const matches = [...src.matchAll(/kind:\s*['"]([^'"]+)['"]/g)];
  return matches.map((m) => m[1] ?? '').filter((s) => s.length > 0);
}

function readDashboardChannel(): string | null {
  const src = readFileSync(DASHBOARD_EVENTS_PATH, 'utf8');
  const m = /REDIS_EVENT_CHANNEL\s*=\s*['"]([^'"]+)['"]/.exec(src);
  return m === null ? null : (m[1] ?? null);
}

function listSyncFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) listSyncFiles(full, out);
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('drift-lock — dashboard event shapes', () => {
  it('publisher exports DASHBOARD_EVENT_KINDS that match the type union literals', () => {
    const literalsInSource = readPublisherKinds();
    const dedupedFromSource = [...new Set(literalsInSource)].sort();
    const exported = [...DASHBOARD_EVENT_KINDS].sort();
    expect(dedupedFromSource).toEqual(exported);
  });

  it('dashboard event union covers exactly the publisher emit set', () => {
    const dashboardKinds = [...new Set(readDashboardKinds())].sort();
    const publisherKinds = [...DASHBOARD_EVENT_KINDS].sort();
    expect(dashboardKinds).toEqual(publisherKinds);
  });

  it('REDIS_EVENT_CHANNEL constant matches between sentinel + dashboard', () => {
    const dashboard = readDashboardChannel();
    expect(dashboard).not.toBeNull();
    expect(dashboard).toBe(PUBLISHER_CHANNEL);
    // Defensive: also pin the canonical value so a rename in both files is caught.
    expect(PUBLISHER_CHANNEL).toBe('sentinel:events');
  });

  it('no file in src/sync/ imports from apps/ (one-way boundary)', () => {
    const files = listSyncFiles(SYNC_DIR);
    const offenders: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      if (/from\s+['"][^'"]*apps\//.test(src) || /import\(['"][^'"]*apps\//.test(src)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
