import { Module } from '@nestjs/common';
import { ScannerModule } from '../scanner/scanner.module.js';
import { InMemoryPipelineRunner } from './in-memory.runner.js';
import { PipelineService } from './pipeline.service.js';
import { ProgressEmitter } from '../report/progress/progress.emitter.js';
import { TerminalUI } from '../report/progress/terminal-ui.js';

/**
 * PipelineModule wires the in-memory runner, pipeline service, progress
 * emitter, and terminal UI. The BullMQ runner is NOT provided here — the CLI
 * bootstrap (Phase J) decides whether to construct it based on Redis
 * availability and passes it to `PipelineService.run(options, bullMqRunner)`.
 */
@Module({
  imports: [ScannerModule],
  providers: [InMemoryPipelineRunner, ProgressEmitter, TerminalUI, PipelineService],
  exports: [PipelineService, ProgressEmitter, TerminalUI],
})
export class PipelineModule {}
