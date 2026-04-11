/**
 * PlanGenerator (Decision 1) — what to scan.
 *
 * Reads a mechanical digest of the target repo (file tree + package.json),
 * queries the agent adapter via the prompt builder, and writes a per-scan
 * BLUEPRINT.md to `workspaces/<scanId>/`. On any failure (timeout, malformed
 * JSON, file system error) → returns a fallback plan that enables every
 * scanner.
 */

import { Injectable } from '@nestjs/common';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createLogger } from '../common/logger.js';
import { parseJson } from '../execution/output-parser.js';
import { buildScanPlanPrompt, type ScanPlanInput } from './governor.prompts.js';
import { SCAN_PLAN_SCHEMA, type ScanPlanDecision } from './types/governor-decision.js';
import type { AgentAdapter } from './agent-adapter.js';

const ALL_SCANNERS = [
  'trivy',
  'semgrep',
  'trufflehog',
  'subfinder',
  'httpx',
  'nuclei',
  'schemathesis',
  'nmap',
] as const;

export interface PlanGeneratorOptions {
  readonly scanId: string;
  readonly workspacesRoot?: string;
}

@Injectable()
export class PlanGenerator {
  private readonly logger = createLogger({ module: 'governor.plan-generator' });

  constructor(private readonly adapter: AgentAdapter) {}

  public async generate(input: ScanPlanInput, options: PlanGeneratorOptions): Promise<ScanPlanDecision> {
    const prompt = buildScanPlanPrompt(input);

    try {
      const response = await this.adapter.query(prompt);
      const cleaned = stripPreamble(response);
      const decision = parseJson(cleaned, SCAN_PLAN_SCHEMA, 'governor.plan-generator');
      this.writeBlueprint(options, decision);
      return decision;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        { scanId: options.scanId, err: message },
        'plan-generator failed — falling back to all-scanners-enabled mechanical plan',
      );
      return this.fallback();
    }
  }

  private writeBlueprint(options: PlanGeneratorOptions, decision: ScanPlanDecision): void {
    try {
      const dir = join(options.workspacesRoot ?? 'workspaces', options.scanId);
      mkdirSync(dir, { recursive: true });
      const path = join(dir, 'BLUEPRINT.md');
      writeFileSync(path, this.renderBlueprintMarkdown(decision), 'utf8');
    } catch (err) {
      this.logger.warn({ err: (err as Error).message }, 'failed to write per-scan BLUEPRINT.md');
    }
  }

  private renderBlueprintMarkdown(decision: ScanPlanDecision): string {
    const enabled = decision.scanPlan.enabledScanners.join(', ');
    const disabled = decision.scanPlan.disabledScanners.join(', ');
    return [
      '# Scan Blueprint',
      '',
      `Rationale: ${decision.scanPlan.rationale}`,
      '',
      `Enabled scanners: ${enabled}`,
      `Disabled scanners: ${disabled}`,
      '',
    ].join('\n');
  }

  private fallback(): ScanPlanDecision {
    return {
      scanPlan: {
        enabledScanners: [...ALL_SCANNERS],
        disabledScanners: [],
        disableReasons: {},
        scannerConfigs: {},
        rationale: 'governor unavailable — mechanical fallback',
      },
    };
  }
}

/**
 * Some CLI implementations emit prefix lines (e.g., a session ID, ANSI codes)
 * before the actual JSON. Strip everything up to the first `{`.
 */
function stripPreamble(raw: string): string {
  const idx = raw.indexOf('{');
  if (idx <= 0) return raw;
  return raw.slice(idx);
}
