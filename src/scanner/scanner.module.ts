import { Module } from '@nestjs/common';
import { ExecutionModule } from '../execution/execution.module.js';
import { ScannerRegistry } from './scanner.registry.js';

@Module({
  imports: [ExecutionModule],
  providers: [ScannerRegistry],
  exports: [ScannerRegistry],
})
export class ScannerModule {}
