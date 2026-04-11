import { describe, expect, it } from 'vitest';
import { SubfinderScanner } from './subfinder.scanner.js';

const scanner = new SubfinderScanner();

describe('SubfinderScanner', () => {
  it('parseOutput returns no findings (subfinder enriches context, does not emit findings)', () => {
    const raw = [
      JSON.stringify({ host: 'api.example.com', source: 'crt.sh' }),
      JSON.stringify({ host: 'www.example.com', source: 'virustotal' }),
    ].join('\n');
    expect(scanner.parseOutput(raw)).toEqual([]);
  });

  it('collectSubdomains returns deduplicated host list', () => {
    const raw = [
      JSON.stringify({ host: 'api.example.com', source: 'crt.sh' }),
      JSON.stringify({ host: 'www.example.com', source: 'virustotal' }),
      JSON.stringify({ host: 'api.example.com', source: 'rapiddns' }),
    ].join('\n');
    const hosts = scanner.collectSubdomains(raw);
    expect(hosts).toHaveLength(2);
    expect(hosts).toContain('api.example.com');
    expect(hosts).toContain('www.example.com');
  });

  it('collectSubdomains returns [] on empty input', () => {
    expect(scanner.collectSubdomains('')).toEqual([]);
  });

  it('execute() resolves immediately when targetUrl is undefined', async () => {
    const result = await scanner.execute({
      scanId: 's1',
      targetRepo: '/tmp/repo',
      governed: false,
      scannerTimeoutMs: 1000,
      scannerImage: 'img',
    });
    expect(result.success).toBe(true);
    expect(result.findings).toEqual([]);
  });

  it('name/phase/requiresUrl are correct', () => {
    expect(scanner.name).toBe('subfinder');
    expect(scanner.phase).toBe(1);
    expect(scanner.requiresUrl).toBe(true);
  });
});
