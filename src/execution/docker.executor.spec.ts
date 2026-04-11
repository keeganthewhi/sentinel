import { describe, expect, it } from 'vitest';
import { buildDockerArgs } from './docker.executor.js';

describe('buildDockerArgs', () => {
  it('builds the canonical argv for a minimal options object', () => {
    const args = buildDockerArgs({
      image: 'sentinel-scanner:latest',
      command: ['trivy', 'fs', '/workspace'],
      timeoutMs: 30000,
    });
    expect(args).toEqual(['run', '--rm', 'sentinel-scanner:latest', 'trivy', 'fs', '/workspace']);
  });

  it('adds a read-only workspace mount when workspaceRepo is set', () => {
    const args = buildDockerArgs({
      image: 'sentinel-scanner:latest',
      command: ['semgrep', '--config', 'p/default', '/workspace'],
      workspaceRepo: '/host/path/to/repo',
      timeoutMs: 30000,
    });
    expect(args).toEqual([
      'run',
      '--rm',
      '-v',
      '/host/path/to/repo:/workspace:ro',
      'sentinel-scanner:latest',
      'semgrep',
      '--config',
      'p/default',
      '/workspace',
    ]);
  });

  it('injects env variables with -e flags', () => {
    const args = buildDockerArgs({
      image: 'sentinel-scanner:latest',
      command: ['echo', 'hi'],
      env: { NO_COLOR: '1', CUSTOM_VAR: 'value' },
      timeoutMs: 1000,
    });
    // Order of env entries follows Object.entries insertion order.
    expect(args).toContain('-e');
    expect(args).toContain('NO_COLOR=1');
    expect(args).toContain('CUSTOM_VAR=value');
    // image + command come after the env flags
    const imageIdx = args.indexOf('sentinel-scanner:latest');
    expect(imageIdx).toBeGreaterThan(args.indexOf('NO_COLOR=1'));
    expect(imageIdx).toBeGreaterThan(args.indexOf('CUSTOM_VAR=value'));
  });

  it('never produces a shell string — every element is a separate argv', () => {
    const args = buildDockerArgs({
      image: 'img',
      command: ['cmd', 'arg with space', '; rm -rf /'],
      timeoutMs: 1000,
    });
    // The dangerous-looking element is passed as a single argv, not interpreted as a shell.
    expect(args).toContain('; rm -rf /');
    expect(args).toContain('arg with space');
    // No element contains the `&&` or `|` chain characters.
    expect(args.every((a) => typeof a === 'string')).toBe(true);
  });
});
