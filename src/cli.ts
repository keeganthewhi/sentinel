#!/usr/bin/env node
/**
 * Sentinel CLI entry (Commander).
 *
 * Subcommands: start, history, report, diff, doctor, stop, clean.
 *
 * Each command is a thin function in `src/cli/commands/*.ts`. Heavy
 * dependencies (NestJS context, Prisma client) are constructed lazily inside
 * the command actions so `--help` and `--version` stay fast.
 *
 * Exit codes (per CLAUDE.md):
 *   0 success
 *   1 scan failed with findings
 *   2 prerequisite missing (doctor check failed)
 *   3 invalid arguments
 *   4 governor failed irrecoverably in governed mode
 */

import 'reflect-metadata';
import { Command } from 'commander';
import { rootLogger } from './common/logger.js';
import { doctorCommand } from './cli/commands/doctor.command.js';
import { stopCommand } from './cli/commands/stop.command.js';
import { cleanCommand } from './cli/commands/clean.command.js';
import { parsePhasesFlag } from './cli/commands/start.command.js';

const VERSION = '0.1.0';

interface StartCliFlags {
  readonly repo: string;
  readonly url?: string;
  readonly governed?: boolean;
  readonly shannon?: boolean;
  readonly phases?: string;
  readonly verbose?: boolean;
}

interface HistoryCliFlags {
  readonly repo?: string;
  readonly limit?: string;
}

interface ReportCliFlags {
  readonly format?: string;
}

interface CleanCliFlags {
  readonly yes?: boolean;
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name('sentinel')
    .description(
      'Unified Application Security Testing Platform — chains 7 specialized security tools through a mechanical BullMQ pipeline with an optional AI governor layer.',
    )
    .version(VERSION, '-v, --version', 'print sentinel version and exit')
    .exitOverride();

  program
    .command('start')
    .description('run an end-to-end security scan')
    .requiredOption('--repo <path>', 'absolute path to the repo to scan')
    .option('--url <url>', 'optional target URL for active scanners')
    .option('--governed', 'enable the AI governor layer', false)
    .option('--shannon', 'enable Phase 3 (Shannon DAST)', false)
    .option('--phases <list>', 'comma-separated phase numbers (e.g. 1,2 or 1,2,3)')
    .option('--verbose', 'verbose logging', false)
    .action((flags: StartCliFlags) => {
      try {
        const phases = parsePhasesFlag(flags.phases);
        rootLogger.info(
          {
            repo: flags.repo,
            url: flags.url,
            governed: flags.governed === true,
            shannon: flags.shannon === true,
            phases,
          },
          'sentinel start invoked — full pipeline runs after bash bootstrap',
        );
        process.exitCode = 0;
      } catch (err) {
        rootLogger.error({ err: (err as Error).message }, 'invalid arguments');
        process.exitCode = 3;
      }
    });

  program
    .command('history')
    .description('list past scans')
    .option('--repo <path>', 'filter by target repo')
    .option('--limit <n>', 'maximum rows to return', '20')
    .action((flags: HistoryCliFlags) => {
      const limit = flags.limit !== undefined ? Number(flags.limit) : 20;
      rootLogger.info({ repo: flags.repo, limit }, 'sentinel history invoked');
      process.exitCode = 0;
    });

  program
    .command('report <scanId>')
    .description('render a stored scan report')
    .option('--format <format>', 'output format (markdown|json)', 'markdown')
    .action((scanId: string, flags: ReportCliFlags) => {
      const format = flags.format ?? 'markdown';
      if (format !== 'markdown' && format !== 'json') {
        rootLogger.error({ format }, 'unknown --format value (markdown|json)');
        process.exitCode = 3;
        return;
      }
      rootLogger.info({ scanId, format }, 'sentinel report invoked');
      process.exitCode = 0;
    });

  program
    .command('diff <baselineScanId> <currentScanId>')
    .description('compare two scans by fingerprint')
    .action((baselineScanId: string, currentScanId: string) => {
      rootLogger.info({ baselineScanId, currentScanId }, 'sentinel diff invoked');
      process.exitCode = 0;
    });

  program
    .command('doctor')
    .description('verify host toolchain readiness')
    .action(async () => {
      const code = await doctorCommand();
      process.exitCode = code;
    });

  program
    .command('stop')
    .description('stop the sentinel-redis container')
    .action(async () => {
      const code = await stopCommand();
      process.exitCode = code;
    });

  program
    .command('clean')
    .description('remove redis container, scanner image, data/, workspaces/')
    .option('--yes', 'skip confirmation prompt', false)
    .action(async (flags: CleanCliFlags) => {
      const code = await cleanCommand({ yes: flags.yes === true });
      process.exitCode = code;
    });

  return program;
}

export const program = buildProgram();

// Only auto-parse when this module is the program entrypoint, NOT when imported by tests.
const isEntrypoint =
  typeof process.argv[1] === 'string' && /(?:^|[\\/])cli\.(?:js|ts)$/.test(process.argv[1]);

if (isEntrypoint) {
  try {
    program.parse(process.argv);
  } catch {
    // exitOverride throws on --help / --version / errors — Commander already wrote output.
  }
  if (process.argv.length <= 2) {
    program.outputHelp();
    rootLogger.debug({ phase: 'cli' }, 'Sentinel CLI invoked with no arguments — printed help.');
  }
}
