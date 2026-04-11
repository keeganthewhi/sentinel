import { describe, expect, it } from 'vitest';
import { buildProgram } from '../cli.js';

describe('Sentinel CLI program', () => {
  it('registers all 7 subcommands', () => {
    const program = buildProgram();
    const names = program.commands.map((c) => c.name()).sort();
    expect(names).toEqual(['clean', 'diff', 'doctor', 'history', 'report', 'start', 'stop']);
  });

  it('--version emits the package version (0.1.0)', () => {
    const program = buildProgram();
    expect(program.version()).toBe('0.1.0');
  });

  it('start command requires --repo', () => {
    const program = buildProgram();
    const startCmd = program.commands.find((c) => c.name() === 'start');
    expect(startCmd).toBeDefined();
    const repoOption = startCmd?.options.find((o) => o.long === '--repo');
    expect(repoOption).toBeDefined();
    expect(repoOption?.required).toBe(true);
  });

  it('clean command supports --yes flag', () => {
    const program = buildProgram();
    const cleanCmd = program.commands.find((c) => c.name() === 'clean');
    expect(cleanCmd?.options.find((o) => o.long === '--yes')).toBeDefined();
  });

  it('report command requires a scanId argument', () => {
    const program = buildProgram();
    const reportCmd = program.commands.find((c) => c.name() === 'report');
    expect(reportCmd).toBeDefined();
    // <scanId> is registered as a required argument
    const args = reportCmd?.registeredArguments;
    expect(args?.length ?? 0).toBeGreaterThanOrEqual(1);
  });
});
