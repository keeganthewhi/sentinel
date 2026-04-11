/**
 * Pipeline progress emitter.
 *
 * Tiny EventEmitter-like class used by the pipeline service to broadcast
 * phase/scanner lifecycle events. Terminal UI and future metrics subscribers
 * listen for these events and render them as appropriate.
 */

import { Injectable } from '@nestjs/common';

export type ProgressEventType =
  | 'phase.start'
  | 'phase.end'
  | 'scanner.start'
  | 'scanner.end'
  | 'governor.decision';

export interface ProgressEvent {
  readonly type: ProgressEventType;
  readonly phase?: 1 | 2 | 3;
  readonly scanner?: string;
  readonly scanId?: string;
  readonly success?: boolean;
  readonly durationMs?: number;
  readonly message?: string;
}

export type ProgressListener = (event: ProgressEvent) => void;

@Injectable()
export class ProgressEmitter {
  private readonly listeners = new Set<ProgressListener>();

  public on(listener: ProgressListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public emit(event: ProgressEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  public clear(): void {
    this.listeners.clear();
  }
}
