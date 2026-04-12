/**
 * Schemathesis scanner — API fuzzer with JUnit XML output.
 *
 * Command: `schemathesis run --base-url <url> <spec> --checks all --junit-xml -`
 *
 * Spec resolution order:
 *   1. `context.openApiSpec` — explicit path or URL passed via `--openapi`
 *   2. Auto-discovery: probe the target URL for common OpenAPI paths
 *      (/openapi.json, /openapi.yaml, /swagger.json, /api-docs, /v3/api-docs)
 *      and use the first one that returns a 2xx with valid JSON/YAML.
 *   3. Skip with a clear reason if neither path yields a spec.
 *
 * Auto-discovery is performed BEFORE docker spawn, from the sentinel host
 * process — it's a handful of HEAD requests via Node's fetch, no container
 * cost. The discovered URL is then passed to schemathesis inside the
 * container via a mounted positional argument.
 *
 * JUnit XML is parsed via `parseXml` — handles both single-suite and nested
 * suites-of-suites forms. `fast-xml-parser` returns a plain object for
 * single-element nodes and an array for multi-element nodes; the parser
 * normalizes both cases via `toArray()`.
 */

import { parseXml, ParseError } from '../../execution/output-parser.js';
import { shortHash } from './fingerprint.helper.js';
import { createLogger } from '../../common/logger.js';
import {
  BaseScanner,
  type ScanContext,
  type ScannerResult,
} from '../types/scanner.interface.js';
import type { NormalizedFinding } from '../types/finding.interface.js';
import { runScannerInDocker, withFindings } from './runner.helper.js';

const logger = createLogger({ module: 'scanner.schemathesis' });

/**
 * Common paths where web frameworks serve OpenAPI/Swagger specs. Ordered
 * by prevalence — NestJS @nestjs/swagger defaults to `/api-json`, FastAPI
 * to `/openapi.json`, Spring / Springdoc to `/v3/api-docs`, many CLIs to
 * `/swagger.json`. The probe stops as soon as one returns 2xx.
 */
const OPENAPI_PROBE_PATHS: readonly string[] = Object.freeze([
  '/openapi.json',
  '/openapi.yaml',
  '/openapi.yml',
  '/swagger.json',
  '/swagger.yaml',
  '/v3/api-docs',
  '/api-docs',
  '/api-json',
  '/api/openapi.json',
  '/api/docs/openapi.json',
]);

/** Probe timeout — short enough that a missing spec doesn't hold up Phase 2. */
const PROBE_TIMEOUT_MS = 5_000;

/**
 * GET each candidate path against the target host; return the first URL
 * whose response is a 2xx with a JSON or YAML body that looks like an
 * OpenAPI spec (starts with `{` or `openapi:` or `swagger:`). Returns the
 * absolute URL of the discovered spec, or null if nothing matched.
 *
 * Exported for testing.
 */
export async function discoverOpenApiSpec(targetUrl: string): Promise<string | null> {
  let base: URL;
  try {
    base = new URL(targetUrl);
  } catch {
    return null;
  }
  for (const probePath of OPENAPI_PROBE_PATHS) {
    const candidate = new URL(probePath, base).toString();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
      }, PROBE_TIMEOUT_MS);
      const response = await fetch(candidate, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
        headers: { Accept: 'application/json,application/yaml,*/*' },
      });
      clearTimeout(timer);
      if (!response.ok) continue;
      const body = (await response.text()).slice(0, 4096).trim();
      if (
        body.startsWith('{') ||
        body.startsWith('openapi:') ||
        body.startsWith('swagger:') ||
        body.startsWith('---')
      ) {
        logger.info({ candidate }, 'auto-discovered OpenAPI spec');
        return candidate;
      }
    } catch {
      // timeout / DNS / TLS — next candidate
    }
  }
  return null;
}

interface JUnitFailure {
  readonly message?: string;
  readonly type?: string;
  readonly '#text'?: string;
}

interface JUnitTestCase {
  readonly name?: string;
  readonly classname?: string;
  readonly failure?: JUnitFailure | readonly JUnitFailure[];
  readonly error?: JUnitFailure | readonly JUnitFailure[];
}

interface JUnitTestSuite {
  readonly name?: string;
  readonly testcase?: JUnitTestCase | readonly JUnitTestCase[];
  readonly testsuite?: JUnitTestSuite | readonly JUnitTestSuite[];
}

interface JUnitRoot {
  readonly testsuites?: JUnitTestSuite | { testsuite?: JUnitTestSuite | readonly JUnitTestSuite[] };
  readonly testsuite?: JUnitTestSuite | readonly JUnitTestSuite[];
}

function toArray<T>(value: T | readonly T[] | undefined): readonly T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value as T];
}

function collectTestCases(suite: JUnitTestSuite): JUnitTestCase[] {
  const cases: JUnitTestCase[] = [];
  for (const tc of toArray(suite.testcase)) {
    cases.push(tc);
  }
  for (const nested of toArray(suite.testsuite)) {
    cases.push(...collectTestCases(nested));
  }
  return cases;
}

function failureText(failure: JUnitFailure): string {
  return failure.message ?? failure['#text'] ?? failure.type ?? 'API check failed';
}

export class SchemathesisScanner extends BaseScanner {
  public readonly name = 'schemathesis';
  public readonly phase = 2 as const;
  public readonly requiresUrl = true;

  public async execute(context: ScanContext): Promise<ScannerResult> {
    if (context.targetUrl === undefined || context.targetUrl.trim() === '') {
      return {
        scanner: this.name,
        findings: [],
        rawOutput: '',
        executionTimeMs: 0,
        success: true,
        error: 'skipped: schemathesis requires targetUrl',
      };
    }

    // 1. Explicit spec wins.
    // 2. Otherwise probe the target for common OpenAPI paths.
    let specUrl = context.openApiSpec;
    if (specUrl === undefined || specUrl.trim() === '') {
      specUrl = (await discoverOpenApiSpec(context.targetUrl)) ?? undefined;
    }
    if (specUrl === undefined) {
      return {
        scanner: this.name,
        findings: [],
        rawOutput: '',
        executionTimeMs: 0,
        success: true,
        error:
          'skipped: no OpenAPI spec — none of /openapi.json, /openapi.yaml, /swagger.json, /v3/api-docs, /api-docs returned a valid document. Pass --openapi <url> to override.',
      };
    }

    // Validate specUrl is a real URL to prevent flag injection.
    try {
      new URL(specUrl);
    } catch {
      return {
        scanner: this.name,
        findings: [],
        rawOutput: '',
        executionTimeMs: 0,
        success: false,
        error: `invalid openapi spec URL: ${specUrl}`,
      };
    }
    // Schemathesis exits non-zero when checks fail; we want the JUnit XML either way.
    const command = [
      'schemathesis',
      'run',
      '--base-url',
      context.targetUrl,
      specUrl,
      '--checks',
      'all',
      '--junit-xml',
      '-',
    ];
    const outcome = await runScannerInDocker({
      scanner: this,
      executor: this.executor,
      context,
      command,
      nonZeroIsSuccess: true,
    });
    if (!outcome.ok) return outcome.result;
    try {
      const findings = this.parseOutput(outcome.stdout);
      return withFindings(outcome, findings);
    } catch (err) {
      const message = err instanceof ParseError ? err.message : String(err);
      return { ...outcome.result, success: false, error: `parse failure: ${message}` };
    }
  }

  public parseOutput(raw: string): readonly NormalizedFinding[] {
    if (raw.trim() === '') return [];

    const root = parseXml(raw, this.name) as JUnitRoot;

    // Normalize the top-level envelope — JUnit may wrap in <testsuites> or place a single <testsuite> at root.
    const topLevelSuites: JUnitTestSuite[] = [];
    if (root.testsuites !== undefined) {
      const outer = root.testsuites;
      if (typeof outer === 'object' && 'testsuite' in outer) {
        for (const s of toArray(outer.testsuite)) topLevelSuites.push(s);
      } else {
        topLevelSuites.push(outer as JUnitTestSuite);
      }
    }
    for (const s of toArray(root.testsuite)) topLevelSuites.push(s);

    const findings: NormalizedFinding[] = [];
    for (const suite of topLevelSuites) {
      for (const testcase of collectTestCases(suite)) {
        const failures = [...toArray(testcase.failure), ...toArray(testcase.error)];
        if (failures.length === 0) continue;

        const endpoint = testcase.name ?? testcase.classname ?? 'unknown';
        for (const failure of failures) {
          const description = failureText(failure);
          findings.push({
            scanner: this.name,
            fingerprint: shortHash(`schemathesis:${endpoint}:${failure.type ?? ''}`),
            title: `API check failed: ${endpoint}`,
            description,
            severity: 'MEDIUM',
            category: 'api',
            normalizedScore: 0,
            endpoint,
          });
        }
      }
    }

    return findings;
  }

  public isAvailable(): Promise<boolean> {
    return Promise.resolve(true);
  }
}
