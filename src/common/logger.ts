/**
 * Structured logger for Sentinel (pino-based).
 *
 * Rules (enforced by convention; tests assert the shape):
 * - JSON output in production (`NODE_ENV === 'production'`).
 * - pino-pretty transport in development.
 * - Standard bindings: `scanId`, `scanner`, `phase`, `durationMs`.
 * - Redact sensitive paths: auth tokens, raw scanner output, TruffleHog raw secrets,
 *   governor prompt/response payloads.
 * - NEVER log secret values. Log the fingerprint instead (TruffleHog parser handles this upstream).
 */

import pino, { type Logger, type LoggerOptions } from 'pino';

export interface LoggerBindings {
  scanId?: string;
  scanner?: string;
  phase?: number | string;
  [key: string]: unknown;
}

const REDACTION_PATHS: readonly string[] = [
  'authentication.token',
  '*.authentication.token',
  'config.authentication.token',
  '*.rawOutput',
  'rawOutput',
  '*.evidence.raw',
  'evidence.raw',
  '*.inputJson',
  'inputJson',
  '*.outputJson',
  'outputJson',
  '*.prompt',
  'prompt',
  '*.response',
  'response',
];

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

function buildOptions(bindings: LoggerBindings): LoggerOptions {
  const base: LoggerOptions = {
    level: process.env.LOG_LEVEL ?? (isProduction() ? 'info' : 'debug'),
    base: {
      app: 'sentinel',
      ...bindings,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: [...REDACTION_PATHS],
      censor: '[REDACTED]',
      remove: false,
    },
    formatters: {
      level(label) {
        return { level: label };
      },
    },
  };

  if (!isProduction()) {
    return {
      ...base,
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:HH:MM:ss.l',
          ignore: 'pid,hostname,app',
          singleLine: false,
        },
      },
    };
  }

  return base;
}

/**
 * Create a new logger instance with the given standard bindings.
 * Use this at module boundaries where the caller knows the scan/scanner/phase context.
 */
export function createLogger(bindings: LoggerBindings = {}): Logger {
  return pino(buildOptions(bindings));
}

/** Shared root logger. Use `createLogger({ scanner: 'trivy' })` for child contexts. */
export const rootLogger: Logger = createLogger();
