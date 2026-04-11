/**
 * Mechanical severity normalization.
 *
 * Rules (applied in order):
 *   1. Shannon exploit confirmed (exploitProof present) → floor at HIGH
 *   2. Semgrep with taint metadata in description → boost one level
 *   3. Nuclei template match without exploit → reduce one level
 *   4. Dependency CVE (Trivy) without reachability info → keep as-is
 *
 * Pure function. Governor (Phase H) overrides in governed mode.
 */

import { SEVERITY_ORDER, type NormalizedFinding, type Severity } from '../scanner/types/finding.interface.js';

const SEVERITY_LIST: readonly Severity[] = ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

function boost(current: Severity, delta: 1 | -1): Severity {
  const currentScore = SEVERITY_ORDER[current];
  const targetScore = Math.max(1, Math.min(5, currentScore + delta));
  const found = SEVERITY_LIST.find((s) => SEVERITY_ORDER[s] === targetScore);
  return found ?? current;
}

function floorAt(current: Severity, floor: Severity): Severity {
  return SEVERITY_ORDER[current] >= SEVERITY_ORDER[floor] ? current : floor;
}

function hasTaintMetadata(finding: NormalizedFinding): boolean {
  const desc = finding.description.toLowerCase();
  return desc.includes('taint') || desc.includes('data flow') || desc.includes('dataflow');
}

export function normalizeSeverity(findings: readonly NormalizedFinding[]): readonly NormalizedFinding[] {
  return findings.map((finding) => {
    let next: Severity = finding.severity;

    if (finding.exploitProof !== undefined && finding.exploitProof.length > 0) {
      next = floorAt(next, 'HIGH');
    }

    if (finding.scanner === 'semgrep' && hasTaintMetadata(finding)) {
      next = boost(next, 1);
    }

    if (finding.scanner === 'nuclei' && (finding.exploitProof === undefined || finding.exploitProof.length === 0)) {
      next = boost(next, -1);
    }

    if (next === finding.severity) return finding;
    return { ...finding, severity: next };
  });
}
