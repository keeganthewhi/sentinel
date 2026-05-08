/**
 * SyncModule — wires the RedisEventPublisher.
 *
 * Imports PipelineModule for the shared ProgressEmitter singleton. Provides
 * the dashboard Redis URL token from env (`SENTINEL_DASHBOARD_REDIS_URL` →
 * `REDIS_URL` fallback) so the publisher can be a no-op in dev workflows
 * that do not need live streaming.
 *
 * Mechanical-first: a missing or unreachable Redis instance never blocks a
 * scan — the publisher catches all errors at runtime.
 */

import { Module } from '@nestjs/common';
import { PipelineModule } from '../pipeline/pipeline.module.js';
import {
  REDIS_DASHBOARD_URL_TOKEN,
  RedisEventPublisher,
} from './redis-event-publisher.js';

@Module({
  imports: [PipelineModule],
  providers: [
    {
      provide: REDIS_DASHBOARD_URL_TOKEN,
      useFactory: (): string | undefined =>
        process.env.SENTINEL_DASHBOARD_REDIS_URL ?? process.env.REDIS_URL,
    },
    RedisEventPublisher,
  ],
  exports: [RedisEventPublisher],
})
export class SyncModule {}
