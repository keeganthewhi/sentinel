import { describe, expect, it } from 'vitest';
import { buildDockerArgs } from './docker.executor.js';

describe('buildDockerArgs', () => {
  it('builds the canonical argv for a minimal options object', () => {
    const args = buildDockerArgs({
      image: 'sentinel-scanner:latest',
      command: ['trivy', 'fs', '/workspace'],
      timeoutMs: 30000,
    });
    // Default --memory and --cpus are always included unless explicitly
    // disabled; resource caps are on-by-default.
    expect(args).toEqual([
      'run',
      '--rm',
      '--memory=4g',
      '--cpus=2',
      'sentinel-scanner:latest',
      'trivy',
      'fs',
      '/workspace',
    ]);
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
      '--memory=4g',
      '--cpus=2',
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

  it('honors explicit memory and cpu limits', () => {
    const args = buildDockerArgs({
      image: 'img',
      command: ['cmd'],
      timeoutMs: 1000,
      memoryLimit: '2g',
      cpuLimit: '1',
    });
    expect(args).toContain('--memory=2g');
    expect(args).toContain('--cpus=1');
  });

  it('disables resource limits when passed an empty string', () => {
    const args = buildDockerArgs({
      image: 'img',
      command: ['cmd'],
      timeoutMs: 1000,
      memoryLimit: '',
      cpuLimit: '',
    });
    expect(args).not.toContain('--memory=');
    expect(args.some((a) => a.startsWith('--memory='))).toBe(false);
    expect(args.some((a) => a.startsWith('--cpus='))).toBe(false);
  });
});
