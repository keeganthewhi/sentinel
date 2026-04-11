/**
 * PersistenceModule wires the PrismaClient and the four repositories.
 *
 * The PrismaClient is provided as a NestJS factory so callers can override
 * it in tests with a mock that satisfies the public surface used by the
 * repositories.
 */

import { Module } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { createPrismaClient } from './prisma.client.js';
import { ScanRepository } from './scan.repository.js';
import { FindingRepository } from './finding.repository.js';
import { PhaseRunRepository } from './phase-run.repository.js';
import { GovernorDecisionRepository } from './governor-decision.repository.js';
import { RegressionService } from './regression.service.js';

export const PRISMA_CLIENT = Symbol('PRISMA_CLIENT');

@Module({
  providers: [
    {
      provide: PrismaClient,
      useFactory: (): PrismaClient => createPrismaClient(),
    },
    ScanRepository,
    FindingRepository,
    PhaseRunRepository,
    GovernorDecisionRepository,
    RegressionService,
  ],
  exports: [
    PrismaClient,
    ScanRepository,
    FindingRepository,
    PhaseRunRepository,
    GovernorDecisionRepository,
    RegressionService,
  ],
})
export class PersistenceModule {}
