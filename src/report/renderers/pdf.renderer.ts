/**
 * PDF report renderer (pdfmake).
 *
 * This file produces the pdfmake docDefinition. The actual `createPdfKitDocument`
 * call and file write happen in the CLI (Phase J) so this module stays pure and
 * unit-testable without a real PDF buffer.
 *
 * pdfmake is import-heavy; we only import types at compile time and lazily
 * import the runtime builder in the CLI.
 */

import { Injectable } from '@nestjs/common';
import type { Severity } from '../../scanner/types/finding.interface.js';
import type { ReportInput } from './markdown.renderer.js';

// Minimal subset of pdfmake's TDocumentDefinitions shape. Avoids a hard import
// of `pdfmake` types so unit tests don't need a real PDF pipeline.
export interface PdfDocDefinition {
  readonly content: readonly unknown[];
  readonly styles?: Record<string, unknown>;
  readonly defaultStyle?: Record<string, unknown>;
}

const SEVERITY_COLOR: Record<Severity, string> = {
  CRITICAL: '#8B0000',
  HIGH: '#B22222',
  MEDIUM: '#DAA520',
  LOW: '#2E8B57',
  INFO: '#4682B4',
};

@Injectable()
export class PdfRenderer {
  public buildDocDefinition(input: ReportInput): PdfDocDefinition {
    const content: unknown[] = [];
    content.push({ text: 'Sentinel Scan Report', style: 'title' });
    content.push({ text: `Scan ID: ${input.scanId}`, style: 'meta' });
    content.push({ text: `Target: ${input.targetRepo}`, style: 'meta' });
    if (input.targetUrl !== undefined) {
      content.push({ text: `URL: ${input.targetUrl}`, style: 'meta' });
    }
    content.push({ text: `Duration: ${input.durationMs}ms`, style: 'meta' });
    content.push({ text: ' ', margin: [0, 10, 0, 10] });

    content.push({ text: 'Summary', style: 'h1' });

    const counts: Record<Severity, number> = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, INFO: 0 };
    for (const f of input.findings) counts[f.severity]++;

    const tableBody: unknown[][] = [
      [{ text: 'Severity', bold: true }, { text: 'Count', bold: true }],
    ];
    for (const severity of ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'] as Severity[]) {
      tableBody.push([
        { text: severity, color: SEVERITY_COLOR[severity] },
        String(counts[severity]),
      ]);
    }
    content.push({ table: { body: tableBody, widths: ['*', '*'] } });
    content.push({ text: ' ', margin: [0, 10, 0, 10] });

    if (input.findings.length === 0) {
      content.push({ text: 'No findings.', style: 'p' });
    } else {
      content.push({ text: 'Findings', style: 'h1' });
      for (const finding of input.findings) {
        content.push({
          text: [
            { text: `[${finding.severity}] `, color: SEVERITY_COLOR[finding.severity], bold: true },
            { text: finding.title, bold: true },
          ],
          style: 'finding',
        });
        content.push({ text: finding.description, style: 'findingBody' });
        content.push({
          text: `Scanner: ${finding.scanner}${finding.cveId !== undefined ? ` · ${finding.cveId}` : ''}`,
          style: 'findingMeta',
        });
      }
    }

    return {
      content,
      styles: {
        title: { fontSize: 22, bold: true, margin: [0, 0, 0, 10] },
        h1: { fontSize: 16, bold: true, margin: [0, 15, 0, 5] },
        meta: { fontSize: 10, color: '#555555' },
        finding: { fontSize: 12, margin: [0, 5, 0, 2] },
        findingBody: { fontSize: 10, margin: [10, 0, 0, 2] },
        findingMeta: { fontSize: 9, italics: true, color: '#666666', margin: [10, 0, 0, 8] },
        p: { fontSize: 10 },
      },
      defaultStyle: { font: 'Roboto', fontSize: 10 },
    };
  }
}
