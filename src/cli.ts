#!/usr/bin/env node
/**
 * Sentinel CLI entry (Commander).
 *
 * Subcommands are added in Phase J (SM-44..48):
 *   start, history, report <id>, diff <id1> <id2>, doctor, stop, clean
 *
 * This Phase A stub just registers the program and prints --help / --version.
 */

import 'reflect-metadata';
import { Command } from 'commander';
import { rootLogger } from './common/logger.js';

const VERSION = '0.1.0';

const program = new Command();

program
  .name('sentinel')
  .description(
    'Unified Application Security Testing Platform — chains 7 specialized security tools through a mechanical BullMQ pipeline with an optional AI governor layer.',
  )
  .version(VERSION, '-v, --version', 'print sentinel version and exit');

program.parse(process.argv);

// If no args were provided, print help and exit cleanly.
if (process.argv.length <= 2) {
  program.outputHelp();
  rootLogger.debug({ phase: 'cli' }, 'Sentinel CLI invoked with no arguments — printed help.');
}
