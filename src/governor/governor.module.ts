/**
 * GovernorModule — wires the agent adapter, plan generator, phase evaluator,
 * and report writer.
 *
 * Critical invariant #4: nothing in this module spawns a scanner subprocess.
 * The agent-adapter is the only file permitted to import `node:child_process`,
 * and even then it only spawns the governor CLI (claude/codex/gemini), never
 * a security scanner.
 */

import { Module } from '@nestjs/common';
import { ReportModule } from '../report/report.module.js';
import { MarkdownRenderer } from '../report/renderers/markdown.renderer.js';
import {
  ClaudeCliAdapter,
  CodexCliAdapter,
  GeminiCliAdapter,
  createAgentAdapter,
  type AgentAdapter,
} from './agent-adapter.js';
import { PlanGenerator } from './plan-generator.js';
import { PhaseEvaluator } from './phase-evaluator.js';
import { ReportWriter } from './report-writer.js';

export const AGENT_ADAPTER = Symbol('AGENT_ADAPTER');

@Module({
  imports: [ReportModule],
  providers: [
    ClaudeCliAdapter,
    CodexCliAdapter,
    GeminiCliAdapter,
    {
      provide: AGENT_ADAPTER,
      useFactory: (): AgentAdapter => createAgentAdapter(),
    },
    {
      provide: PlanGenerator,
      useFactory: (adapter: AgentAdapter): PlanGenerator => new PlanGenerator(adapter),
      inject: [AGENT_ADAPTER],
    },
    {
      provide: PhaseEvaluator,
      useFactory: (adapter: AgentAdapter): PhaseEvaluator => new PhaseEvaluator(adapter),
      inject: [AGENT_ADAPTER],
    },
    {
      provide: ReportWriter,
      useFactory: (adapter: AgentAdapter, renderer: MarkdownRenderer): ReportWriter =>
        new ReportWriter(adapter, renderer),
      inject: [AGENT_ADAPTER, MarkdownRenderer],
    },
  ],
  exports: [PlanGenerator, PhaseEvaluator, ReportWriter, AGENT_ADAPTER],
})
export class GovernorModule {}
