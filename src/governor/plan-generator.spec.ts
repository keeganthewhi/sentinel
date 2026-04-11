import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PlanGenerator } from './plan-generator.js';
import type { AgentAdapter } from './agent-adapter.js';
import { GovernorTimeoutError } from '../common/errors.js';

function mockAdapter(response: string): AgentAdapter {
  return {
    name: 'claude',
    query: vi.fn().mockResolvedValue(response),
  };
}

function failingAdapter(err: Error): AgentAdapter {
  return {
    name: 'claude',
    query: vi.fn().mockRejectedValue(err),
  };
}

function withTempWorkspace<T>(fn: (root: string) => T | Promise<T>): T | Promise<T> {
  const root = mkdtempSync(join(tmpdir(), 'sentinel-workspaces-'));
  try {
    const result = fn(root);
    if (result instanceof Promise) {
      return result.finally(() => {
        rmSync(root, { recursive: true, force: true });
      });
    }
    rmSync(root, { recursive: true, force: true });
    return result;
  } catch (err) {
    rmSync(root, { recursive: true, force: true });
    throw err;
  }
}

const goodResponse = JSON.stringify({
  scanPlan: {
    enabledScanners: ['trivy', 'semgrep'],
    disabledScanners: ['nmap'],
    disableReasons: { nmap: 'no URL provided' },
    scannerConfigs: { semgrep: { config: 'p/typescript' } },
    rationale: 'TypeScript repo without exposed services',
  },
});

describe('PlanGenerator', () => {
  it('parses a valid response and writes BLUEPRINT.md to the per-scan workspace', async () => {
    await withTempWorkspace(async (root) => {
      const generator = new PlanGenerator(mockAdapter(goodResponse));
      const decision = await generator.generate(
        { fileTreeDigest: ['package.json'], targetRepo: '/tmp/repo' },
        { scanId: 'scan-x', workspacesRoot: root },
      );
      expect(decision.scanPlan.enabledScanners).toEqual(['trivy', 'semgrep']);
      expect(decision.scanPlan.disabledScanners).toEqual(['nmap']);
      const blueprintPath = join(root, 'scan-x', 'BLUEPRINT.md');
      expect(existsSync(blueprintPath)).toBe(true);
      const content = readFileSync(blueprintPath, 'utf8');
      expect(content).toContain('Scan Blueprint');
      expect(content).toContain('trivy, semgrep');
    });
  });

  it('falls back to all-scanners-enabled when the adapter throws', async () => {
    await withTempWorkspace(async (root) => {
      const generator = new PlanGenerator(failingAdapter(new GovernorTimeoutError('timeout')));
      const decision = await generator.generate(
        { fileTreeDigest: [], targetRepo: '/tmp/repo' },
        { scanId: 'scan-y', workspacesRoot: root },
      );
      expect(decision.scanPlan.enabledScanners).toContain('trivy');
      expect(decision.scanPlan.enabledScanners).toContain('nuclei');
      expect(decision.scanPlan.rationale).toContain('mechanical fallback');
      // No blueprint written because the response didn't validate.
      expect(existsSync(join(root, 'scan-y', 'BLUEPRINT.md'))).toBe(false);
    });
  });

  it('falls back when the response is malformed JSON', async () => {
    await withTempWorkspace(async (root) => {
      const generator = new PlanGenerator(mockAdapter('this is not json'));
      const decision = await generator.generate(
        { fileTreeDigest: [], targetRepo: '/tmp/repo' },
        { scanId: 'scan-z', workspacesRoot: root },
      );
      expect(decision.scanPlan.enabledScanners.length).toBeGreaterThan(0);
      expect(decision.scanPlan.rationale).toContain('mechanical fallback');
    });
  });

  it('strips a CLI preamble that appears before the JSON object', async () => {
    await withTempWorkspace(async (root) => {
      const adapter = mockAdapter(`session: abc123\nReady\n${goodResponse}`);
      const generator = new PlanGenerator(adapter);
      const decision = await generator.generate(
        { fileTreeDigest: [], targetRepo: '/tmp/repo' },
        { scanId: 'scan-pre', workspacesRoot: root },
      );
      expect(decision.scanPlan.enabledScanners).toEqual(['trivy', 'semgrep']);
    });
  });
});
