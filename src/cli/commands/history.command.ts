/**
 * `sentinel history` — list past scans for a target repo (or all repos).
 */

import type { ScanRepository } from '../../persistence/scan.repository.js';

export interface HistoryOptions {
  readonly repo?: string;
  readonly limit?: number;
}

export interface HistoryDeps {
  readonly scans: ScanRepository;
}

export interface HistoryRow {
  readonly id: string;
  readonly status: string;
  readonly targetRepo: string;
  readonly startedAt: string;
  readonly governed: boolean;
}

export async function historyCommand(options: HistoryOptions, deps: HistoryDeps): Promise<HistoryRow[]> {
  const limit = options.limit ?? 20;
  const rows = options.repo !== undefined
    ? await deps.scans.findRecentByRepo(options.repo, limit)
    : await deps.scans.findAllRecent(limit);

  return rows.map((scan) => ({
    id: scan.id,
    status: scan.status,
    targetRepo: scan.targetRepo,
    startedAt: scan.startedAt.toISOString(),
    governed: scan.governed,
  }));
}
