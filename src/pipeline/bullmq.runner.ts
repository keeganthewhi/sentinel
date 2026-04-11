/**
 * BullMQ pipeline runner — production path when Redis is available.
 *
 * Each scanner execution becomes a BullMQ job. The worker resolves the job by
 * looking up the scanner in `ScannerRegistry` and calling its `.execute()`.
 * The runner awaits the job result via `waitUntilFinished()`.
 *
 * NOTE: Constructing this class opens a live Redis connection. Tests should
 * use `InMemoryPipelineRunner` instead to avoid Redis dependency.
 */

import { Injectable } from '@nestjs/common';
import { Queue, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import { createLogger } from '../common/logger.js';
import { ScannerRegistry } from '../scanner/scanner.registry.js';
import type {
  BaseScanner,
  ScanContext,
  ScannerResult,
} from '../scanner/types/scanner.interface.js';
import type { IPipelineRunner } from './types.js';

interface ScannerJobData {
  readonly scannerName: string;
  readonly context: ScanContext;
}

const QUEUE_NAME = 'sentinel-scans';

interface Connected {
  readonly connection: Redis;
  readonly queue: Queue<ScannerJobData, ScannerResult>;
  readonly worker: Worker<ScannerJobData, ScannerResult>;
}

@Injectable()
export class BullMqPipelineRunner implements IPipelineRunner {
  private readonly logger = createLogger({ module: 'pipeline.runner.bullmq' });
  private state: Connected | null = null;
  private readonly registry: ScannerRegistry;
  private readonly redisUrl: string;

  constructor(registry: ScannerRegistry, redisUrl = 'redis://localhost:6379') {
    this.registry = registry;
    this.redisUrl = redisUrl;
  }

  private ensureConnected(): Connected {
    if (this.state !== null) return this.state;

    const connection = new Redis(this.redisUrl, { maxRetriesPerRequest: null });
    const queue = new Queue<ScannerJobData, ScannerResult>(QUEUE_NAME, { connection });
    const worker = new Worker<ScannerJobData, ScannerResult>(
      QUEUE_NAME,
      async (job: Job<ScannerJobData, ScannerResult>): Promise<ScannerResult> => {
        const scanner = this.registry.get(job.data.scannerName);
        if (scanner === undefined) {
          throw new Error(`Scanner "${job.data.scannerName}" not registered`);
        }
        return scanner.execute(job.data.context);
      },
      { connection },
    );
    worker.on('failed', (job, err) => {
      this.logger.warn(
        { scanner: job?.data.scannerName, err: err.message },
        'scanner job failed',
      );
    });

    this.state = { connection, queue, worker };
    return this.state;
  }

  public async runScanner(scanner: BaseScanner, context: ScanContext): Promise<ScannerResult> {
    const startedAt = Date.now();
    try {
      const { queue, worker } = this.ensureConnected();
      const job = await queue.add(scanner.name, { scannerName: scanner.name, context });
      return await job.waitUntilFinished(worker as unknown as Parameters<typeof job.waitUntilFinished>[0]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        { scanner: scanner.name, scanId: context.scanId, err: message },
        'BullMQ runScanner failed — returning failure result',
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

  public async close(): Promise<void> {
    if (this.state === null) return;
    const { queue, worker, connection } = this.state;
    await worker.close();
    await queue.close();
    connection.disconnect();
    this.state = null;
  }
}
