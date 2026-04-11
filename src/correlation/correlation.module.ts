import { Module } from '@nestjs/common';
import { CorrelationService } from './correlation.service.js';

@Module({
  providers: [CorrelationService],
  exports: [CorrelationService],
})
export class CorrelationModule {}
