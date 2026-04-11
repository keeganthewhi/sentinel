import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ParseError, parseJson, parseJsonLines, parseXml } from './output-parser.js';

const PersonSchema = z.object({ name: z.string(), age: z.number().int().positive() });

describe('parseJson', () => {
  it('returns a typed object for valid input', () => {
    const result = parseJson('{"name":"Ada","age":36}', PersonSchema);
    expect(result).toEqual({ name: 'Ada', age: 36 });
  });

  it('throws ParseError on malformed JSON', () => {
    expect(() => parseJson('{not json}', PersonSchema)).toThrow(ParseError);
  });

  it('throws ParseError when schema validation fails', () => {
    expect(() => parseJson('{"name":"Ada","age":-1}', PersonSchema)).toThrow(ParseError);
  });

  it('attaches the scanner name when provided', () => {
    try {
      parseJson('not json', PersonSchema, 'trivy');
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ParseError);
      expect((err as ParseError).scanner).toBe('trivy');
    }
  });
});

describe('parseJsonLines', () => {
  it('parses valid JSONL input', () => {
    const raw = '{"name":"Ada","age":36}\n{"name":"Bea","age":28}';
    const result = parseJsonLines(raw, PersonSchema);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ name: 'Ada', age: 36 });
    expect(result[1]).toEqual({ name: 'Bea', age: 28 });
  });

  it('skips blank lines silently', () => {
    const raw = '{"name":"Ada","age":36}\n\n\n{"name":"Bea","age":28}\n';
    const result = parseJsonLines(raw, PersonSchema);
    expect(result).toHaveLength(2);
  });

  it('reports the failing line index on invalid JSON', () => {
    const raw = '{"name":"Ada","age":36}\n{broken\n{"name":"Bea","age":28}';
    try {
      parseJsonLines(raw, PersonSchema);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ParseError);
      expect((err as ParseError).line).toBe(2);
    }
  });

  it('reports the failing line index on schema violation', () => {
    const raw = '{"name":"Ada","age":36}\n{"name":"Bea","age":"not-a-number"}';
    try {
      parseJsonLines(raw, PersonSchema);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ParseError);
      expect((err as ParseError).line).toBe(2);
    }
  });

  it('handles CRLF line endings', () => {
    const raw = '{"name":"Ada","age":36}\r\n{"name":"Bea","age":28}\r\n';
    const result = parseJsonLines(raw, PersonSchema);
    expect(result).toHaveLength(2);
  });

  it('returns an empty array for empty input', () => {
    expect(parseJsonLines('', PersonSchema)).toEqual([]);
    expect(parseJsonLines('\n\n\n', PersonSchema)).toEqual([]);
  });
});

describe('parseXml', () => {
  it('flattens attribute names (no @_ prefix)', () => {
    const raw =
      '<nmaprun scanner="nmap" version="7.94"><host><ports><port protocol="tcp" portid="22"><state state="open"/></port></ports></host></nmaprun>';
    // fast-xml-parser with parseAttributeValue:true auto-coerces numeric attributes.
    const result = parseXml(raw) as {
      nmaprun: {
        scanner: string;
        version: number;
        host: { ports: { port: { protocol: string; portid: number } } };
      };
    };
    expect(result.nmaprun.scanner).toBe('nmap');
    expect(result.nmaprun.version).toBe(7.94);
    expect(result.nmaprun.host.ports.port.protocol).toBe('tcp');
    expect(result.nmaprun.host.ports.port.portid).toBe(22);
  });

  it('throws ParseError on invalid XML', () => {
    expect(() => parseXml('<not-closed')).toThrow(ParseError);
  });
});
