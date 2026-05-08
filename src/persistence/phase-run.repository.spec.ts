import { describe, expect, it, vi } from 'vitest';
import { PhaseRunRepository } from './phase-run.repository.js';
import type { PrismaClient, PhaseRun } from '@prisma/client';
import type { PhaseRunIteration } from './types/phase-run-iteration.js';

interface MockedFns {
  create: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  findFirst: ReturnType<typeof vi.fn>;
  findMany: ReturnType<typeof vi.fn>;
  findUnique: ReturnType<typeof vi.fn>;
}

function makePrismaMock(): { prisma: PrismaClient; mocks: MockedFns } {
  const mocks: MockedFns = {
    create: vi.fn(),
    update: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
  };
  const prisma = {
    phaseRun: {
      create: mocks.create,
      update: mocks.update,
      findFirst: mocks.findFirst,
      findMany: mocks.findMany,
      findUnique: mocks.findUnique,
    },
  } as unknown as PrismaClient;
  return { prisma, mocks };
}

const baseRow: PhaseRun = {
  id: 'phaserun-1',
  scanId: 'scan-1',
  phase: 1,
  scanner: 'semgrep',
  status: 'COMPLETED',
  startedAt: new Date('2026-05-08T10:00:00Z'),
  completedAt: new Date('2026-05-08T10:01:00Z'),
  findingCount: 0,
  rawOutput: null,
  errorLog: null,
  iterations: [],
};

function makeIter(i: number, findingsCount = 1): PhaseRunIteration {
  return {
    iteration: i,
    plan: {
      extraArgs: ['--config', 'p/default'],
      severityFloor: 'LOW',
      rationale: `iteration ${i}`,
      confidence: 'MEDIUM',
    },
    findingsCount,
    executionTimeMs: 1234,
    success: true,
  };
}

describe('PhaseRunRepository', () => {
  it('complete() persists iterations when provided', async () => {
    const { prisma, mocks } = makePrismaMock();
    mocks.update.mockResolvedValue(baseRow);
    const repo = new PhaseRunRepository(prisma);
    const iterations = [makeIter(0), makeIter(1)];
    await repo.complete({
      id: 'phaserun-1',
      status: 'COMPLETED',
      findingCount: 2,
      completedAt: new Date('2026-05-08T10:01:00Z'),
      iterations,
    });
    expect(mocks.update).toHaveBeenCalledTimes(1);
    const args = mocks.update.mock.calls[0][0] as { data: { iterations?: unknown } };
    expect(args.data.iterations).toEqual(iterations);
  });

  it('complete() omits iterations key when undefined', async () => {
    const { prisma, mocks } = makePrismaMock();
    mocks.update.mockResolvedValue(baseRow);
    const repo = new PhaseRunRepository(prisma);
    await repo.complete({
      id: 'phaserun-1',
      status: 'COMPLETED',
      findingCount: 0,
      completedAt: new Date(),
    });
    const args = mocks.update.mock.calls[0][0] as { data: Record<string, unknown> };
    expect('iterations' in args.data).toBe(false);
  });

  it('upsertIterations() updates when row exists', async () => {
    const { prisma, mocks } = makePrismaMock();
    mocks.findFirst.mockResolvedValue(baseRow);
    mocks.update.mockResolvedValue(baseRow);
    const repo = new PhaseRunRepository(prisma);
    const iterations = [makeIter(0)];
    await repo.upsertIterations({ scanId: 'scan-1', phase: 1, scanner: 'semgrep', iterations });
    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: { scanId: 'scan-1', scanner: 'semgrep', phase: 1 },
      orderBy: { startedAt: 'desc' },
    });
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: 'phaserun-1' },
      data: { iterations },
    });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('upsertIterations() creates row when none exists', async () => {
    const { prisma, mocks } = makePrismaMock();
    mocks.findFirst.mockResolvedValue(null);
    mocks.create.mockResolvedValue(baseRow);
    const repo = new PhaseRunRepository(prisma);
    const iterations = [makeIter(0), makeIter(1), makeIter(2)];
    await repo.upsertIterations({ scanId: 'scan-1', phase: 2, scanner: 'nuclei', iterations });
    expect(mocks.create).toHaveBeenCalledWith({
      data: {
        scanId: 'scan-1',
        phase: 2,
        scanner: 'nuclei',
        status: 'COMPLETED',
        iterations,
      },
    });
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('findIterations() returns parsed history on valid JSON', async () => {
    const { prisma, mocks } = makePrismaMock();
    const iterations = [makeIter(0), makeIter(1)];
    mocks.findUnique.mockResolvedValue({ iterations });
    const repo = new PhaseRunRepository(prisma);
    const result = await repo.findIterations('phaserun-1');
    expect(result).toEqual(iterations);
  });

  it('findIterations() returns [] when row absent', async () => {
    const { prisma, mocks } = makePrismaMock();
    mocks.findUnique.mockResolvedValue(null);
    const repo = new PhaseRunRepository(prisma);
    const result = await repo.findIterations('missing');
    expect(result).toEqual([]);
  });

  it('findIterations() fails closed on malformed JSON — returns [], does not throw', async () => {
    const { prisma, mocks } = makePrismaMock();
    mocks.findUnique.mockResolvedValue({ iterations: { not: 'an-array' } });
    const repo = new PhaseRunRepository(prisma);
    const result = await repo.findIterations('phaserun-1');
    expect(result).toEqual([]);
  });

  it('findIterations() fails closed on schema mismatch (missing required fields)', async () => {
    const { prisma, mocks } = makePrismaMock();
    mocks.findUnique.mockResolvedValue({
      iterations: [{ iteration: 0, missingPlanField: true }],
    });
    const repo = new PhaseRunRepository(prisma);
    const result = await repo.findIterations('phaserun-1');
    expect(result).toEqual([]);
  });

  it('findIterations() fails closed on null cell value', async () => {
    const { prisma, mocks } = makePrismaMock();
    mocks.findUnique.mockResolvedValue({ iterations: null });
    const repo = new PhaseRunRepository(prisma);
    const result = await repo.findIterations('phaserun-1');
    expect(result).toEqual([]);
  });

  it('round-trip: upsert then read returns same iteration content', async () => {
    const { prisma, mocks } = makePrismaMock();
    const iterations = [makeIter(0, 5), makeIter(1, 0), makeIter(2, 12)];
    let stored: unknown = [];
    mocks.findFirst.mockResolvedValue(null);
    mocks.create.mockImplementation((args: { data: { iterations: unknown } }) => {
      stored = args.data.iterations;
      return Promise.resolve({ ...baseRow, iterations: stored });
    });
    mocks.findUnique.mockImplementation(() => Promise.resolve({ iterations: stored }));
    const repo = new PhaseRunRepository(prisma);
    await repo.upsertIterations({ scanId: 'scan-1', phase: 1, scanner: 'semgrep', iterations });
    const read = await repo.findIterations('phaserun-1');
    expect(read).toEqual(iterations);
  });
});
