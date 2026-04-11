/**
 * GovernorDecisionRepository — append-only audit log of governor decisions.
 *
 * Each row stores both the input given to the governor (typed payload) and the
 * raw output (validated upstream by the governor adapter). NEVER call `update()`
 * on this table — decisions are immutable.
 */

import { Injectable } from '@nestjs/common';
import type { GovernorDecision, PrismaClient } from '@prisma/client';

export type DecisionType = 'scan_plan' | 'evaluation' | 'report';

export interface RecordDecisionInput {
  readonly scanId: string;
  readonly phase: number;
  readonly decisionType: DecisionType;
  readonly input: unknown;
  readonly output: unknown;
  readonly rationale?: string;
}

@Injectable()
export class GovernorDecisionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  public record(input: RecordDecisionInput): Promise<GovernorDecision> {
    return this.prisma.governorDecision.create({
      data: {
        scanId: input.scanId,
        phase: input.phase,
        decisionType: input.decisionType,
        inputJson: JSON.stringify(input.input),
        outputJson: input.output === null ? null : JSON.stringify(input.output),
        rationale: input.rationale,
      },
    });
  }

  public findByScanId(scanId: string): Promise<GovernorDecision[]> {
    return this.prisma.governorDecision.findMany({
      where: { scanId },
      orderBy: { createdAt: 'asc' },
    });
  }

  public findByScanIdAndPhase(scanId: string, phase: number): Promise<GovernorDecision[]> {
    return this.prisma.governorDecision.findMany({
      where: { scanId, phase },
      orderBy: { createdAt: 'asc' },
    });
  }
}
