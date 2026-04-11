/**
 * ReportWriter (Decision 4) — final AI-authored report.
 *
 * Builds the report prompt, queries the adapter, and validates the response.
 * On any failure (timeout, invalid JSON, hallucinated citation) → falls back
 * to the mechanical Markdown renderer from Phase F.
 */

import { Injectable } from '@nestjs/common';
import { createLogger } from '../common/logger.js';
import { extractJsonObject, parseJson } from '../execution/output-parser.js';
import { buildReportPrompt, type ReportInput as PromptReportInput } from './governor.prompts.js';
import { REPORT_SCHEMA } from './types/governor-decision.js';
import { MarkdownRenderer, type ReportInput as RendererInput } from '../report/renderers/markdown.renderer.js';
import type { AgentAdapter } from './agent-adapter.js';

export interface ReportWriterRequest {
  readonly promptInput: PromptReportInput;
  readonly fallbackInput: RendererInput;
}

export interface ReportWriterResult {
  readonly markdown: string;
  readonly aiAuthored: boolean;
}

@Injectable()
export class ReportWriter {
  private readonly logger = createLogger({ module: 'governor.report-writer' });

  constructor(
    private readonly adapter: AgentAdapter,
    private readonly markdownRenderer: MarkdownRenderer,
  ) {}

  public async write(request: ReportWriterRequest): Promise<ReportWriterResult> {
    const prompt = buildReportPrompt(request.promptInput);
    try {
      const response = await this.adapter.query(prompt);
      const cleaned = extractJsonObject(response);
      const decision = parseJson(cleaned, REPORT_SCHEMA, 'governor.report-writer');
      const validFingerprints = new Set(request.promptInput.findings.map((f) => f.fingerprint));
      const allCitationsValid = decision.citationFingerprints.every((fp) => validFingerprints.has(fp));
      if (!allCitationsValid) {
        this.logger.warn({}, 'report-writer hallucinated citations — falling back to mechanical');
        return this.fallback(request.fallbackInput);
      }
      return { markdown: decision.markdown, aiAuthored: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn({ err: message }, 'report-writer failed — falling back to mechanical');
      return this.fallback(request.fallbackInput);
    }
  }

  private fallback(input: RendererInput): ReportWriterResult {
    return { markdown: this.markdownRenderer.render(input), aiAuthored: false };
  }
}
