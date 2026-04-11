/**
 * Schemathesis scanner — API fuzzer with JUnit XML output.
 *
 * Command: `schemathesis run --base-url <url> <spec> --checks all --junit-xml -`
 * Only runs when `context.openApiSpec` is set.
 *
 * JUnit XML is parsed via `parseXml` — handles both single-suite and nested
 * suites-of-suites forms. `fast-xml-parser` returns a plain object for
 * single-element nodes and an array for multi-element nodes; the parser
 * normalizes both cases via `toArray()`.
 */

import { parseXml, ParseError } from '../../execution/output-parser.js';
import { shortHash } from './fingerprint.helper.js';
import {
  BaseScanner,
  type ScanContext,
  type ScannerResult,
} from '../types/scanner.interface.js';
import type { NormalizedFinding } from '../types/finding.interface.js';
import { runScannerInDocker, withFindings } from './runner.helper.js';

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
    if (context.openApiSpec === undefined || context.targetUrl === undefined) {
      return {
        scanner: this.name,
        findings: [],
        rawOutput: '',
        executionTimeMs: 0,
        success: true,
        error: 'skipped: requires openApiSpec + targetUrl',
      };
    }
    // Schemathesis exits non-zero when checks fail; we want the JUnit XML either way.
    const command = [
      'schemathesis',
      'run',
      '--base-url',
      context.targetUrl,
      context.openApiSpec,
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
