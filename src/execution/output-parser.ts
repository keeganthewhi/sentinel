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
export function parseJson<S extends z.ZodTypeAny>(
  raw: string,
  schema: S,
  scanner?: string,
): z.output<S> {
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
  return result.data as z.output<S>;
}

export interface ParseJsonLinesOptions {
  /**
   * When true, skip malformed lines instead of throwing. This prevents a
   * single truncated line (e.g. from a mid-write container kill) from
   * discarding all valid findings in the preceding lines.
   */
  readonly lenient?: boolean;
}

/**
 * Parse newline-delimited JSON — one object per line. Blank lines are
 * skipped without error. In strict mode (default), any non-blank line that
 * fails JSON.parse or schema validation throws a ParseError. In lenient
 * mode, bad lines are silently skipped so partial output is still usable.
 */
export function parseJsonLines<S extends z.ZodTypeAny>(
  raw: string,
  schema: S,
  scanner?: string,
  options?: ParseJsonLinesOptions,
): z.output<S>[] {
  const lenient = options?.lenient === true;
  const results: z.output<S>[] = [];
  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (line.trim() === '') continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch (err) {
      if (lenient) continue;
      throw new ParseError(`Invalid JSON on line ${i + 1}: ${(err as Error).message}`, {
        line: i + 1,
        scanner,
        cause: err,
      });
    }
    const validated = schema.safeParse(parsed);
    if (!validated.success) {
      if (lenient) continue;
      throw new ParseError(
        `JSON line ${i + 1} failed schema validation: ${validated.error.message}`,
        { line: i + 1, scanner, cause: validated.error },
      );
    }
    results.push(validated.data as z.output<S>);
  }
  return results;
}

/**
 * Extract the first well-formed JSON object from a string. Scans balanced
 * braces while respecting string literals (and their escape sequences) so
 * `{` / `}` inside a quoted value don't throw off the depth counter.
 *
 * Used to tolerate agent CLIs that wrap their JSON response in markdown
 * fences or trail an explanation after the object (Claude does this often).
 *
 * Returns the raw input when no `{` is found — the caller's JSON.parse will
 * then fail with a clear message, which is the desired behavior.
 */
export function extractJsonObject(raw: string): string {
  const start = raw.indexOf('{');
  if (start < 0) return raw;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\') {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return raw.slice(start, i + 1);
      }
    }
  }
  // Unbalanced braces — return from first `{` to end so the JSON parser
  // surfaces a clear error including the malformed content.
  return raw.slice(start);
}

const xmlParser = new XMLParser({
  attributeNamePrefix: '',
  ignoreAttributes: false,
  parseTagValue: true,
  parseAttributeValue: true,
  trimValues: true,
  allowBooleanAttributes: true,
  // Explicitly disable entity processing to guard against future
  // library defaults changing. Scanner XML output is untrusted.
  processEntities: false,
});

/** Parse arbitrary XML into a plain object. Consumer narrows via Zod or type guard. */
export function parseXml(raw: string, scanner?: string): unknown {
  try {
    return xmlParser.parse(raw);
  } catch (err) {
    throw new ParseError(`Invalid XML: ${(err as Error).message}`, { scanner, cause: err });
  }
}
