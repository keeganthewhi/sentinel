import { describe, expect, it, vi } from 'vitest';
import { FindingRepository, type PersistFindingInput } from './finding.repository.js';
import type { PrismaClient } from '@prisma/client';

interface MockedFns {
  createMany: ReturnType<typeof vi.fn>;
  findMany: ReturnType<typeof vi.fn>;
  findUnique: ReturnType<typeof vi.fn>;
  count: ReturnType<typeof vi.fn>;
  $transaction: ReturnType<typeof vi.fn>;
}

function makePrismaMock(): { prisma: PrismaClient; mocks: MockedFns } {
  const mocks: MockedFns = {
    createMany: vi.fn().mockResolvedValue({ count: 0 }),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    count: vi.fn(),
    $transaction: vi.fn(),
  };
  // $transaction in our usage is `await prisma.$transaction(async tx => ...)` —
  // the mock just runs the callback with the same prisma object as the tx.
  mocks.$transaction.mockImplementation(async (cb: (tx: PrismaClient) => Promise<unknown>) => {
    return cb(prisma);
  });
  const prisma = {
    finding: {
      createMany: mocks.createMany,
      findMany: mocks.findMany,
      findUnique: mocks.findUnique,
      count: mocks.count,
    },
    $transaction: mocks.$transaction,
  } as unknown as PrismaClient;
  return { prisma, mocks };
}

function makeFinding(overrides: Partial<PersistFindingInput> = {}): PersistFindingInput {
  return {
    scanner: 'trivy',
    fingerprint: 'fp-1',
    title: 'CVE-2024-1',
    description: 'desc',
    severity: 'HIGH',
    category: 'dependency',
    normalizedScore: 0,
    cveId: 'CVE-2024-1',
    ...overrides,
  };
}

describe('FindingRepository', () => {
  it('insertMany() returns 0 for an empty list without touching prisma', async () => {
    const { prisma, mocks } = makePrismaMock();
    const repo = new FindingRepository(prisma);
    const count = await repo.insertMany('scan-1', []);
    expect(count).toBe(0);
    expect(mocks.createMany).not.toHaveBeenCalled();
    expect(mocks.$transaction).not.toHaveBeenCalled();
  });

  it('insertMany() wraps the createMany call in $transaction', async () => {
    const { prisma, mocks } = makePrismaMock();
    mocks.createMany.mockResolvedValue({ count: 2 });
    const repo = new FindingRepository(prisma);
    const count = await repo.insertMany('scan-1', [makeFinding(), makeFinding({ fingerprint: 'fp-2' })]);
    expect(count).toBe(2);
    expect(mocks.$transaction).toHaveBeenCalledTimes(1);
    expect(mocks.createMany).toHaveBeenCalledTimes(1);
    const arg = mocks.createMany.mock.calls[0]?.[0] as { data: unknown[] };
    expect(arg.data).toHaveLength(2);
  });

  it('insertMany() carries scanId on every row', async () => {
    const { prisma, mocks } = makePrismaMock();
    mocks.createMany.mockResolvedValue({ count: 1 });
    const repo = new FindingRepository(prisma);
    await repo.insertMany('scan-7', [makeFinding()]);
    const arg = mocks.createMany.mock.calls[0]?.[0] as { data: { scanId: string }[] };
    expect(arg.data[0]?.scanId).toBe('scan-7');
  });

  it('findByFingerprint uses the composite (scanId, fingerprint) key — no raw findUnique on id', async () => {
    const { prisma, mocks } = makePrismaMock();
    mocks.findUnique.mockResolvedValue(null);
    const repo = new FindingRepository(prisma);
    await repo.findByFingerprint('scan-1', 'fp-1');
    expect(mocks.findUnique).toHaveBeenCalledWith({
      where: { scanId_fingerprint: { scanId: 'scan-1', fingerprint: 'fp-1' } },
    });
  });

  it('findAllByScanId scopes the query by scanId', async () => {
    const { prisma, mocks } = makePrismaMock();
    mocks.findMany.mockResolvedValue([]);
    const repo = new FindingRepository(prisma);
    await repo.findAllByScanId('scan-9');
    expect(mocks.findMany).toHaveBeenCalledWith({
      where: { scanId: 'scan-9' },
      orderBy: [{ severity: 'asc' }, { category: 'asc' }],
    });
  });

  it('countByScanId scopes the count by scanId', async () => {
    const { prisma, mocks } = makePrismaMock();
    mocks.count.mockResolvedValue(3);
    const repo = new FindingRepository(prisma);
    const result = await repo.countByScanId('scan-9');
    expect(result).toBe(3);
    expect(mocks.count).toHaveBeenCalledWith({ where: { scanId: 'scan-9' } });
  });
});
