/**
 * Trivy scanner — SCA + secret + IaC.
 *
 * Command: `trivy fs --format json --quiet --scanners vuln,secret,misconfig /workspace`
 *
 * Trivy emits `Results: null` on empty repos — the parser treats that as zero findings.
 * Scanner version is pinned in docker/scanner.Dockerfile (Phase K).
 */

import { z } from 'zod';
import { parseJson } from '../../execution/output-parser.js';
import { shortHash } from './fingerprint.helper.js';
import {
  BaseScanner,
  type ScanContext,
  type ScannerResult,
} from '../types/scanner.interface.js';
import type { NormalizedFinding, Severity } from '../types/finding.interface.js';

const SEVERITY_MAP: Readonly<Record<string, Severity>> = Object.freeze({
  UNKNOWN: 'INFO',
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL',
});

function normalizeSeverity(raw: string | undefined): Severity {
  if (raw === undefined) return 'INFO';
  return SEVERITY_MAP[raw.toUpperCase()] ?? 'INFO';
}

const VulnerabilitySchema = z
  .object({
    VulnerabilityID: z.string().optional(),
    PkgName: z.string().optional(),
    InstalledVersion: z.string().optional(),
    FixedVersion: z.string().optional(),
    Severity: z.string().optional(),
    Title: z.string().optional(),
    Description: z.string().optional(),
    PrimaryURL: z.string().optional(),
    CweIDs: z.array(z.string()).optional(),
  })
  .passthrough();

const SecretSchema = z
  .object({
    RuleID: z.string().optional(),
    Category: z.string().optional(),
    Severity: z.string().optional(),
    Title: z.string().optional(),
    StartLine: z.number().int().optional(),
    EndLine: z.number().int().optional(),
    Match: z.string().optional(),
  })
  .passthrough();

const MisconfigSchema = z
  .object({
    ID: z.string().optional(),
    Type: z.string().optional(),
    Title: z.string().optional(),
    Description: z.string().optional(),
    Severity: z.string().optional(),
    Resolution: z.string().optional(),
    References: z.array(z.string()).optional(),
  })
  .passthrough();

const ResultSchema = z
  .object({
    Target: z.string().optional(),
    Class: z.string().optional(),
    Type: z.string().optional(),
    Vulnerabilities: z.array(VulnerabilitySchema).nullable().optional(),
    Secrets: z.array(SecretSchema).nullable().optional(),
    Misconfigurations: z.array(MisconfigSchema).nullable().optional(),
  })
  .passthrough();

const TrivyOutputSchema = z
  .object({
    Results: z.array(ResultSchema).nullable().optional(),
  })
  .passthrough();

function stripWorkspacePrefix(path: string | undefined): string | undefined {
  if (path === undefined) return undefined;
  return path.replace(/^\/workspace\//, '').replace(/^workspace\//, '');
}

export class TrivyScanner extends BaseScanner {
  public readonly name = 'trivy';
  public readonly phase = 1 as const;
  public readonly requiresUrl = false;

  public async execute(_context: ScanContext): Promise<ScannerResult> {
    // Real subprocess invocation is wired via DockerExecutor in Phase E (scanner worker).
    // For now, returning a stub result keeps the module graph buildable; Phase E
    // replaces this body with a real DockerExecutor.run(...) call.
    return Promise.resolve({
      scanner: this.name,
      findings: [],
      rawOutput: '',
      executionTimeMs: 0,
      success: true,
    });
  }

  public parseOutput(raw: string): readonly NormalizedFinding[] {
    if (raw.trim() === '') return [];
    const data = parseJson(raw, TrivyOutputSchema, this.name);
    const results = data.Results ?? [];
    const findings: NormalizedFinding[] = [];

    for (const result of results) {
      const target = stripWorkspacePrefix(result.Target);

      for (const vuln of result.Vulnerabilities ?? []) {
        const title = vuln.Title ?? vuln.VulnerabilityID ?? 'Trivy vulnerability';
        const description = vuln.Description ?? `Package ${vuln.PkgName ?? '?'} ${vuln.InstalledVersion ?? '?'}`;
        findings.push({
          scanner: this.name,
          fingerprint: shortHash(`trivy:${vuln.VulnerabilityID ?? title}:${target ?? ''}`),
          title,
          description,
          severity: normalizeSeverity(vuln.Severity),
          category: 'dependency',
          normalizedScore: 0,
          cveId: vuln.VulnerabilityID,
          cweId: vuln.CweIDs?.[0],
          filePath: target,
          remediation: vuln.FixedVersion !== undefined ? `Upgrade to ${vuln.FixedVersion}` : undefined,
        });
      }

      for (const secret of result.Secrets ?? []) {
        const title = secret.Title ?? secret.RuleID ?? 'Trivy secret';
        findings.push({
          scanner: this.name,
          fingerprint: shortHash(`trivy:secret:${secret.RuleID ?? title}:${target ?? ''}:${secret.StartLine ?? ''}`),
          title,
          description: `Secret detected by Trivy rule ${secret.RuleID ?? 'unknown'}`,
          severity: normalizeSeverity(secret.Severity),
          category: 'secret',
          normalizedScore: 0,
          filePath: target,
          lineNumber: secret.StartLine,
        });
      }

      for (const mis of result.Misconfigurations ?? []) {
        const title = mis.Title ?? mis.ID ?? 'Trivy misconfiguration';
        findings.push({
          scanner: this.name,
          fingerprint: shortHash(`trivy:misconfig:${mis.ID ?? title}:${target ?? ''}`),
          title,
          description: mis.Description ?? 'Configuration issue',
          severity: normalizeSeverity(mis.Severity),
          category: 'iac',
          normalizedScore: 0,
          filePath: target,
          remediation: mis.Resolution,
        });
      }
    }

    return findings;
  }

  public isAvailable(): Promise<boolean> {
    // Real probe runs `trivy --version` inside the scanner image; stubbed until Phase K wires DockerExecutor.
    return Promise.resolve(true);
  }
}
