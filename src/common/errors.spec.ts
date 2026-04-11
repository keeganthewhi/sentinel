import { describe, expect, it } from 'vitest';
import {
  ConfigValidationError,
  DockerNotRunningError,
  GovernorInvalidResponseError,
  GovernorTimeoutError,
  ScannerCrashError,
  ScannerNotAvailableError,
  ScannerTimeoutError,
  SentinelError,
} from './errors.js';

describe('SentinelError hierarchy', () => {
  const cases = [
    { klass: ScannerNotAvailableError, code: 'SCANNER_NOT_AVAILABLE' },
    { klass: ScannerTimeoutError, code: 'SCANNER_TIMEOUT' },
    { klass: ScannerCrashError, code: 'SCANNER_CRASH' },
    { klass: GovernorTimeoutError, code: 'GOVERNOR_TIMEOUT' },
    { klass: GovernorInvalidResponseError, code: 'GOVERNOR_INVALID_RESPONSE' },
    { klass: ConfigValidationError, code: 'CONFIG_VALIDATION' },
    { klass: DockerNotRunningError, code: 'DOCKER_NOT_RUNNING' },
  ] as const;

  it('every subclass sets its fixed code', () => {
    for (const { klass, code } of cases) {
      const instance = new klass('test message');
      expect(instance.code).toBe(code);
    }
  });

  it('every subclass is an instanceof SentinelError and Error', () => {
    for (const { klass } of cases) {
      const instance = new klass('test message');
      expect(instance).toBeInstanceOf(SentinelError);
      expect(instance).toBeInstanceOf(Error);
    }
  });

  it('every subclass exposes its own class name', () => {
    for (const { klass } of cases) {
      const instance = new klass('test message');
      expect(instance.name).toBe(klass.name);
    }
  });

  it('every subclass provides a remediation hint', () => {
    for (const { klass } of cases) {
      const instance = new klass('test message');
      expect(instance.remediation).toBeTruthy();
      expect(instance.remediation.length).toBeGreaterThan(10);
    }
  });

  it('toJSON() matches the CLAUDE.md error contract shape', () => {
    const err = new ScannerCrashError('trivy crashed with exit 2', {
      scanner: 'trivy',
      scanId: 'test-scan-id',
      phase: 1,
      exitCode: 2,
    });
    const json = err.toJSON();
    expect(json).toEqual({
      error: 'ScannerCrashError',
      code: 'SCANNER_CRASH',
      message: 'trivy crashed with exit 2',
      remediation: expect.stringContaining('stderr') as unknown,
      scanner: 'trivy',
      scanId: 'test-scan-id',
      phase: 1,
      exitCode: 2,
    });
  });

  it('toJSON() omits undefined context fields', () => {
    const err = new GovernorTimeoutError('exceeded 5m timeout');
    const json = err.toJSON();
    expect(json.error).toBe('GovernorTimeoutError');
    expect(json.code).toBe('GOVERNOR_TIMEOUT');
    expect(json).not.toHaveProperty('scanner');
    expect(json).not.toHaveProperty('scanId');
    expect(json).not.toHaveProperty('phase');
  });
});
