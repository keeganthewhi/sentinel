import { Module } from '@nestjs/common';
import { ScannerModule } from '../scanner/scanner.module.js';
import { GovernorModule } from '../governor/governor.module.js';
import { StrategistModule } from '../governor/strategist/strategist.module.js';
import { InMemoryPipelineRunner } from './in-memory.runner.js';
import { PipelineService } from './pipeline.service.js';
import { ProgressEmitter } from '../report/progress/progress.emitter.js';
import { TerminalUI } from '../report/progress/terminal-ui.js';

/**
 * PipelineModule wires the in-memory runner, pipeline service, progress
 * emitter, and terminal UI. Imports GovernorModule and StrategistModule so
 * PipelineService can resolve its `@Optional()` PlanGenerator /
 * PhaseEvaluator / ReportWriter / StrategistRegistry / AgentAdapter
 * dependencies when the governor is enabled via `--governed`.
 *
 * The BullMQ runner is NOT provided here — the CLI bootstrap decides whether
 * to construct it based on Redis availability and passes it to
 * `PipelineService.run(options, bullMqRunner)`.
 */
@Module({
  imports: [ScannerModule, GovernorModule, StrategistModule],
  providers: [InMemoryPipelineRunner, ProgressEmitter, TerminalUI, PipelineService],
  exports: [PipelineService, ProgressEmitter, TerminalUI],
})
export class PipelineModule {}
