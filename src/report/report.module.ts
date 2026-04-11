import { Module } from '@nestjs/common';
import { MarkdownRenderer } from './renderers/markdown.renderer.js';
import { JsonRenderer } from './renderers/json.renderer.js';
import { PdfRenderer } from './renderers/pdf.renderer.js';

@Module({
  providers: [MarkdownRenderer, JsonRenderer, PdfRenderer],
  exports: [MarkdownRenderer, JsonRenderer, PdfRenderer],
})
export class ReportModule {}
