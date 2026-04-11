/**
 * Terminal UI — renders pipeline progress events as per-scanner status lines.
 *
 * Uses ora spinners when stdout is a TTY. Falls back to plain `console.log`
 * when not connected to a terminal (CI, piped output).
 */

import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import ora, { type Ora } from 'ora';
import {
  ProgressEmitter,
  type ProgressEvent,
} from './progress.emitter.js';

@Injectable()
export class TerminalUI implements OnModuleDestroy {
  private unsubscribe: (() => void) | null = null;
  private readonly spinners = new Map<string, Ora>();
  private plainMode: boolean;

  constructor(private readonly emitter: ProgressEmitter) {
    this.plainMode = !process.stdout.isTTY;
  }

  public attach(): void {
    if (this.unsubscribe !== null) return;
    this.unsubscribe = this.emitter.on((event) => {
      this.handle(event);
    });
  }

  public detach(): void {
    if (this.unsubscribe !== null) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    for (const spinner of this.spinners.values()) {
      spinner.stop();
    }
    this.spinners.clear();
  }

  public onModuleDestroy(): void {
    this.detach();
  }

  private handle(event: ProgressEvent): void {
    if (event.type === 'phase.start') {
      this.write(`\n── Phase ${event.phase ?? '?'} ──`);
      return;
    }
    if (event.type === 'phase.end') {
      this.write(`── Phase ${event.phase ?? '?'} complete (${event.durationMs ?? 0}ms)`);
      return;
    }
    if (event.type === 'scanner.start') {
      const name = event.scanner ?? 'scanner';
      if (this.plainMode) {
        this.write(`  [${name}] running...`);
      } else {
        const spinner = ora(`  [${name}] running`).start();
        this.spinners.set(name, spinner);
      }
      return;
    }
    if (event.type === 'scanner.end') {
      const name = event.scanner ?? 'scanner';
      const label = event.success === true ? 'OK' : 'FAIL';
      const line = `  [${name}] ${label} (${event.durationMs ?? 0}ms)`;
      if (this.plainMode) {
        this.write(line);
      } else {
        const spinner = this.spinners.get(name);
        if (spinner !== undefined) {
          if (event.success === true) spinner.succeed(line);
          else spinner.fail(line);
          this.spinners.delete(name);
        } else {
          this.write(line);
        }
      }
      return;
    }
    // Remaining case: governor.decision
    this.write(`\x1b[36m  [governor] ${event.message ?? ''}\x1b[0m`);
  }

  private write(line: string): void {
    console.log(line);
  }
}
