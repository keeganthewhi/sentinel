/**
 * PhaseRunRepository — persistence for individual scanner runs inside a scan.
 *
 * One row per (scanId, scanner, phase). Created at scanner start with status
 * RUNNING; updated to COMPLETED / FAILED / TIMED_OUT / SKIPPED at finish.
 *
 * Plan 018.5 adds an `iterations Json` column. The strategist iteration history
 * (one record per consultation) lives there. Reads go through Zod-validate
 * (`PhaseRunIterationHistorySchema`) — malformed JSON fails closed to `[]`
 * with a WARN log; never throws (CLAUDE.md sensitive-fields contract).
 */

import { Injectable } from '@nestjs/common';
import type { PhaseRun, PrismaClient } from '@prisma/client';
import { createLogger } from '../common/logger.js';
import {
  PhaseRunIterationHistorySchema,
  type PhaseRunIterationHistory,
} from './types/phase-run-iteration.js';

export type PhaseRunStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'TIMED_OUT' | 'SKIPPED';

export interface CreatePhaseRunInput {
  readonly scanId: string;
  readonly phase: number;
  readonly scanner: string;
  readonly status?: PhaseRunStatus;
}

export interface CompletePhaseRunInput {
  readonly id: string;
  readonly status: PhaseRunStatus;
  readonly findingCount: number;
  readonly completedAt: Date;
  readonly rawOutput?: string;
  readonly errorLog?: string;
  readonly iterations?: readonly PhaseRunIterationHistory[number][];
}

export interface UpsertIterationsInput {
  readonly scanId: string;
  readonly phase: number;
  readonly scanner: string;
  readonly iterations: readonly PhaseRunIterationHistory[number][];
}

const RAW_OUTPUT_LIMIT_BYTES = 5 * 1024 * 1024; // 5 MB cap per AGF::NucleiScanner gotcha

@Injectable()
export class PhaseRunRepository {
  private readonly logger = createLogger({ module: 'persistence.phase-run' });

  constructor(private readonly prisma: PrismaClient) {}

  public create(input: CreatePhaseRunInput): Promise<PhaseRun> {
    return this.prisma.phaseRun.create({
      data: {
        scanId: input.scanId,
        phase: input.phase,
        scanner: input.scanner,
        status: input.status ?? 'RUNNING',
      },
    });
  }

  public complete(input: CompletePhaseRunInput): Promise<PhaseRun> {
    const truncatedOutput =
      input.rawOutput !== undefined && input.rawOutput.length > RAW_OUTPUT_LIMIT_BYTES
        ? `${input.rawOutput.slice(0, RAW_OUTPUT_LIMIT_BYTES)}\n[TRUNCATED]`
        : input.rawOutput;

    return this.prisma.phaseRun.update({
      where: { id: input.id },
      data: {
        status: input.status,
        findingCount: input.findingCount,
        completedAt: input.completedAt,
        rawOutput: truncatedOutput,
        errorLog: input.errorLog,
        ...(input.iterations !== undefined && { iterations: input.iterations as unknown as object }),
      },
    });
  }

  /**
   * Persist an iteration history. Creates the PhaseRun row when one does not
   * already exist for `(scanId, scanner, phase)`, otherwise updates only the
   * iterations field. The pipeline currently does not always create PhaseRun
   * rows ahead of time, so this method is the canonical path for plan 018.5.
   *
   * Best-effort: errors propagate; the caller decides whether to swallow.
   */
  public async upsertIterations(input: UpsertIterationsInput): Promise<PhaseRun> {
    const existing = await this.prisma.phaseRun.findFirst({
      where: { scanId: input.scanId, scanner: input.scanner, phase: input.phase },
      orderBy: { startedAt: 'desc' },
    });
    if (existing !== null) {
      return this.prisma.phaseRun.update({
        where: { id: existing.id },
        data: { iterations: input.iterations as unknown as object },
      });
    }
    return this.prisma.phaseRun.create({
      data: {
        scanId: input.scanId,
        phase: input.phase,
        scanner: input.scanner,
        status: 'COMPLETED',
        iterations: input.iterations as unknown as object,
      },
    });
  }

  public findByScanId(scanId: string): Promise<PhaseRun[]> {
    return this.prisma.phaseRun.findMany({
      where: { scanId },
      orderBy: [{ phase: 'asc' }, { startedAt: 'asc' }],
    });
  }

  /**
   * Read the iteration history for a PhaseRun, Zod-validated. Fail-closed:
   * malformed JSON ⇒ `[]` + WARN log; never throws. Returns `[]` if the row
   * does not exist.
   */
  public async findIterations(id: string): Promise<PhaseRunIterationHistory> {
    const row = await this.prisma.phaseRun.findUnique({
      where: { id },
      select: { iterations: true },
    });
    if (row === null) return [];
    const parsed = PhaseRunIterationHistorySchema.safeParse(row.iterations);
    if (!parsed.success) {
      this.logger.warn(
        { phaseRunId: id, issues: parsed.error.issues.length },
        'iterations column failed Zod parse — returning empty history',
      );
      return [];
    }
    return parsed.data;
  }
}
