import { Module } from '@nestjs/common';
import { ConfigService } from './config/config.service.js';

/**
 * Root NestJS module. Feature modules are wired in during later phases:
 *   - ExecutionModule (Phase B)
 *   - ScannerModule (Phase B/C/D)
 *   - PipelineModule (Phase E)
 *   - CorrelationModule + ReportModule (Phase F)
 *   - PersistenceModule (Phase G)
 *   - GovernorModule (Phase H, optional)
 *   - CliModule (Phase J)
 *
 * For now it only exposes the ConfigService so that `main.ts` can bootstrap
 * the application context without errors.
 */
@Module({
  providers: [ConfigService],
  exports: [ConfigService],
})
export class AppModule {}
