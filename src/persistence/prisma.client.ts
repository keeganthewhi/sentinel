/**
 * PrismaClient construction using the Prisma 7 adapter pattern.
 *
 * In Prisma 7 the datasource URL is no longer in `schema.prisma`. The runtime
 * client is constructed with an adapter (here: better-sqlite3) bound to the
 * DATABASE_URL file path.
 *
 * Tolerant construction:
 *   - `better-sqlite3` ships a native binding that must be compiled at
 *     `pnpm install` time. Fresh Windows checkouts without MSVC build tools,
 *     or checkouts where `pnpm approve-builds` has not run, will have no
 *     compiled binding.
 *   - `tryCreatePrismaClient()` catches the construction error and returns
 *     null so the start command can run the mechanical pipeline without a DB.
 *   - `createPrismaClient()` is the strict variant — used when the caller
 *     genuinely requires persistence.
 *
 * Repositories take a PrismaClient via DI so tests can mock it without ever
 * touching this file.
 */

import { chmodSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { createLogger } from '../common/logger.js';

const logger = createLogger({ module: 'persistence.prisma' });

export interface CreateOptions {
  readonly databaseUrl?: string;
}

/**
 * Strict PrismaClient construction. Throws if the better-sqlite3 native
 * binding is missing. Callers that can operate without persistence should
 * use `tryCreatePrismaClient()` instead.
 */
export function createPrismaClient(options: CreateOptions = {}): PrismaClient {
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL ?? 'file:./data/sentinel.db';
  const filename = databaseUrl.replace(/^file:/, '');
  logger.debug({ filename }, 'constructing PrismaClient via better-sqlite3 adapter');

  // Ensure data directory exists with restrictive permissions. The database
  // contains all scan findings (including severity/CVE data), governor AI
  // responses, and audit metadata — world-readable is unacceptable.
  const dir = dirname(filename);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  const adapter = new PrismaBetterSqlite3({ url: filename });
  const client = new PrismaClient({ adapter });

  // Restrict database file permissions after creation (better-sqlite3
  // creates with default umask, typically 0644 = world-readable).
  try {
    chmodSync(filename, 0o600);
  } catch {
    // File may not exist yet if this is first migration run.
  }

  return client;
}

/**
 * Tolerant PrismaClient construction. Returns null when the native binding
 * is missing or any other construction error occurs. The caller logs a
 * warning and continues without persistence (mechanical pipeline still works).
 */
export function tryCreatePrismaClient(options: CreateOptions = {}): PrismaClient | null {
  try {
    return createPrismaClient(options);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(
      { err: message },
      'PrismaClient construction failed — scan history and governor-decision persistence disabled. ' +
        'Run `pnpm install` (or `pnpm approve-builds`) to compile the better-sqlite3 native binding.',
    );
    return null;
  }
}
