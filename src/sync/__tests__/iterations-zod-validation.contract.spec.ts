/**
 * Drift-lock spec for the PhaseRun.iterations Json column (plan 018.5).
 *
 * Invariant: the Zod schema (`PhaseRunIterationHistorySchema`) is the only
 * validated path between the raw `iterations` Json column and the rest of
 * the codebase. Any other src file accessing `prisma.phaseRun.findUnique`
 * or `findFirst` and then reading `.iterations` directly bypasses Zod and
 * exposes the system to malformed data crashes.
 *
 * This spec asserts:
 *   1. `PhaseRunRepository.findIterations` source contains a `safeParse` call
 *      against `PhaseRunIterationHistorySchema` (the canonical read path).
 *   2. No other file under src/ accesses `prisma.phaseRun.*` outside the
 *      repository.
 *   3. The Prisma schema's `iterations` column default is exactly `[]`.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '..', '..', '..');
const SRC_ROOT = join(REPO_ROOT, 'src');
const REPO_SRC = join(SRC_ROOT, 'persistence', 'phase-run.repository.ts');
const SCHEMA_PATH = join(REPO_ROOT, 'prisma', 'schema.prisma');

function walkTs(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walkTs(full, acc);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      acc.push(full);
    }
  }
  return acc;
}

describe('PhaseRun.iterations drift-lock', () => {
  it('PhaseRunRepository.findIterations Zod-validates the column', () => {
    const src = readFileSync(REPO_SRC, 'utf8');
    expect(src).toMatch(/PhaseRunIterationHistorySchema\.safeParse/);
  });

  it('PhaseRunRepository handles parse failure fail-closed (returns [])', () => {
    const src = readFileSync(REPO_SRC, 'utf8');
    expect(src).toMatch(/return \[\];/);
    expect(src).toMatch(/'iterations column failed Zod parse/);
  });

  it('No src file accesses prisma.phaseRun.* outside the repository', () => {
    const offenders: string[] = [];
    for (const file of walkTs(SRC_ROOT)) {
      if (file === REPO_SRC) continue;
      if (file.endsWith('.spec.ts')) continue;
      const content = readFileSync(file, 'utf8');
      if (content.includes('prisma.phaseRun.')) {
        offenders.push(file.replace(REPO_ROOT, ''));
      }
    }
    expect(offenders, `prisma.phaseRun.* must only appear in repository file. Offenders: ${offenders.join(', ')}`).toEqual([]);
  });

  it('Prisma schema column default is [] (catches drift to null)', () => {
    const schema = readFileSync(SCHEMA_PATH, 'utf8');
    expect(schema).toMatch(/iterations\s+Json\s+@default\("\[\]"\)/);
  });

  it('Repository upsertIterations exists and accepts iteration history', () => {
    const src = readFileSync(REPO_SRC, 'utf8');
    expect(src).toMatch(/public async upsertIterations\(/);
    expect(src).toMatch(/UpsertIterationsInput/);
  });
});
