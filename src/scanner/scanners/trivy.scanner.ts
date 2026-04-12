/**
 * Trivy scanner — SCA + secret + IaC.
 *
 * Command: `trivy fs --format json --quiet --scanners vuln,secret,misconfig /workspace`
 *
 * Trivy emits `Results: null` on empty repos — the parser treats that as zero findings.
 * Scanner version is pinned in docker/scanner.Dockerfile (Phase K).
 */

import { z } from 'zod';
import { parseJson, ParseError } from '../../execution/output-parser.js';
import { shortHash } from './fingerprint.helper.js';
import {
  BaseScanner,
  type ScanContext,
  type ScannerResult,
} from '../types/scanner.interface.js';
import type { NormalizedFinding, Severity } from '../types/finding.interface.js';
import { runScannerInDocker, withFindings } from './runner.helper.js';

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

  public async execute(context: ScanContext): Promise<ScannerResult> {
    // Trivy returns exit code 0 even when it finds vulnerabilities (without --exit-code flag).
    // Skip dirs that explode the scan time on real-world monorepos AND the
    // editor/agent caches (.claude, .cursor, .agent, .playwright-mcp) where
    // big JSON config files routinely trip Trivy's per-file context deadline.
    // --timeout 15m caps the overall Trivy run so it can never eat the
    // full 30-minute scanner budget.
    const command = [
      'trivy',
      'fs',
      '--format',
      'json',
      '--quiet',
      '--timeout',
      '15m',
      '--scanners',
      'vuln,secret,misconfig',
      '--skip-dirs',
      [
        'node_modules', '**/node_modules',
        '.next', '**/.next',
        'dist', '**/dist',
        'build', '**/build',
        'coverage', '**/coverage',
        '.git',
        '.claude', '**/.claude',
        '.cursor', '**/.cursor',
        '.agent', '**/.agent',
        '.agents', '**/.agents',
        '.cache', '**/.cache',
        '.playwright-mcp', '**/.playwright-mcp',
        '.husky', '**/.husky',
        '.github', '**/.github',
      ].join(','),
      '/workspace',
    ];
    // Trivy needs network to download its vulnerability DB on first run
    // inside the container (~/.cache/trivy/db/). Cannot use network: 'none'.
    const outcome = await runScannerInDocker({
      scanner: this,
      executor: this.executor,
      context,
      command,
    });
    if (!outcome.ok) return outcome.result;

    try {
      const findings = this.parseOutput(outcome.stdout);
      return withFindings(outcome, findings);
    } catch (err) {
      const message = err instanceof ParseError ? err.message : String(err);
      return {
        ...outcome.result,
        success: false,
        error: `parse failure: ${message}`,
      };
    }
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
