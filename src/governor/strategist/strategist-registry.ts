/**
 * StrategistRegistry — order-stable in-memory map of per-scanner strategists.
 *
 * Mirrors `ScannerRegistry`. Registering the same scanner twice throws —
 * strategist additions are additive only. The pipeline (plan 018) calls
 * `forScanner(name)` to opt a scanner into the strategist loop; scanners
 * without a registered strategist run mechanically as today.
 */

import { Injectable } from '@nestjs/common';
import type { BaseStrategist } from './base-strategist.js';

@Injectable()
export class StrategistRegistry {
  private readonly byScanner = new Map<string, BaseStrategist>();

  public register(strategist: BaseStrategist): void {
    const key = strategist.scannerName;
    if (this.byScanner.has(key)) {
      throw new Error(`Strategist for scanner "${key}" already registered`);
    }
    this.byScanner.set(key, strategist);
  }

  public forScanner(scannerName: string): BaseStrategist | undefined {
    return this.byScanner.get(scannerName);
  }

  public all(): readonly BaseStrategist[] {
    return [...this.byScanner.values()];
  }

  /** Test-only helper. Production code never unregisters. */
  public clear(): void {
    this.byScanner.clear();
  }
}
