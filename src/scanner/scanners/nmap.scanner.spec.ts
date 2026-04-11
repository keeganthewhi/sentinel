import { describe, expect, it } from 'vitest';
import { NmapScanner } from './nmap.scanner.js';
import { ScannerRegistry } from '../scanner.registry.js';
import { PHASE2_SCANNERS, PHASE1_SCANNERS } from './index.js';

const scanner = new NmapScanner();

describe('NmapScanner.parseOutput', () => {
  it('emits a finding for each open port', () => {
    const raw = `<?xml version="1.0"?>
<nmaprun scanner="nmap" version="7.94">
  <host>
    <address addr="192.0.2.10" addrtype="ipv4"/>
    <ports>
      <port protocol="tcp" portid="22">
        <state state="open" reason="syn-ack"/>
        <service name="ssh" version="OpenSSH 9.0"/>
      </port>
      <port protocol="tcp" portid="80">
        <state state="open" reason="syn-ack"/>
        <service name="http" product="nginx" version="1.24.0"/>
      </port>
      <port protocol="tcp" portid="443">
        <state state="closed" reason="reset"/>
      </port>
    </ports>
  </host>
</nmaprun>`;
    const findings = scanner.parseOutput(raw);
    expect(findings).toHaveLength(2);
    expect(findings[0]?.endpoint).toBe('192.0.2.10:tcp/22');
    expect(findings[0]?.category).toBe('network');
    expect(findings[0]?.severity).toBe('INFO');
    expect(findings[0]?.title).toContain('ssh');
    expect(findings[1]?.endpoint).toBe('192.0.2.10:tcp/80');
    expect(findings[1]?.description).toContain('nginx');
  });

  it('handles a host with a single port (object, not array)', () => {
    const raw = `<?xml version="1.0"?>
<nmaprun>
  <host>
    <address addr="10.0.0.1" addrtype="ipv4"/>
    <ports>
      <port protocol="tcp" portid="22">
        <state state="open"/>
        <service name="ssh"/>
      </port>
    </ports>
  </host>
</nmaprun>`;
    expect(scanner.parseOutput(raw)).toHaveLength(1);
  });

  it('handles multiple hosts', () => {
    const raw = `<?xml version="1.0"?>
<nmaprun>
  <host>
    <address addr="10.0.0.1" addrtype="ipv4"/>
    <ports><port protocol="tcp" portid="22"><state state="open"/><service name="ssh"/></port></ports>
  </host>
  <host>
    <address addr="10.0.0.2" addrtype="ipv4"/>
    <ports><port protocol="tcp" portid="80"><state state="open"/><service name="http"/></port></ports>
  </host>
</nmaprun>`;
    const findings = scanner.parseOutput(raw);
    expect(findings).toHaveLength(2);
    expect(findings.map((f) => f.endpoint)).toEqual(['10.0.0.1:tcp/22', '10.0.0.2:tcp/80']);
  });

  it('returns [] on empty input', () => {
    expect(scanner.parseOutput('')).toEqual([]);
  });

  it('name/phase/requiresUrl are correct', () => {
    expect(scanner.name).toBe('nmap');
    expect(scanner.phase).toBe(2);
    expect(scanner.requiresUrl).toBe(true);
  });
});

describe('ScannerRegistry for Phase 2 (integration)', () => {
  it('registers all 3 Phase-2 scanners in order', () => {
    const registry = new ScannerRegistry();
    for (const scanner of PHASE1_SCANNERS) registry.register(scanner);
    for (const scanner of PHASE2_SCANNERS) registry.register(scanner);
    const phase2 = registry.forPhase(2);
    expect(phase2.map((s) => s.name)).toEqual(['nuclei', 'schemathesis', 'nmap']);
  });
});
