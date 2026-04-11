import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { rootLogger } from './common/logger.js';

/**
 * Sentinel is a CLI tool, not an HTTP server. We use
 * `createApplicationContext` to bootstrap the DI container without
 * starting an HTTP listener.
 *
 * The Commander entry (`src/cli.ts`) is a separate binary and is the
 * user-facing entry point for end-to-end scans. This file exists so that
 * `pnpm build && node dist/main.js` smoke-tests the DI graph.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: false,
  });

  rootLogger.info({ phase: 'bootstrap' }, 'Sentinel application context ready');
  await app.close();
}

void bootstrap();
