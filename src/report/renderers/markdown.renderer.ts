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
import type { Verdict } from '../../correlation/verdict.service.js';

export interface ReportInput {
  readonly scanId: string;
  readonly findings: readonly NormalizedFinding[];
  readonly durationMs: number;
  readonly targetRepo: string;
  readonly targetUrl?: string;
  /** Plan 020 — boolean PASS / FAIL verdict surfaced at the top of the report. */
  readonly verdict?: Verdict;
  /**
   * Plan 019 — per-tool AI strategist narrate output, keyed by scanner name.
   * Each value is the markdown body produced by `BaseStrategist.narrate()` for
   * that scanner (read from `workspaces/<scanId>/per-tool/<scanner>/narrate.md`).
   * Absent / empty → no per-tool section in the report.
   */
  readonly perToolReports?: Readonly<Record<string, string>>;
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

/**
 * Render the per-tool AI report section. Each scanner's narrate output goes
 * inside a `<details>` block so the final SENTINEL_REPORT.md stays scannable
 * for operators while the prose remains one click away.
 *
 * Returns an empty array when the input has no non-empty entries, so callers
 * can safely concatenate without producing dangling headings.
 */
function renderPerToolReports(reports: Readonly<Record<string, string>>): string[] {
  const entries = Object.entries(reports)
    .filter(([, body]) => body.trim().length > 0)
    .sort(([a], [b]) => a.localeCompare(b));
  if (entries.length === 0) return [];

  const out: string[] = ['## Per-Tool AI Reports', ''];
  for (const [scanner, body] of entries) {
    out.push(`<details>`);
    out.push(`<summary><strong>${escapeMarkdown(scanner)}</strong></summary>`);
    out.push('');
    out.push(body.trim());
    out.push('');
    out.push(`</details>`);
    out.push('');
  }
  return out;
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
    if (input.verdict !== undefined) {
      // Plan 020 — boolean verdict heading at the top of the report.
      const badge = input.verdict.result === 'PASS' ? 'PASS' : 'FAIL';
      lines.push(
        input.verdict.result === 'PASS'
          ? `## Verdict: ${badge}`
          : `## Verdict: ${badge} — ${input.verdict.findingCount} finding(s) require attention`,
      );
      lines.push('');
    }
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
      // Plan 019 — even with zero findings the per-tool narrate may carry
      // value (a strategist explaining what was tried + why nothing fired).
      // Render it after the summary, then return.
      if (input.perToolReports !== undefined) {
        const perToolBlock = renderPerToolReports(input.perToolReports);
        if (perToolBlock.length > 0) {
          lines.push(...perToolBlock);
        }
      }
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

    if (input.perToolReports !== undefined) {
      const perToolBlock = renderPerToolReports(input.perToolReports);
      if (perToolBlock.length > 0) {
        lines.push(...perToolBlock);
      }
    }

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
