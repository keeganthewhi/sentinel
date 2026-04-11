/**
 * Zod config schema for Sentinel.
 *
 * Matches AGENTS-full.md `AGF::ConfigSchema` exactly. Downstream modules
 * (scanner registry, pipeline, governor adapter) depend on the exact shape.
 *
 * Merge order (lowest to highest priority):
 *   1. Defaults from this schema
 *   2. sentinel.yaml (explicit --config <path> or current directory)
 *   3. Environment variables (REDIS_URL, DATABASE_URL, SCANNER_IMAGE, DATA_DIR, SENTINEL_GOVERNOR_CLI)
 *   4. CLI flags (highest)
 */

import { z } from 'zod';
import { ConfigValidationError } from '../common/errors.js';

export const AuthConfigSchema = z.object({
  type: z.enum(['none', 'bearer', 'cookie']).default('none'),
  token: z.string().optional(),
  cookies: z.record(z.string(), z.string()).optional(),
});

export const ConfigSchema = z.object({
  target: z.object({
    repo: z.string().min(1, 'target.repo must not be empty'),
    url: z.string().url('target.url must be a valid URL').optional(),
  }),
  mode: z
    .object({
      governed: z.boolean().default(false),
      shannon: z.boolean().default(false),
      phases: z.array(z.number().int().min(1).max(3)).optional(),
    })
    .default({ governed: false, shannon: false }),
  scanners: z
    .object({
      only: z.array(z.string()).optional(),
      exclude: z.array(z.string()).optional(),
      configs: z.record(z.string(), z.unknown()).default({}),
    })
    .default({ configs: {} }),
  timeouts: z
    .object({
      scannerMs: z
        .number()
        .int()
        .positive()
        .default(30 * 60 * 1000),
      governorMs: z
        .number()
        .int()
        .positive()
        .default(5 * 60 * 1000),
    })
    .default({
      scannerMs: 30 * 60 * 1000,
      governorMs: 5 * 60 * 1000,
    }),
  runtime: z
    .object({
      redisUrl: z.string().default('redis://localhost:6379'),
      databaseUrl: z.string().default('file:./data/sentinel.db'),
      scannerImage: z.string().default('sentinel-scanner:latest'),
      dataDir: z.string().default('./data'),
    })
    .default({
      redisUrl: 'redis://localhost:6379',
      databaseUrl: 'file:./data/sentinel.db',
      scannerImage: 'sentinel-scanner:latest',
      dataDir: './data',
    }),
  authentication: AuthConfigSchema.optional(),
  verbose: z.boolean().default(false),
});

export type SentinelConfig = z.infer<typeof ConfigSchema>;
export type AuthConfig = z.infer<typeof AuthConfigSchema>;

/**
 * Parse and validate an arbitrary config object.
 *
 * Throws ConfigValidationError on failure. The error's message lists every
 * failing field path for operator diagnosis.
 */
export function validateConfig(raw: unknown): SentinelConfig {
  const result = ConfigSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new ConfigValidationError(`Invalid configuration: ${issues}`);
  }
  return result.data;
}
