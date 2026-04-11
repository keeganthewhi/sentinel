import { Module, type OnModuleInit } from '@nestjs/common';
import { ExecutionModule } from '../execution/execution.module.js';
import { PHASE1_SCANNERS } from './scanners/index.js';
import { ScannerRegistry } from './scanner.registry.js';

@Module({
  imports: [ExecutionModule],
  providers: [ScannerRegistry],
  exports: [ScannerRegistry],
})
export class ScannerModule implements OnModuleInit {
  constructor(private readonly registry: ScannerRegistry) {}

  public onModuleInit(): void {
    for (const scanner of PHASE1_SCANNERS) {
      this.registry.register(scanner);
    }
  }
}
