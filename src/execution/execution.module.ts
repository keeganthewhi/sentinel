import { Module } from '@nestjs/common';
import { DockerExecutor } from './docker.executor.js';

@Module({
  providers: [DockerExecutor],
  exports: [DockerExecutor],
})
export class ExecutionModule {}
