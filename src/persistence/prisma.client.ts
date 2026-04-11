/**
 * PrismaClient construction using the Prisma 7 adapter pattern.
 *
 * In Prisma 7, the datasource URL is no longer in `schema.prisma`. The
 * runtime client is constructed with an adapter (here: better-sqlite3) and
 * pointed at the database file path read from `DATABASE_URL`.
 *
 * Test code does NOT instantiate this — repositories take a PrismaClient
 * instance via DI so tests can pass a mock.
 *
 * Note: better-sqlite3 ships a native binding that must be compiled at
 * `pnpm install` time. The repo's `pnpm.onlyBuiltDependencies` allow-list
 * includes it; fresh checkouts run `pnpm approve-builds` if the build was
 * skipped (Windows non-admin shells, for example).
 */

import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { createLogger } from '../common/logger.js';

const logger = createLogger({ module: 'persistence.prisma' });

interface CreateOptions {
  readonly databaseUrl?: string;
}

/**
 * Build a PrismaClient bound to a SQLite database file.
 *
 * `databaseUrl` accepts the standard `file:./data/sentinel.db` form. The
 * `file:` prefix is stripped before being passed to better-sqlite3.
 */
export function createPrismaClient(options: CreateOptions = {}): PrismaClient {
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL ?? 'file:./data/sentinel.db';
  const filename = databaseUrl.replace(/^file:/, '');
  logger.debug({ filename }, 'constructing PrismaClient via better-sqlite3 adapter');

  const adapter = new PrismaBetterSqlite3({ url: filename });
  return new PrismaClient({ adapter });
}
