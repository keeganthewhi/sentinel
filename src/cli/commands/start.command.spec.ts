import { describe, expect, it } from 'vitest';
import { parsePhasesFlag } from './start.command.js';

describe('parsePhasesFlag', () => {
  it('returns undefined for empty / undefined input', () => {
    expect(parsePhasesFlag(undefined)).toBeUndefined();
    expect(parsePhasesFlag('')).toBeUndefined();
  });

  it('parses a single phase', () => {
    expect(parsePhasesFlag('1')).toEqual([1]);
  });

  it('parses multiple phases', () => {
    expect(parsePhasesFlag('1,2,3')).toEqual([1, 2, 3]);
  });

  it('strips whitespace', () => {
    expect(parsePhasesFlag(' 1 , 2 ')).toEqual([1, 2]);
  });

  it('throws on invalid phase', () => {
    expect(() => parsePhasesFlag('1,4')).toThrow();
    expect(() => parsePhasesFlag('0')).toThrow();
    expect(() => parsePhasesFlag('abc')).toThrow();
  });
});
