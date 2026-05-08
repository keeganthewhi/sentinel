/**
 * Drift-lock spec for the per-tool strategist iteration loop (plan 018).
 *
 * Asserts structural invariants of the loop source. These properties must
 * hold across refactors; if any of them break, this spec catches the drift
 * before the change lands.
 *
 * Asserts:
 *   - MAX_STRATEGIST_ITERATIONS exported and set to exactly 3 (defense-in-depth
 *     against a future tweak that loosens the budget).
 *   - The loop catches StrategistFailureError on both strategize and replay.
 *   - The loop logs a "mechanical" fallback note on strategize failure.
 *   - File writes use mode 0o600 (sensitive-fields rule from CLAUDE.md).
 *   - The loop's source NEVER imports `node:child_process` or spawns a scanner
 *     subprocess directly (must go through the IPipelineRunner).
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const LOOP_SRC = readFileSync(
  join(__dirname, '..', '..', 'pipeline', 'phases', 'scanner-iteration-loop.ts'),
  'utf8',
);

describe('strategist iteration loop drift-lock (plan 018)', () => {
  it('exports MAX_STRATEGIST_ITERATIONS = 3', async () => {
    const mod = await import('../../pipeline/phases/scanner-iteration-loop.js');
    expect(mod.MAX_STRATEGIST_ITERATIONS).toBe(3);
  });

  it('hard-cap is enforced by the loop body, not just by the strategist', () => {
    expect(LOOP_SRC).toMatch(/i\s*<\s*MAX_STRATEGIST_ITERATIONS/);
  });

  it('catches StrategistFailureError on strategize', () => {
    const re = /strategist\.strategize\([\s\S]*?catch[\s\S]*?StrategistFailureError/;
    expect(re.exec(LOOP_SRC)).not.toBeNull();
  });

  it('catches StrategistFailureError on replay', () => {
    const re = /strategist\.replay\([\s\S]*?catch[\s\S]*?StrategistFailureError/;
    expect(re.exec(LOOP_SRC)).not.toBeNull();
  });

  it('strategize failure path falls back to a mechanical run', () => {
    expect(LOOP_SRC).toMatch(/strategize.*fall.*back.*mechanical/i);
  });

  it('writes files with mode 0o600', () => {
    expect(LOOP_SRC).toContain('mode: 0o600');
  });

  it('writes directories with mode 0o700', () => {
    expect(LOOP_SRC).toContain('mode: 0o700');
  });

  it('does not spawn scanner subprocesses directly (must use runner)', () => {
    expect(LOOP_SRC).not.toMatch(/from 'node:child_process'/);
    expect(LOOP_SRC).not.toMatch(/from "node:child_process"/);
    expect(LOOP_SRC).not.toMatch(/spawn\s*\(/);
    expect(LOOP_SRC).not.toMatch(/spawnSync\s*\(/);
  });

  it('source mentions IPipelineRunner so calls go through the abstraction', () => {
    expect(LOOP_SRC).toContain('IPipelineRunner');
  });
});
