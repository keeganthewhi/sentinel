/**
 * ConfigService — merges CLI flags + sentinel.yaml + env vars into a validated SentinelConfig.
 *
 * Merge order: defaults → YAML → env → CLI flags (highest priority).
 * Never mutates its input sources.
 */

import { Injectable } from '@nestjs/common';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import yaml from 'js-yaml';
import { validateConfig, type SentinelConfig } from './config.schema.js';
import { ConfigValidationError } from '../common/errors.js';

export interface LoadSources {
  /** CLI flags already parsed by Commander — plain object. */
  cliFlags?: Record<string, unknown>;
  /** Optional path to sentinel.yaml. When omitted, the default `./sentinel.yaml` is tried. */
  yamlPath?: string;
  /** Environment variables — usually `process.env`. */
  env?: NodeJS.ProcessEnv;
}

type DeepRecord = Record<string, unknown>;

function isRecord(value: unknown): value is DeepRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deepMerge(target: DeepRecord, source: DeepRecord): DeepRecord {
  const result: DeepRecord = { ...target };
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    const current = result[key];
    if (isRecord(current) && isRecord(value)) {
      result[key] = deepMerge(current, value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function loadYamlFile(path: string): DeepRecord {
  const resolved = resolve(path);
  if (!existsSync(resolved)) return {};
  const raw = readFileSync(resolved, 'utf8');
  const parsed = yaml.load(raw);
  if (parsed == null) return {};
  if (!isRecord(parsed)) {
    throw new ConfigValidationError(`sentinel.yaml at ${resolved} must be a mapping at the top level.`);
  }
  return parsed;
}

function envOverrides(env: NodeJS.ProcessEnv): DeepRecord {
  const runtime: DeepRecord = {};
  if (env.REDIS_URL) runtime.redisUrl = env.REDIS_URL;
  if (env.DATABASE_URL) runtime.databaseUrl = env.DATABASE_URL;
  if (env.SCANNER_IMAGE) runtime.scannerImage = env.SCANNER_IMAGE;
  if (env.DATA_DIR) runtime.dataDir = env.DATA_DIR;

  const result: DeepRecord = {};
  if (Object.keys(runtime).length > 0) result.runtime = runtime;
  if (env.SENTINEL_VERBOSE === '1') result.verbose = true;
  return result;
}

@Injectable()
export class ConfigService {
  private config: SentinelConfig | null = null;

  /**
   * Load and validate a merged config from the given sources.
   *
   * - defaults come from the Zod schema
   * - sources layer on top in order: YAML, then env, then CLI flags
   */
  public load(sources: LoadSources = {}): SentinelConfig {
    const yamlPath = sources.yamlPath ?? './sentinel.yaml';
    const fromYaml = loadYamlFile(yamlPath);
    const fromEnv = envOverrides(sources.env ?? process.env);
    const fromCli = sources.cliFlags ?? {};

    const merged = deepMerge(deepMerge(fromYaml, fromEnv), fromCli);
    this.config = validateConfig(merged);
    return this.config;
  }

  /** Return the most recently loaded config, or throw if `load()` has not been called. */
  public get(): SentinelConfig {
    if (this.config === null) {
      throw new ConfigValidationError('ConfigService.get() called before load().');
    }
    return this.config;
  }

  /** Log-safe string — redacts the bearer token if present. */
  public toString(): string {
    if (this.config === null) return 'ConfigService(<not loaded>)';
    const redacted: SentinelConfig = {
      ...this.config,
      ...(this.config.authentication !== undefined && {
        authentication: {
          ...this.config.authentication,
          token: this.config.authentication.token !== undefined ? '[REDACTED]' : undefined,
        },
      }),
    };
    return `ConfigService(${JSON.stringify(redacted)})`;
  }
}
