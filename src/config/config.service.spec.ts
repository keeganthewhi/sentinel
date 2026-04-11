import { describe, expect, it } from 'vitest';
import { ConfigService } from './config.service.js';
import { ConfigValidationError } from '../common/errors.js';

describe('ConfigService', () => {
  it('loads a valid config from CLI flags only', () => {
    const svc = new ConfigService();
    const cfg = svc.load({
      cliFlags: { target: { repo: '/tmp/test-repo' } },
      env: {},
    });
    expect(cfg.target.repo).toBe('/tmp/test-repo');
    expect(cfg.runtime.redisUrl).toBe('redis://localhost:6379');
  });

  it('applies environment overrides in runtime section', () => {
    const svc = new ConfigService();
    const cfg = svc.load({
      cliFlags: { target: { repo: '/tmp/test' } },
      env: {
        REDIS_URL: 'redis://custom-host:6380',
        DATABASE_URL: 'postgres://user:pass@host/db',
        SCANNER_IMAGE: 'custom-scanner:v1',
        DATA_DIR: '/var/sentinel',
      },
    });
    expect(cfg.runtime.redisUrl).toBe('redis://custom-host:6380');
    expect(cfg.runtime.databaseUrl).toBe('postgres://user:pass@host/db');
    expect(cfg.runtime.scannerImage).toBe('custom-scanner:v1');
    expect(cfg.runtime.dataDir).toBe('/var/sentinel');
  });

  it('CLI flags override environment variables', () => {
    const svc = new ConfigService();
    const cfg = svc.load({
      cliFlags: {
        target: { repo: '/tmp/test' },
        runtime: { redisUrl: 'redis://cli-wins:6379' },
      },
      env: { REDIS_URL: 'redis://env-loses:6379' },
    });
    expect(cfg.runtime.redisUrl).toBe('redis://cli-wins:6379');
  });

  it('throws when get() is called before load()', () => {
    const svc = new ConfigService();
    expect(() => svc.get()).toThrow(ConfigValidationError);
  });

  it('toString() redacts authentication.token', () => {
    const svc = new ConfigService();
    svc.load({
      cliFlags: {
        target: { repo: '/tmp/test' },
        authentication: { type: 'bearer', token: 'super-secret-do-not-log' },
      },
      env: {},
    });
    const str = svc.toString();
    expect(str).not.toContain('super-secret-do-not-log');
    expect(str).toContain('[REDACTED]');
  });

  it('toString() before load() does not throw', () => {
    const svc = new ConfigService();
    expect(svc.toString()).toBe('ConfigService(<not loaded>)');
  });
});
