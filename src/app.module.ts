import { Module } from '@nestjs/common';
import { ConfigService } from './config/config.service.js';
import { ScannerModule } from './scanner/scanner.module.js';
import { PipelineModule } from './pipeline/pipeline.module.js';
import { CorrelationModule } from './correlation/correlation.module.js';
import { ReportModule } from './report/report.module.js';

/**
 * Root NestJS module — wires every runtime feature module so that the
 * Commander `start` command can resolve PipelineService + CorrelationService
 * + renderers from a single application context.
 *
 * PersistenceModule and GovernorModule are intentionally NOT wired here:
 *   - PersistenceModule needs a compiled `better-sqlite3` native binding,
 *     which Windows hosts may lack until `pnpm approve-builds` runs once.
 *     The CLI handles persistence as best-effort and falls back to
 *     filesystem-only output when the Prisma client cannot be constructed.
 *   - GovernorModule is opt-in via `--governed`; the CLI constructs it
 *     ad-hoc when the flag is set.
 */
@Module({
  imports: [ScannerModule, PipelineModule, CorrelationModule, ReportModule],
  providers: [ConfigService],
  exports: [ConfigService],
})
export class AppModule {}
