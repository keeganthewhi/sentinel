import { Module, type OnModuleInit } from '@nestjs/common';
import { DockerExecutor } from '../execution/docker.executor.js';
import { ExecutionModule } from '../execution/execution.module.js';
import { PHASE1_SCANNERS, PHASE2_SCANNERS, PHASE3_SCANNERS } from './scanners/index.js';
import { ScannerRegistry } from './scanner.registry.js';

@Module({
  imports: [ExecutionModule],
  providers: [ScannerRegistry],
  exports: [ScannerRegistry],
})
export class ScannerModule implements OnModuleInit {
  constructor(
    private readonly registry: ScannerRegistry,
    private readonly executor: DockerExecutor,
  ) {}

  public onModuleInit(): void {
    const all = [...PHASE1_SCANNERS, ...PHASE2_SCANNERS, ...PHASE3_SCANNERS];
    for (const scanner of all) {
      scanner.setExecutor(this.executor);
      this.registry.register(scanner);
    }
  }
}
