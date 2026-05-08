import { Module } from '@nestjs/common';
import { CorrelationService } from './correlation.service.js';
import { VerdictService } from './verdict.service.js';

@Module({
  providers: [CorrelationService, VerdictService],
  exports: [CorrelationService, VerdictService],
})
export class CorrelationModule {}
