/**
 * Shared output parsers for scanner stdout.
 *
 * Every parse path terminates in a Zod-validated shape — `any` produced by
 * JSON.parse is narrowed within 5 lines. No raw parser result leaks into
 * correlation, persistence, or governor code.
 *
 * XML parsing uses `fast-xml-parser` with attribute names flattened so
 * callers can read `node.port` instead of `node['@_port']`.
 */

import { XMLParser } from 'fast-xml-parser';
import { type z } from 'zod';

export class ParseError extends Error {
  public readonly line?: number;
  public readonly scanner?: string;

  constructor(message: string, options: { line?: number; scanner?: string; cause?: unknown } = {}) {
    super(message);
    this.name = 'ParseError';
    this.line = options.line;
    this.scanner = options.scanner;
    if (options.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

/** Parse a single JSON document and validate it against a Zod schema. */
export function parseJson<T>(raw: string, schema: z.ZodType<T>, scanner?: string): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch (err) {
    throw new ParseError(`Invalid JSON: ${(err as Error).message}`, { scanner, cause: err });
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new ParseError(`JSON failed schema validation: ${result.error.message}`, {
      scanner,
      cause: result.error,
    });
  }
  return result.data;
}

/**
 * Parse newline-delimited JSON — one object per line. Blank lines are
 * skipped without error. Any non-blank line that fails JSON.parse or
 * schema validation throws a ParseError with the failing line index
 * (1-based) for operator diagnosis.
 */
export function parseJsonLines<T>(raw: string, schema: z.ZodType<T>, scanner?: string): T[] {
  const results: T[] = [];
  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (line.trim() === '') continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch (err) {
      throw new ParseError(`Invalid JSON on line ${i + 1}: ${(err as Error).message}`, {
        line: i + 1,
        scanner,
        cause: err,
      });
    }
    const validated = schema.safeParse(parsed);
    if (!validated.success) {
      throw new ParseError(
        `JSON line ${i + 1} failed schema validation: ${validated.error.message}`,
        { line: i + 1, scanner, cause: validated.error },
      );
    }
    results.push(validated.data);
  }
  return results;
}

const xmlParser = new XMLParser({
  attributeNamePrefix: '',
  ignoreAttributes: false,
  parseTagValue: true,
  parseAttributeValue: true,
  trimValues: true,
  allowBooleanAttributes: true,
});

/** Parse arbitrary XML into a plain object. Consumer narrows via Zod or type guard. */
export function parseXml(raw: string, scanner?: string): unknown {
  try {
    return xmlParser.parse(raw);
  } catch (err) {
    throw new ParseError(`Invalid XML: ${(err as Error).message}`, { scanner, cause: err });
  }
}
