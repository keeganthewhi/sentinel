'use client';

import { useEffect, useState } from 'react';

interface LiveEvent {
  readonly kind: string;
  readonly scanId?: string;
  readonly scanner?: string;
  readonly phase?: number;
  readonly success?: boolean;
  readonly durationMs?: number;
  readonly findingCount?: number;
  readonly decisionType?: string;
  readonly fallback?: boolean;
  readonly at: number;
}

const MAX_EVENTS = 30;

function classifyKind(kind: string): string {
  if (kind === 'scan-started' || kind === 'scan-ended') return 'text-[var(--color-accent)]';
  if (kind === 'scanner-ended') return 'text-[var(--color-pass)]';
  if (kind === 'scanner-started') return 'text-[var(--color-muted)]';
  if (kind === 'governor-decision') return 'text-[var(--color-warn)]';
  if (kind === 'stream-error') return 'text-[var(--color-fail)]';
  return 'text-[var(--color-muted)]';
}

function formatLine(e: LiveEvent): string {
  if (e.kind === 'scanner-ended' && e.scanner !== undefined) {
    return `${e.scanner} ${e.success === true ? 'ok' : 'fail'} (${e.durationMs ?? 0}ms)`;
  }
  if (e.kind === 'scanner-started' && e.scanner !== undefined) {
    return `phase ${e.phase ?? '?'} · ${e.scanner} starting`;
  }
  if (e.kind === 'phase-started') return `phase ${e.phase ?? '?'} starting`;
  if (e.kind === 'phase-ended') return `phase ${e.phase ?? '?'} done`;
  if (e.kind === 'scan-started') return `scan started`;
  if (e.kind === 'scan-ended') return `scan ended · ${e.findingCount ?? 0} findings`;
  if (e.kind === 'governor-decision')
    return `${e.decisionType ?? 'decision'} ${e.fallback === true ? '(fallback)' : ''}`;
  return e.kind;
}

export function LiveStream() {
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const source = new EventSource('/api/stream');
    source.onopen = () => setConnected(true);
    source.onmessage = (msg) => {
      try {
        const parsed = JSON.parse(msg.data) as LiveEvent;
        setEvents((prev) => [parsed, ...prev].slice(0, MAX_EVENTS));
      } catch {
        // drop invalid frame
      }
    };
    source.onerror = () => setConnected(false);
    return () => source.close();
  }, []);

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-card)] p-4">
      <div className="flex items-center gap-2 mb-3 text-xs text-[var(--color-muted)]">
        <span
          className={`inline-block w-2 h-2 rounded-full ${connected ? 'bg-[var(--color-pass)]' : 'bg-[var(--color-fail)]'}`}
        />
        {connected ? 'connected' : 'disconnected'}
        <span>· {events.length} event{events.length === 1 ? '' : 's'}</span>
      </div>
      {events.length === 0 ? (
        <p className="text-sm text-[var(--color-muted)]">
          waiting for scan events. start a scan with{' '}
          <code className="text-[var(--color-accent)]">./sentinel start</code>.
        </p>
      ) : (
        <ul className="space-y-1 font-mono text-xs">
          {events.map((e, i) => {
            const time = new Date(e.at).toLocaleTimeString();
            return (
              <li key={`${e.at}-${i}`} className="flex gap-3">
                <span className="text-[var(--color-muted)] shrink-0">{time}</span>
                <span className={classifyKind(e.kind)}>{e.kind}</span>
                <span className="truncate">{formatLine(e)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
