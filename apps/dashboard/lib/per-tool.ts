/**
 * Read narrate.md from workspaces/<scanId>/per-tool/<scanner>/narrate.md.
 *
 * Server-only. Resolves the workspaces root via env var with a sentinel-root
 * fallback (the dashboard launches with cwd = sentinel root, see
 * src/cli/commands/dashboard.command.ts).
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

function workspacesRoot(): string {
  return process.env.SENTINEL_WORKSPACES_ROOT ?? join(process.cwd(), 'workspaces');
}

export function listScannersForScan(scanId: string): string[] {
  const dir = join(workspacesRoot(), scanId, 'per-tool');
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir).sort();
  } catch {
    return [];
  }
}

export function readPerToolNarrate(scanId: string, scanner: string): string | null {
  const path = join(workspacesRoot(), scanId, 'per-tool', scanner, 'narrate.md');
  if (!existsSync(path)) return null;
  try {
    const body = readFileSync(path, 'utf8');
    return body.length > 0 ? body : null;
  } catch {
    return null;
  }
}

export interface PerToolEntry {
  readonly scanner: string;
  readonly narrate: string;
}

export function readAllPerToolReports(scanId: string): PerToolEntry[] {
  const out: PerToolEntry[] = [];
  for (const scanner of listScannersForScan(scanId)) {
    const narrate = readPerToolNarrate(scanId, scanner);
    if (narrate !== null) out.push({ scanner, narrate });
  }
  return out;
}
