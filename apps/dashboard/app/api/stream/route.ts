import type { NextRequest } from 'next/server';
import { Redis } from 'ioredis';
import { DashboardEventSchema, REDIS_EVENT_CHANNEL } from '@/lib/events';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function resolveRedisUrl(): string {
  return process.env.SENTINEL_DASHBOARD_REDIS_URL ?? process.env.REDIS_URL ?? 'redis://127.0.0.1:6379';
}

export async function GET(_req: NextRequest): Promise<Response> {
  const url = resolveRedisUrl();
  const sub = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1 });
  let pingTimer: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (line: string): void => {
        try {
          controller.enqueue(enc.encode(line));
        } catch {
          // controller closed concurrently; ignore.
        }
      };
      const sendEvent = (data: string): void => send(`data: ${data}\n\n`);

      try {
        await sub.connect();
        await sub.subscribe(REDIS_EVENT_CHANNEL);
      } catch (err) {
        sendEvent(
          JSON.stringify({
            kind: 'stream-error',
            reason: 'redis-unreachable',
            detail: err instanceof Error ? err.message : 'unknown',
          }),
        );
        controller.close();
        return;
      }

      pingTimer = setInterval(() => send(': ping\n\n'), 30_000);

      sub.on('message', (_channel: string, payload: string) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(payload);
        } catch {
          return;
        }
        const validated = DashboardEventSchema.safeParse(parsed);
        if (!validated.success) return;
        sendEvent(JSON.stringify(validated.data));
      });
    },
    cancel() {
      if (pingTimer !== null) clearInterval(pingTimer);
      sub.disconnect();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
