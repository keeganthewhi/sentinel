/**
 * RedisEventPublisher unit tests.
 *
 * Mocks `ioredis` so no live Redis is needed. Asserts:
 *   - Each ProgressEvent kind translates to the right DashboardEvent kind
 *   - Publisher with no URL is a no-op (does not throw)
 *   - Redis publish rejection is caught (logged, never propagates)
 *   - stop() disconnects the redis client and removes the listener
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProgressEmitter, type ProgressEvent } from '../../report/progress/progress.emitter.js';
import {
  RedisEventPublisher,
  REDIS_EVENT_CHANNEL,
  type DashboardEvent,
} from '../redis-event-publisher.js';

interface FakeRedis {
  publish: ReturnType<typeof vi.fn>;
  quit: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
}

const fakeRedisRegistry: FakeRedis[] = [];

vi.mock('ioredis', () => {
  return {
    Redis: vi.fn().mockImplementation(() => {
      const fake: FakeRedis = {
        publish: vi.fn().mockResolvedValue(1),
        quit: vi.fn().mockResolvedValue('OK'),
        disconnect: vi.fn(),
        on: vi.fn(),
      };
      fakeRedisRegistry.push(fake);
      return fake;
    }),
  };
});

function lastFakeRedis(): FakeRedis {
  const last = fakeRedisRegistry[fakeRedisRegistry.length - 1];
  if (last === undefined) throw new Error('no fake redis instance constructed');
  return last;
}

function buildPublisher(url?: string): { publisher: RedisEventPublisher; emitter: ProgressEmitter } {
  const emitter = new ProgressEmitter();
  const publisher = new RedisEventPublisher(emitter, url);
  return { publisher, emitter };
}

function published(redis: FakeRedis): DashboardEvent[] {
  return redis.publish.mock.calls.map((call) => {
    const payload = call[1] as string;
    return JSON.parse(payload) as DashboardEvent;
  });
}

beforeEach(() => {
  fakeRedisRegistry.length = 0;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('RedisEventPublisher', () => {
  it('relays phase.start as phase-started', () => {
    const { publisher, emitter } = buildPublisher('redis://localhost:6379');
    publisher.start();
    const evt: ProgressEvent = { type: 'phase.start', phase: 1, scanId: 'scan-a' };
    emitter.emit(evt);
    const events = published(lastFakeRedis());
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe('phase-started');
    if (events[0]?.kind === 'phase-started') {
      expect(events[0].scanId).toBe('scan-a');
      expect(events[0].phase).toBe(1);
    }
  });

  it('relays scanner.end with success=false', () => {
    const { publisher, emitter } = buildPublisher('redis://localhost:6379');
    publisher.start();
    emitter.emit({
      type: 'scanner.end',
      scanner: 'semgrep',
      scanId: 'scan-b',
      success: false,
      durationMs: 4321,
    });
    const events = published(lastFakeRedis());
    expect(events).toHaveLength(1);
    if (events[0]?.kind === 'scanner-ended') {
      expect(events[0].success).toBe(false);
      expect(events[0].scanner).toBe('semgrep');
      expect(events[0].durationMs).toBe(4321);
    }
  });

  it('publishes to the canonical channel name', () => {
    const { publisher, emitter } = buildPublisher('redis://localhost:6379');
    publisher.start();
    emitter.emit({ type: 'phase.end', phase: 2, scanId: 'scan-c' });
    const calls = lastFakeRedis().publish.mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toBe(REDIS_EVENT_CHANNEL);
  });

  it('is a no-op when no URL is configured', () => {
    const { publisher, emitter } = buildPublisher(undefined);
    publisher.start();
    emitter.emit({ type: 'phase.start', phase: 1, scanId: 'scan-x' });
    expect(fakeRedisRegistry).toHaveLength(0);
  });

  it('catches Redis publish rejection without throwing into the scan', async () => {
    const { publisher, emitter } = buildPublisher('redis://localhost:6379');
    publisher.start();
    const fake = lastFakeRedis();
    fake.publish.mockRejectedValueOnce(new Error('connection lost'));
    expect(() => {
      emitter.emit({ type: 'phase.end', phase: 1, scanId: 'scan-d' });
    }).not.toThrow();
    // Wait a microtask so the unhandled-promise catch fires.
    await Promise.resolve();
  });

  it('stop() removes the listener and quits redis', async () => {
    const { publisher, emitter } = buildPublisher('redis://localhost:6379');
    publisher.start();
    const fake = lastFakeRedis();
    await publisher.stop();
    emitter.emit({ type: 'phase.start', phase: 1, scanId: 'scan-e' });
    expect(fake.publish.mock.calls).toHaveLength(0);
    expect(fake.quit).toHaveBeenCalledTimes(1);
  });

  it('publish() direct call writes a frame', () => {
    const { publisher } = buildPublisher('redis://localhost:6379');
    publisher.start();
    publisher.publish({
      kind: 'scan-started',
      scanId: 'scan-f',
      targetRepo: '/repo',
      governed: true,
      at: 1700000000000,
    });
    const events = published(lastFakeRedis());
    expect(events[0]?.kind).toBe('scan-started');
  });

  it('relays governor.decision', () => {
    const { publisher, emitter } = buildPublisher('redis://localhost:6379');
    publisher.start();
    emitter.emit({
      type: 'governor.decision',
      scanId: 'scan-g',
      message: 'plan_generator',
      success: true,
    });
    const events = published(lastFakeRedis());
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe('governor-decision');
  });
});
