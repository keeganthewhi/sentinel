import { describe, expect, it, vi } from 'vitest';
import { RegressionService } from './regression.service.js';
import type { PrismaClient } from '@prisma/client';

interface MockedFns {
  scanFindUnique: ReturnType<typeof vi.fn>;
  scanFindFirst: ReturnType<typeof vi.fn>;
  findingFindMany: ReturnType<typeof vi.fn>;
}

function makePrismaMock(): { prisma: PrismaClient; mocks: MockedFns } {
  const mocks: MockedFns = {
    scanFindUnique: vi.fn(),
    scanFindFirst: vi.fn(),
    findingFindMany: vi.fn(),
  };
  const prisma = {
    scan: {
      findUnique: mocks.scanFindUnique,
      findFirst: mocks.scanFindFirst,
    },
    finding: {
      findMany: mocks.findingFindMany,
    },
  } as unknown as PrismaClient;
  return { prisma, mocks };
}

const currentScan = {
  id: 'scan-current',
  status: 'COMPLETED',
  targetRepo: '/tmp/repo',
  targetUrl: null,
  governed: false,
  blueprintMd: null,
  startedAt: new Date('2026-04-11T01:00:00Z'),
  completedAt: new Date('2026-04-11T01:01:00Z'),
  createdAt: new Date(),
  updatedAt: new Date(),
};

const baselineScan = { ...currentScan, id: 'scan-baseline', startedAt: new Date('2026-04-10T00:00:00Z') };

describe('RegressionService', () => {
  it('returns empty diff with null baseline when current scan is not found', async () => {
    const { prisma, mocks } = makePrismaMock();
    mocks.scanFindUnique.mockResolvedValue(null);
    const service = new RegressionService(prisma);
    const diff = await service.diff('missing');
    expect(diff.baselineScanId).toBeNull();
    expect(diff.newFingerprints).toEqual([]);
  });

  it('treats every current finding as new when no baseline exists', async () => {
    const { prisma, mocks } = makePrismaMock();
    mocks.scanFindUnique.mockResolvedValue(currentScan);
    mocks.scanFindFirst.mockResolvedValue(null);
    mocks.findingFindMany.mockResolvedValueOnce([{ fingerprint: 'fp-a' }, { fingerprint: 'fp-b' }]);
    const service = new RegressionService(prisma);
    const diff = await service.diff('scan-current');
    expect(diff.baselineScanId).toBeNull();
    expect(diff.newFingerprints).toEqual(['fp-a', 'fp-b']);
    expect(diff.fixedFingerprints).toEqual([]);
    expect(diff.persistedFingerprints).toEqual([]);
  });

  it('classifies findings as new / fixed / persisted', async () => {
    const { prisma, mocks } = makePrismaMock();
    mocks.scanFindUnique.mockResolvedValue(currentScan);
    mocks.scanFindFirst.mockResolvedValue(baselineScan);
    // First call: current. Second: baseline.
    mocks.findingFindMany
      .mockResolvedValueOnce([{ fingerprint: 'fp-a' }, { fingerprint: 'fp-b' }, { fingerprint: 'fp-c' }])
      .mockResolvedValueOnce([{ fingerprint: 'fp-b' }, { fingerprint: 'fp-c' }, { fingerprint: 'fp-d' }]);

    const service = new RegressionService(prisma);
    const diff = await service.diff('scan-current');

    expect(diff.baselineScanId).toBe('scan-baseline');
    expect(diff.newFingerprints).toEqual(['fp-a']);
    expect(diff.persistedFingerprints).toEqual(['fp-b', 'fp-c']);
    expect(diff.fixedFingerprints).toEqual(['fp-d']);
  });

  it('finds the baseline filtered by targetRepo and excludes current scan id', async () => {
    const { prisma, mocks } = makePrismaMock();
    mocks.scanFindUnique.mockResolvedValue(currentScan);
    mocks.scanFindFirst.mockResolvedValue(baselineScan);
    mocks.findingFindMany.mockResolvedValue([]);
    const service = new RegressionService(prisma);
    await service.diff('scan-current');
    expect(mocks.scanFindFirst).toHaveBeenCalledWith({
      where: {
        targetRepo: '/tmp/repo',
        status: { in: ['COMPLETED', 'PARTIAL'] },
        id: { not: 'scan-current' },
        startedAt: { lt: currentScan.startedAt },
      },
      orderBy: { startedAt: 'desc' },
    });
  });
});
