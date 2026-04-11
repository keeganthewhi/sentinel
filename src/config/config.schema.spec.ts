import { describe, expect, it } from 'vitest';
import { validateConfig } from './config.schema.js';
import { ConfigValidationError } from '../common/errors.js';

describe('validateConfig', () => {
  it('accepts a minimal valid config and fills defaults', () => {
    const result = validateConfig({ target: { repo: '/tmp/test-repo' } });
    expect(result.target.repo).toBe('/tmp/test-repo');
    expect(result.mode.governed).toBe(false);
    expect(result.mode.shannon).toBe(false);
    expect(result.timeouts.scannerMs).toBe(30 * 60 * 1000);
    expect(result.timeouts.governorMs).toBe(5 * 60 * 1000);
    expect(result.runtime.redisUrl).toBe('redis://localhost:6379');
    expect(result.runtime.databaseUrl).toBe('file:./data/sentinel.db');
    expect(result.runtime.scannerImage).toBe('sentinel-scanner:latest');
    expect(result.runtime.dataDir).toBe('./data');
    expect(result.verbose).toBe(false);
  });

  it('rejects missing target.repo', () => {
    expect(() => validateConfig({ target: {} })).toThrow(ConfigValidationError);
  });

  it('rejects empty target.repo', () => {
    expect(() => validateConfig({ target: { repo: '' } })).toThrow(ConfigValidationError);
  });

  it('rejects a non-URL target.url', () => {
    expect(() =>
      validateConfig({ target: { repo: '/tmp/test', url: 'not-a-url' } }),
    ).toThrow(ConfigValidationError);
  });

  it('accepts a valid target.url', () => {
    const result = validateConfig({
      target: { repo: '/tmp/test', url: 'https://staging.example.com' },
    });
    expect(result.target.url).toBe('https://staging.example.com');
  });

  it('accepts governed mode with phases override', () => {
    const result = validateConfig({
      target: { repo: '/tmp/test' },
      mode: { governed: true, shannon: true, phases: [1, 2] },
    });
    expect(result.mode.governed).toBe(true);
    expect(result.mode.shannon).toBe(true);
    expect(result.mode.phases).toEqual([1, 2]);
  });

  it('rejects a phases entry outside 1..3', () => {
    expect(() =>
      validateConfig({ target: { repo: '/tmp/test' }, mode: { phases: [0] } }),
    ).toThrow(ConfigValidationError);
    expect(() =>
      validateConfig({ target: { repo: '/tmp/test' }, mode: { phases: [4] } }),
    ).toThrow(ConfigValidationError);
  });

  it('accepts optional authentication with bearer token', () => {
    const result = validateConfig({
      target: { repo: '/tmp/test' },
      authentication: { type: 'bearer', token: 'super-secret-value' },
    });
    expect(result.authentication?.type).toBe('bearer');
    expect(result.authentication?.token).toBe('super-secret-value');
  });

  it('rejects an unknown authentication type', () => {
    expect(() =>
      validateConfig({
        target: { repo: '/tmp/test' },
        authentication: { type: 'oauth' },
      }),
    ).toThrow(ConfigValidationError);
  });

  it('rejects non-positive timeout values', () => {
    expect(() =>
      validateConfig({ target: { repo: '/tmp/test' }, timeouts: { scannerMs: 0 } }),
    ).toThrow(ConfigValidationError);
    expect(() =>
      validateConfig({ target: { repo: '/tmp/test' }, timeouts: { governorMs: -1 } }),
    ).toThrow(ConfigValidationError);
  });

  it('includes the failing path in the error message', () => {
    try {
      validateConfig({ target: { repo: '/tmp/test', url: 'bad' } });
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigValidationError);
      expect((err as ConfigValidationError).message).toContain('target.url');
    }
  });
});
