import { describe, expect, it, vi } from 'vitest';
import { ScanRepository } from './scan.repository.js';
import type { PrismaClient, Scan } from '@prisma/client';

function makePrismaMock(): { prisma: PrismaClient; mocks: Record<string, ReturnType<typeof vi.fn>> } {
  const mocks = {
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    findMany: vi.fn(),
  };
  const prisma = {
    scan: {
      create: mocks.create,
      findUnique: mocks.findUnique,
      update: mocks.update,
      findMany: mocks.findMany,
    },
  } as unknown as PrismaClient;
  return { prisma, mocks };
}

const baseScan: Scan = {
  id: 'scan-1',
  status: 'PENDING',
  targetRepo: '/tmp/repo',
  targetUrl: null,
  governed: false,
  blueprintMd: null,
  startedAt: new Date('2026-04-11T00:00:00Z'),
  completedAt: null,
  createdAt: new Date('2026-04-11T00:00:00Z'),
  updatedAt: new Date('2026-04-11T00:00:00Z'),
};

describe('ScanRepository', () => {
  it('create() inserts a scan with PENDING status', async () => {
    const { prisma, mocks } = makePrismaMock();
    mocks.create.mockResolvedValue(baseScan);
    const repo = new ScanRepository(prisma);
    const result = await repo.create({ targetRepo: '/tmp/repo' });
    expect(mocks.create).toHaveBeenCalledWith({
      data: { targetRepo: '/tmp/repo', targetUrl: undefined, governed: false, status: 'PENDING' },
    });
    expect(result).toBe(baseScan);
  });

  it('create() honours governed flag', async () => {
    const { prisma, mocks } = makePrismaMock();
    mocks.create.mockResolvedValue({ ...baseScan, governed: true });
    const repo = new ScanRepository(prisma);
    await repo.create({ targetRepo: '/tmp/repo', governed: true });
    expect(mocks.create).toHaveBeenCalledWith({
      data: { targetRepo: '/tmp/repo', targetUrl: undefined, governed: true, status: 'PENDING' },
    });
  });

  it('findById() returns the row from prisma', async () => {
    const { prisma, mocks } = makePrismaMock();
    mocks.findUnique.mockResolvedValue(baseScan);
    const repo = new ScanRepository(prisma);
    const result = await repo.findById('scan-1');
    expect(result).toBe(baseScan);
    expect(mocks.findUnique).toHaveBeenCalledWith({ where: { id: 'scan-1' } });
  });

  it('updateStatus() includes optional completedAt only when provided', async () => {
    const { prisma, mocks } = makePrismaMock();
    mocks.update.mockResolvedValue({ ...baseScan, status: 'COMPLETED' });
    const repo = new ScanRepository(prisma);
    const completedAt = new Date('2026-04-11T00:01:00Z');
    await repo.updateStatus({ id: 'scan-1', status: 'COMPLETED', completedAt });
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: 'scan-1' },
      data: { status: 'COMPLETED', completedAt },
    });
  });

  it('updateStatus() omits completedAt when not provided', async () => {
    const { prisma, mocks } = makePrismaMock();
    mocks.update.mockResolvedValue({ ...baseScan, status: 'RUNNING' });
    const repo = new ScanRepository(prisma);
    await repo.updateStatus({ id: 'scan-1', status: 'RUNNING' });
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: 'scan-1' },
      data: { status: 'RUNNING' },
    });
  });

  it('findRecentByRepo() orders by startedAt desc', async () => {
    const { prisma, mocks } = makePrismaMock();
    mocks.findMany.mockResolvedValue([baseScan]);
    const repo = new ScanRepository(prisma);
    await repo.findRecentByRepo('/tmp/repo', 5);
    expect(mocks.findMany).toHaveBeenCalledWith({
      where: { targetRepo: '/tmp/repo' },
      orderBy: { startedAt: 'desc' },
      take: 5,
    });
  });
});
