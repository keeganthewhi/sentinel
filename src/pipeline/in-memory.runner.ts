/**
 * In-memory pipeline runner — executes a scanner directly via its `.execute()`
 * method and converts any uncaught throw into a failure result.
 *
 * Used by tests and by the default CLI path when Redis is not available.
 */

import { Injectable } from '@nestjs/common';
import { createLogger } from '../common/logger.js';
import type {
  BaseScanner,
  ScanContext,
  ScannerResult,
} from '../scanner/types/scanner.interface.js';
import type { IPipelineRunner } from './types.js';

@Injectable()
export class InMemoryPipelineRunner implements IPipelineRunner {
  private readonly logger = createLogger({ module: 'pipeline.runner.in-memory' });

  public async runScanner(scanner: BaseScanner, context: ScanContext): Promise<ScannerResult> {
    const startedAt = Date.now();
    try {
      const result = await scanner.execute(context);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        { scanner: scanner.name, scanId: context.scanId, err: message },
        'scanner threw — converting to failure result',
      );
      return {
        scanner: scanner.name,
        findings: [],
        rawOutput: '',
        executionTimeMs: Date.now() - startedAt,
        success: false,
        error: message,
      };
    }
  }
}
