/**
 * In-memory registry of scanner implementations.
 *
 * Registration is order-stable: `all()` and `forPhase()` return scanners in
 * insertion order so that reports and STATE.md are deterministic across runs.
 *
 * Registering the same name twice throws — scanner additions must be additive.
 */

import { Injectable } from '@nestjs/common';
import type { BaseScanner } from './types/scanner.interface.js';

@Injectable()
export class ScannerRegistry {
  private readonly scanners = new Map<string, BaseScanner>();

  public register(scanner: BaseScanner): void {
    if (this.scanners.has(scanner.name)) {
      throw new Error(`Scanner "${scanner.name}" already registered`);
    }
    this.scanners.set(scanner.name, scanner);
  }

  public get(name: string): BaseScanner | undefined {
    return this.scanners.get(name);
  }

  public all(): readonly BaseScanner[] {
    return [...this.scanners.values()];
  }

  public forPhase(phase: 1 | 2 | 3): readonly BaseScanner[] {
    return this.all().filter((scanner) => scanner.phase === phase);
  }

  /** Test-only helper. Production code never unregisters. */
  public clear(): void {
    this.scanners.clear();
  }
}
