/**
 * JSON report renderer — produces a stable machine-readable report shape.
 *
 * Downstream consumers: Prisma persistence layer (Phase G), `./sentinel report <id>`
 * CLI subcommand (Phase J), regression diff command (Phase J).
 */

import { Injectable } from '@nestjs/common';
import type { NormalizedFinding, Severity } from '../../scanner/types/finding.interface.js';
import type { ReportInput } from './markdown.renderer.js';

export interface JsonReport {
  readonly scanId: string;
  readonly targetRepo: string;
  readonly targetUrl?: string;
  readonly durationMs: number;
  readonly summary: {
    readonly total: number;
    readonly bySeverity: Record<Severity, number>;
  };
  readonly findings: readonly NormalizedFinding[];
}

@Injectable()
export class JsonRenderer {
  public render(input: ReportInput): JsonReport {
    const bySeverity: Record<Severity, number> = {
      CRITICAL: 0,
      HIGH: 0,
      MEDIUM: 0,
      LOW: 0,
      INFO: 0,
    };
    for (const finding of input.findings) bySeverity[finding.severity]++;

    return {
      scanId: input.scanId,
      targetRepo: input.targetRepo,
      ...(input.targetUrl !== undefined && { targetUrl: input.targetUrl }),
      durationMs: input.durationMs,
      summary: {
        total: input.findings.length,
        bySeverity,
      },
      findings: input.findings,
    };
  }

  public stringify(input: ReportInput): string {
    return JSON.stringify(this.render(input), null, 2);
  }
}
