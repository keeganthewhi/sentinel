/**
 * Markdown report renderer.
 *
 * Produces a GitHub-flavored markdown report with:
 *   - Executive summary (counts by severity)
 *   - Findings grouped by category
 *   - Per-finding block with file:line, evidence (already redacted), remediation
 *
 * No user-controlled HTML is emitted. Scanner strings are included as code
 * spans where appropriate.
 */

import { Injectable } from '@nestjs/common';
import type { NormalizedFinding, Severity, FindingCategory } from '../../scanner/types/finding.interface.js';

export interface ReportInput {
  readonly scanId: string;
  readonly findings: readonly NormalizedFinding[];
  readonly durationMs: number;
  readonly targetRepo: string;
  readonly targetUrl?: string;
}

const SEVERITIES: readonly Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];

const CATEGORY_ORDER: readonly FindingCategory[] = [
  'dependency',
  'secret',
  'sast',
  'iac',
  'misconfig',
  'dast',
  'api',
  'network',
  'other',
];

function escapeMarkdown(input: string): string {
  return input
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/`/g, '\\`')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function severityBadge(severity: Severity): string {
  return `**\`${severity}\`**`;
}

function countBySeverity(findings: readonly NormalizedFinding[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 };
  for (const f of findings) counts[f.severity]++;
  return counts;
}

function groupByCategory(
  findings: readonly NormalizedFinding[],
): Map<FindingCategory, NormalizedFinding[]> {
  const groups = new Map<FindingCategory, NormalizedFinding[]>();
  for (const finding of findings) {
    const existing = groups.get(finding.category);
    if (existing === undefined) {
      groups.set(finding.category, [finding]);
    } else {
      existing.push(finding);
    }
  }
  return groups;
}

@Injectable()
export class MarkdownRenderer {
  public render(input: ReportInput): string {
    const lines: string[] = [];
    lines.push(`# Sentinel Scan Report`);
    lines.push('');
    lines.push(`- **Scan ID**: \`${input.scanId}\``);
    lines.push(`- **Target repo**: \`${escapeMarkdown(input.targetRepo)}\``);
    if (input.targetUrl !== undefined) {
      lines.push(`- **Target URL**: \`${escapeMarkdown(input.targetUrl)}\``);
    }
    lines.push(`- **Duration**: ${input.durationMs} ms`);
    lines.push('');

    lines.push('## Summary');
    lines.push('');
    if (input.findings.length === 0) {
      lines.push('_No findings._');
      lines.push('');
      return lines.join('\n');
    }

    const counts = countBySeverity(input.findings);
    lines.push('| Severity | Count |');
    lines.push('|----------|-------|');
    for (const severity of SEVERITIES) {
      lines.push(`| ${severity} | ${counts[severity]} |`);
    }
    lines.push(`| **Total** | **${input.findings.length}** |`);
    lines.push('');

    lines.push('## Findings');
    lines.push('');

    const groups = groupByCategory(input.findings);
    for (const category of CATEGORY_ORDER) {
      const entries = groups.get(category);
      if (entries === undefined || entries.length === 0) continue;
      lines.push(`### ${category} (${entries.length})`);
      lines.push('');
      for (const finding of entries) {
        lines.push(`#### ${severityBadge(finding.severity)} ${escapeMarkdown(finding.title)}`);
        lines.push('');
        lines.push(`- **Scanner**: \`${finding.scanner}\``);
        if (finding.cveId !== undefined) lines.push(`- **CVE**: \`${finding.cveId}\``);
        if (finding.cweId !== undefined) lines.push(`- **CWE**: \`${finding.cweId}\``);
        if (finding.filePath !== undefined) {
          const location = finding.lineNumber !== undefined
            ? `${finding.filePath}:${finding.lineNumber}`
            : finding.filePath;
          lines.push(`- **Location**: \`${escapeMarkdown(location)}\``);
        }
        if (finding.endpoint !== undefined) {
          lines.push(`- **Endpoint**: \`${escapeMarkdown(finding.endpoint)}\``);
        }
        if (finding.evidence !== undefined) {
          lines.push(`- **Evidence**: \`${escapeMarkdown(finding.evidence)}\``);
        }
        if (finding.remediation !== undefined) {
          lines.push(`- **Remediation**: ${escapeMarkdown(finding.remediation)}`);
        }
        lines.push('');
        if (finding.description.length > 0) {
          lines.push(escapeMarkdown(finding.description));
          lines.push('');
        }
      }
    }

    return lines.join('\n');
  }
}
