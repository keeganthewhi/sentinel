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

  /**
   * Minimum fraction of citation fingerprints that must match an actual
   * finding for the AI-authored report to be accepted. Strict 100% match was
   * too brittle — claude occasionally drops or invents a single fingerprint
   * among many correct ones, and we'd trash the whole ~30 KB report. 75%
   * keeps the fail-safe against full-blown hallucination (if claude invents
   * the entire citation list, validRatio collapses toward 0) while letting
   * real reports through with their minor imperfections. Invariant #7
   * (mechanical fallback on governor failure) still holds below threshold.
   */
  private static readonly MIN_VALID_CITATION_RATIO = 0.75;

  public async write(request: ReportWriterRequest): Promise<ReportWriterResult> {
    const prompt = buildReportPrompt(request.promptInput);
    try {
      const response = await this.adapter.query(prompt);
      const cleaned = extractJsonObject(response);
      const decision = parseJson(cleaned, REPORT_SCHEMA, 'governor.report-writer');
      const validFingerprints = new Set(request.promptInput.findings.map((f) => f.fingerprint));

      const cited = decision.citationFingerprints;
      if (cited.length === 0) {
        // No citations — accept as-is. This is a legitimate AI-authored
        // report on an empty finding set ("no critical findings" summary).
        return { markdown: decision.markdown, aiAuthored: true };
      }
      const validCited = cited.filter((fp) => validFingerprints.has(fp));
      const invalidCited = cited.filter((fp) => !validFingerprints.has(fp));
      const validRatio = validCited.length / cited.length;

      if (validRatio < ReportWriter.MIN_VALID_CITATION_RATIO) {
        this.logger.warn(
          {
            citationCount: cited.length,
            validCount: validCited.length,
            validRatio,
            invalidSample: invalidCited.slice(0, 5),
          },
          'report-writer hallucinated too many citations — falling back to mechanical',
        );
        return this.fallback(request.fallbackInput);
      }

      if (invalidCited.length > 0) {
        this.logger.info(
          {
            citationCount: cited.length,
            validCount: validCited.length,
            invalidCount: invalidCited.length,
            validRatio,
          },
          'report-writer has minor citation drift — accepting AI-authored markdown',
        );
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
