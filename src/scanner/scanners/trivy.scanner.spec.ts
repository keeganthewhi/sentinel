import { describe, expect, it } from 'vitest';
import { TrivyScanner } from './trivy.scanner.js';

const scanner = new TrivyScanner();

describe('TrivyScanner.parseOutput', () => {
  it('emits a dependency finding for a vulnerability entry', () => {
    const raw = JSON.stringify({
      Results: [
        {
          Target: '/workspace/package-lock.json',
          Class: 'lang-pkgs',
          Type: 'npm',
          Vulnerabilities: [
            {
              VulnerabilityID: 'CVE-2024-12345',
              PkgName: 'lodash',
              InstalledVersion: '4.17.10',
              FixedVersion: '4.17.21',
              Severity: 'HIGH',
              Title: 'Prototype pollution',
              Description: 'CVE details...',
              CweIDs: ['CWE-1321'],
            },
          ],
        },
      ],
    });
    const findings = scanner.parseOutput(raw);
    expect(findings).toHaveLength(1);
    const [finding] = findings;
    expect(finding?.category).toBe('dependency');
    expect(finding?.cveId).toBe('CVE-2024-12345');
    expect(finding?.severity).toBe('HIGH');
    expect(finding?.filePath).toBe('package-lock.json'); // /workspace prefix stripped
    expect(finding?.cweId).toBe('CWE-1321');
    expect(finding?.remediation).toBe('Upgrade to 4.17.21');
  });

  it('emits a secret finding with category=secret', () => {
    const raw = JSON.stringify({
      Results: [
        {
          Target: '/workspace/.env',
          Secrets: [
            {
              RuleID: 'aws-secret-access-key',
              Severity: 'CRITICAL',
              Title: 'AWS Secret Access Key',
              StartLine: 12,
            },
          ],
        },
      ],
    });
    const findings = scanner.parseOutput(raw);
    expect(findings).toHaveLength(1);
    expect(findings[0].category).toBe('secret');
    expect(findings[0].severity).toBe('CRITICAL');
    expect(findings[0].lineNumber).toBe(12);
  });

  it('emits a misconfig finding with category=iac', () => {
    const raw = JSON.stringify({
      Results: [
        {
          Target: '/workspace/Dockerfile',
          Misconfigurations: [
            {
              ID: 'DS001',
              Title: 'Use non-root user',
              Description: 'Running as root',
              Severity: 'MEDIUM',
              Resolution: 'Add USER directive',
            },
          ],
        },
      ],
    });
    const findings = scanner.parseOutput(raw);
    expect(findings).toHaveLength(1);
    expect(findings[0].category).toBe('iac');
    expect(findings[0].remediation).toBe('Add USER directive');
  });

  it('handles "Results": null (empty repo) without error', () => {
    const raw = JSON.stringify({ Results: null });
    expect(scanner.parseOutput(raw)).toEqual([]);
  });

  it('handles empty string input', () => {
    expect(scanner.parseOutput('')).toEqual([]);
  });

  it('maps UNKNOWN severity to INFO', () => {
    const raw = JSON.stringify({
      Results: [
        {
          Target: '/workspace/pkg',
          Vulnerabilities: [
            { VulnerabilityID: 'CVE-x', Severity: 'UNKNOWN', PkgName: 'p' },
          ],
        },
      ],
    });
    const findings = scanner.parseOutput(raw);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('INFO');
  });

  it('name/phase/requiresUrl are correct', () => {
    expect(scanner.name).toBe('trivy');
    expect(scanner.phase).toBe(1);
    expect(scanner.requiresUrl).toBe(false);
  });
});
