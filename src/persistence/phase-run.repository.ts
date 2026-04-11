/**
 * PhaseRunRepository — persistence for individual scanner runs inside a scan.
 *
 * One row per (scanId, scanner, phase). Created at scanner start with status
 * RUNNING; updated to COMPLETED / FAILED / TIMED_OUT / SKIPPED at finish.
 */

import { Injectable } from '@nestjs/common';
import type { PhaseRun, PrismaClient } from '@prisma/client';

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
}

const RAW_OUTPUT_LIMIT_BYTES = 5 * 1024 * 1024; // 5 MB cap per AGF::NucleiScanner gotcha

@Injectable()
export class PhaseRunRepository {
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
      },
    });
  }

  public findByScanId(scanId: string): Promise<PhaseRun[]> {
    return this.prisma.phaseRun.findMany({
      where: { scanId },
      orderBy: [{ phase: 'asc' }, { startedAt: 'asc' }],
    });
  }
}
