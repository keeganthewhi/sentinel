/**
 * Nmap scanner — port scan + service fingerprinting.
 *
 * Command: `nmap -sV --top-ports 1000 -oX - <host>`
 * Output: Nmap XML → parsed via `fast-xml-parser` with attribute prefix disabled.
 *
 * `fast-xml-parser` returns a single object for one host and an array for
 * multiple hosts; same for ports. The parser normalizes via `toArray()`.
 *
 * Severity: INFO by default (nmap is reconnaissance). Governor or correlation
 * may elevate severity based on exposed services.
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

function hostFromUrl(value: string): string | null {
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}

interface NmapService {
  readonly name?: string;
  readonly version?: string;
  readonly product?: string;
}

interface NmapState {
  readonly state?: string;
  readonly reason?: string;
}

interface NmapPort {
  readonly protocol?: string;
  readonly portid?: number | string;
  readonly state?: NmapState;
  readonly service?: NmapService;
}

interface NmapAddress {
  readonly addr?: string;
  readonly addrtype?: string;
}

interface NmapHost {
  readonly address?: NmapAddress | readonly NmapAddress[];
  readonly ports?: { port?: NmapPort | readonly NmapPort[] };
}

interface NmapRoot {
  readonly nmaprun?: { host?: NmapHost | readonly NmapHost[] };
}

function toArray<T>(value: T | readonly T[] | undefined): readonly T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value as T];
}

function primaryAddress(host: NmapHost): string | undefined {
  for (const addr of toArray(host.address)) {
    if (addr.addrtype === 'ipv4' || addr.addrtype === 'ipv6') {
      return addr.addr;
    }
  }
  return toArray(host.address)[0]?.addr;
}

export class NmapScanner extends BaseScanner {
  public readonly name = 'nmap';
  public readonly phase = 2 as const;
  public readonly requiresUrl = true;

  public async execute(context: ScanContext): Promise<ScannerResult> {
    const targets: string[] = [];
    if (context.targetUrl !== undefined) {
      const host = hostFromUrl(context.targetUrl);
      if (host !== null) targets.push(host);
    }
    for (const sub of context.discoveredSubdomains ?? []) {
      targets.push(sub);
    }
    if (targets.length === 0) {
      return {
        scanner: this.name,
        findings: [],
        rawOutput: '',
        executionTimeMs: 0,
        success: true,
        error: 'skipped: no hostnames to scan',
      };
    }
    const command = ['nmap', '-sV', '--top-ports', '1000', '-oX', '-', ...targets];
    const outcome = await runScannerInDocker({
      scanner: this,
      executor: this.executor,
      context,
      command,
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
    const root = parseXml(raw, this.name) as NmapRoot;
    const run = root.nmaprun;
    if (run === undefined) return [];
    const hosts = toArray(run.host);

    const findings: NormalizedFinding[] = [];
    for (const host of hosts) {
      const addr = primaryAddress(host);
      for (const port of toArray(host.ports?.port)) {
        if (port.state?.state !== 'open') continue;
        const protocol = port.protocol ?? 'tcp';
        const portid = port.portid ?? 'unknown';
        const endpoint = `${protocol}/${portid}`;
        const service = port.service;
        const serviceName = service?.name ?? 'unknown';
        const serviceProduct = service?.product;
        const serviceVersion = service?.version;
        const details = [serviceProduct, serviceVersion].filter((v) => v !== undefined).join(' ');
        const title = `Open port ${endpoint} (${serviceName})`;
        const description = details !== ''
          ? `${serviceName} ${details} on ${addr ?? 'unknown'}:${portid}`
          : `${serviceName} on ${addr ?? 'unknown'}:${portid}`;

        findings.push({
          scanner: this.name,
          fingerprint: shortHash(`nmap:${addr ?? ''}:${endpoint}`),
          title,
          description,
          severity: 'INFO',
          category: 'network',
          normalizedScore: 0,
          endpoint: `${addr ?? 'unknown'}:${endpoint}`,
        });
      }
    }

    return findings;
  }

  public isAvailable(): Promise<boolean> {
    return Promise.resolve(true);
  }
}
