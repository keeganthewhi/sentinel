import { describe, expect, it } from 'vitest';
import { HttpxScanner } from './httpx.scanner.js';

const scanner = new HttpxScanner();

describe('HttpxScanner', () => {
  it('parseOutput returns no findings (httpx enriches context, does not emit findings)', () => {
    const raw = JSON.stringify({ url: 'https://a.example.com', status_code: 200 });
    expect(scanner.parseOutput(raw)).toEqual([]);
  });

  it('collectEndpoints extracts url + statusCode + technologies', () => {
    const raw = [
      JSON.stringify({
        url: 'https://a.example.com',
        status_code: 200,
        tech: ['nginx', 'Node.js'],
        title: 'Home',
      }),
      JSON.stringify({
        url: 'https://b.example.com',
        status_code: 404,
      }),
    ].join('\n');
    const endpoints = scanner.collectEndpoints(raw);
    expect(endpoints).toHaveLength(2);
    expect(endpoints[0]).toEqual({
      url: 'https://a.example.com',
      statusCode: 200,
      technologies: ['nginx', 'Node.js'],
    });
    expect(endpoints[1]).toEqual({
      url: 'https://b.example.com',
      statusCode: 404,
      technologies: [],
    });
  });

  it('collectEndpoints returns [] on empty input', () => {
    expect(scanner.collectEndpoints('')).toEqual([]);
  });

  it('execute() resolves success when targetUrl and discoveredSubdomains both missing', async () => {
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
    expect(scanner.name).toBe('httpx');
    expect(scanner.phase).toBe(1);
    expect(scanner.requiresUrl).toBe(true);
  });
});
