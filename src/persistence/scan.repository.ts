/**
 * ScanRepository — owns persistence for the Scan aggregate root.
 *
 * Critical invariant #11 (CLAUDE.md): tenant scoping. Sentinel is single-tenant
 * but EVERY query is still scoped by `scanId` for the per-scan child entities.
 * Look-by-id queries on Scan itself return `null` instead of throwing on
 * not-found (caller decides whether 404 is the right user-facing response).
 */

import { Injectable } from '@nestjs/common';
import type { PrismaClient, Scan } from '@prisma/client';

export type ScanStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'PARTIAL';

export interface CreateScanInput {
  readonly targetRepo: string;
  readonly targetUrl?: string;
  readonly governed?: boolean;
}

export interface UpdateScanStatusInput {
  readonly id: string;
  readonly status: ScanStatus;
  readonly completedAt?: Date;
  readonly blueprintMd?: string;
}

@Injectable()
export class ScanRepository {
  constructor(private readonly prisma: PrismaClient) {}

  public create(input: CreateScanInput): Promise<Scan> {
    return this.prisma.scan.create({
      data: {
        targetRepo: input.targetRepo,
        targetUrl: input.targetUrl,
        governed: input.governed ?? false,
        status: 'PENDING',
      },
    });
  }

  public findById(id: string): Promise<Scan | null> {
    return this.prisma.scan.findUnique({ where: { id } });
  }

  public updateStatus(input: UpdateScanStatusInput): Promise<Scan> {
    return this.prisma.scan.update({
      where: { id: input.id },
      data: {
        status: input.status,
        ...(input.completedAt !== undefined && { completedAt: input.completedAt }),
        ...(input.blueprintMd !== undefined && { blueprintMd: input.blueprintMd }),
      },
    });
  }

  /** List the most recent scans for a given target repo, newest first. */
  public findRecentByRepo(targetRepo: string, limit = 10): Promise<Scan[]> {
    return this.prisma.scan.findMany({
      where: { targetRepo },
      orderBy: { startedAt: 'desc' },
      take: limit,
    });
  }

  public findAllRecent(limit = 20): Promise<Scan[]> {
    return this.prisma.scan.findMany({
      orderBy: { startedAt: 'desc' },
      take: limit,
    });
  }
}
