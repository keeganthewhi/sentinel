# Plan 005 — Phase D Phase 2 Scanners

> **Created**: 2026-04-11
> **Status**: IN_PROGRESS
> **Status Mark**: SM-20 .. SM-22 (Phase D)
> **Git SHA (start)**: 6e04d5e
> **Depends on**: SM-19 (Phase C complete)

## Cold Start

- **Read first**: CLAUDE.md invariants #3, #5; BLUEPRINT.md Phase D; AGENTS-full.md `AGF::NucleiScanner` `AGF::SchemathesisScanner` `AGF::NmapScanner`.
- **Current state**: Phase 1 scanners complete. ScannerRegistry populated on module init. `parseXml` helper available.
- **Expected end state**: Three Phase-2 scanner classes (`NucleiScanner`, `SchemathesisScanner`, `NmapScanner`) with pure parsers and unit tests. All registered by `ScannerModule.onModuleInit`. Phase 2 scanners depend on Phase 1 output via `ScanContext.discoveredEndpoints` / `discoveredSubdomains`.

## Aim

Implement Nuclei (template-based vuln scanning), Schemathesis (API fuzzer with JUnit XML output), and Nmap (port scan with XML output). Nuclei parses JSONL, Schemathesis parses JUnit XML, Nmap parses nmap XML — exercising each of the three parser families from SM-13.

## Steps

### Step 1: Nuclei scanner (SM-20)

- **File**: `src/scanner/scanners/nuclei.scanner.ts` (NEW FILE)
- **Detail**: JSONL parser. Record shape: `{ template-id, info: { name, severity, description, tags }, matched-at, type, extractor-name? }`. Severity map: `critical→CRITICAL, high→HIGH, medium→MEDIUM, low→LOW, info→INFO, unknown→INFO`. Category: `dast`. `matched-at` becomes the `endpoint` field. Command: `nuclei -jsonl -silent -t <templates> -u <url> -rate-limit <N>`. Progress output on stderr is NOT a crash indicator.
- **Constraint**: Rate limit from context takes precedence; never override governor-set values.

### Step 2: Schemathesis scanner (SM-21)

- **File**: `src/scanner/scanners/schemathesis.scanner.ts` (NEW FILE)
- **Detail**: JUnit XML parser via `parseXml`. `testsuite.testcase[]` with `failure` children → findings. `endpoint` = `testcase.name`. Severity: failed testcases → MEDIUM by default. Category: `api`. Command: `schemathesis run --base-url <url> <spec> --checks all --junit-xml -`. Skips cleanly when `context.openApiSpec` is undefined.
- **Constraint**: Must tolerate JUnit variations (single suite vs suites-of-suites). fast-xml-parser returns objects or arrays depending on cardinality — handle both.

### Step 3: Nmap scanner (SM-22)

- **File**: `src/scanner/scanners/nmap.scanner.ts` (NEW FILE)
- **Detail**: Nmap XML parser via `parseXml`. `nmaprun.host[].ports.port[]` with `state.state === 'open'` → findings. Endpoint: `<protocol>/<portid>`. Service: `service.name + service.version`. Severity: `INFO` by default (nmap is reconnaissance, not vuln detection — severity is assigned by correlation or governor). Category: `network`. Command: `nmap -sV --top-ports 1000 -oX - <host>`.
- **Constraint**: fast-xml-parser returns a single object when there's one `host` element, and an array when there are multiple. Handle both via `toArray()` helper.

### Step 4: Register Phase 2 scanners

- **File**: `src/scanner/scanners/index.ts` (MODIFY)
- **Detail**: Export all three new scanner classes. Add `PHASE2_SCANNERS` array containing `[new NucleiScanner(), new SchemathesisScanner(), new NmapScanner()]`. Update `src/scanner/scanner.module.ts` to register PHASE2_SCANNERS in addition to PHASE1_SCANNERS.

### Step 5: Tests

- **File**: `src/scanner/scanners/nuclei.scanner.spec.ts`, `schemathesis.scanner.spec.ts`, `nmap.scanner.spec.ts` (3 NEW FILES)
- **Detail**: Parser fixtures for each scanner. Nmap test: `ScannerRegistry.forPhase(2)` returns all three in order. Nuclei: severity mapping + endpoint population. Schemathesis: testcase with `failure` element → finding. Nmap: ports.port array vs single object handling.

### Step 6: Quality gate + commit + push + STATE update

## Acceptance Criteria

- [ ] All 3 scanner classes extend BaseScanner with `phase: 2`
- [ ] Nuclei JSONL parser handles severity mapping + matched-at → endpoint
- [ ] Schemathesis skips cleanly when `openApiSpec` is undefined; JUnit parser extracts failures
- [ ] Nmap XML parser handles single-host and multi-host output
- [ ] `ScannerRegistry.forPhase(2).length === 3` after module init
- [ ] Quality gate: 0 errors, 0 warnings, all tests pass
- [ ] STATE.md SMs 20–22 flipped; Phase D → COMPLETE

## Security Checklist

- [ ] Nuclei output parsed through Zod; no shell interpolation
- [ ] Schemathesis XML parsed through parseXml; no XXE (fast-xml-parser does not resolve external entities)
- [ ] Nmap XML parsed through parseXml
- [ ] No hardcoded scanner versions or templates in TS source
- [ ] Governor stays read-only — N/A
- [ ] Prisma scoped — N/A
- [ ] No secrets — N/A

## Test Requirements

- [ ] Nuclei: fixture with 1 CVE template match → 1 finding with correct severity
- [ ] Nuclei: empty input → []
- [ ] Schemathesis: fixture with 1 failure testcase → 1 finding; empty testsuite → []
- [ ] Nmap: fixture with 2 open ports on 1 host → 2 findings; `ports.port` as object vs array
- [ ] Registry: `forPhase(2).length === 3`
- [ ] Coverage: `src/scanner/scanners/nuclei|schemathesis|nmap` ≥ 80%

## Execution Order

**Recommended**: 1 → 2 → 3 → 4 → 5 → 6
**Rationale**: Scanners in registry order, module wiring after, tests last, gate + commit.

## Rollback

1. `git revert HEAD`
2. `rm src/scanner/scanners/{nuclei,schemathesis,nmap}.scanner{,.spec}.ts`
3. Revert `scanner.module.ts` and `scanners/index.ts`
4. Un-tick STATE.md SM-20..22

## Completion

1. Quality gate
2. `git add src/scanner plans/005-phase2-scanners.md`
3. Commit `[SM-20..22] phase-d: nuclei + schemathesis + nmap scanners`
4. Push
5. Update STATE.md → Phase D COMPLETE, current_phase=E, current_step=SM-23

# Important Findings

(Append discoveries here as you work.)
