/**
 * StrategistModule — wires per-tool AI strategists on top of GovernorModule.
 *
 * Loads the same way GovernorModule does: ad-hoc via the CLI when the
 * `--governed` flag is set. Without `--governed`, strategists are not
 * constructed and the pipeline runs each scanner mechanically as today.
 *
 * Critical invariants:
 *   - This module does NOT import ScannerModule. Strategists never touch
 *     scanner concrete classes.
 *   - This module does NOT spawn scanner subprocesses. Strategists return
 *     structured plans (`ScannerInvocationPlan`) which the pipeline applies.
 */

import { Inject, Module, OnModuleInit } from '@nestjs/common';
import { GovernorModule, AGENT_ADAPTER } from '../governor.module.js';
import type { AgentAdapter } from '../agent-adapter.js';
import { StrategistRegistry } from './strategist-registry.js';
import { SemgrepStrategist } from './strategists/semgrep.strategist.js';
import type { BaseStrategist } from './base-strategist.js';

export const SEMGREP_STRATEGIST = Symbol('SEMGREP_STRATEGIST');

@Module({
  imports: [GovernorModule],
  providers: [
    StrategistRegistry,
    {
      provide: SEMGREP_STRATEGIST,
      // Strategists do not require the adapter at construction time — the
      // adapter is passed per-call via StrategistContext from the pipeline.
      // We still validate at module init that an AGENT_ADAPTER is wired so
      // misconfigurations surface at boot, not at first scan.
      useFactory: (_adapter: AgentAdapter): BaseStrategist => new SemgrepStrategist(),
      inject: [AGENT_ADAPTER],
    },
  ],
  exports: [StrategistRegistry, AGENT_ADAPTER],
})
export class StrategistModule implements OnModuleInit {
  constructor(
    private readonly registry: StrategistRegistry,
    @Inject(SEMGREP_STRATEGIST) private readonly semgrep: BaseStrategist,
  ) {}

  public onModuleInit(): void {
    this.registry.register(this.semgrep);
  }
}

