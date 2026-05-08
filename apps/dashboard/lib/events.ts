/**
 * Shared SSE / pub-sub event shapes.
 *
 * The sentinel core publishes the same kinds via
 * src/sync/redis-event-publisher.ts. Drift-lock spec
 * src/sync/__tests__/dashboard-event-shapes.contract.spec.ts asserts the
 * `kind` set + REDIS_EVENT_CHANNEL constant match across both files.
 */

import { z } from 'zod';

export const REDIS_EVENT_CHANNEL = 'sentinel:events';

const phase = z.union([z.literal(1), z.literal(2), z.literal(3)]);

export const DashboardEventSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('scan-started'),
    scanId: z.string(),
    targetRepo: z.string(),
    governed: z.boolean(),
    at: z.number(),
  }),
  z.object({
    kind: z.literal('phase-started'),
    scanId: z.string(),
    phase,
    at: z.number(),
  }),
  z.object({
    kind: z.literal('phase-ended'),
    scanId: z.string(),
    phase,
    at: z.number(),
  }),
  z.object({
    kind: z.literal('scanner-started'),
    scanId: z.string(),
    phase,
    scanner: z.string(),
    at: z.number(),
  }),
  z.object({
    kind: z.literal('scanner-ended'),
    scanId: z.string(),
    scanner: z.string(),
    success: z.boolean(),
    durationMs: z.number(),
    at: z.number(),
  }),
  z.object({
    kind: z.literal('governor-decision'),
    scanId: z.string(),
    decisionType: z.string(),
    fallback: z.boolean(),
    rationale: z.string().optional(),
    at: z.number(),
  }),
  z.object({
    kind: z.literal('scan-ended'),
    scanId: z.string(),
    durationMs: z.number(),
    findingCount: z.number(),
    at: z.number(),
  }),
]);

export type DashboardEvent = z.infer<typeof DashboardEventSchema>;
