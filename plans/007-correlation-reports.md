# Plan 007 — Phase F Correlation & Reports

> **Created**: 2026-04-11
> **Status**: IN_PROGRESS
> **Status Mark**: SM-28 .. SM-32 (Phase F)
> **Git SHA (start)**: 9655840
> **Depends on**: SM-27 (Phase E complete)

## Cold Start

- **Read first**: CLAUDE.md invariant #8 (fingerprint determinism); BLUEPRINT.md Phase F; AGENTS-full.md `AGF::Fingerprint`, `AGF::CorrelationEngine`, `AGF::SeverityNormalizer`, `AGF::MarkdownRenderer`, `AGF::PdfRenderer`.
- **Current state**: Pipeline executes scanners and collects findings but does not deduplicate or render reports.
- **Expected end state**: `fingerprint(finding)` produces stable SHA-256; `CorrelationService.correlate(findings)` merges duplicates by fingerprint and marks non-primaries with `isDuplicate=true`; `SeverityNormalizer.normalize` boosts Semgrep taint traces, reduces Nuclei-only templates; markdown + JSON + PDF renderers produce valid reports.

## Aim

Fingerprint and correlate findings so the same CVE reported by Trivy and Semgrep collapses into one primary + one duplicate. Normalize severity mechanically. Emit reports in three formats.

## Steps

### Step 1: Deterministic fingerprint

- **File**: `src/correlation/fingerprint.ts` (NEW FILE)
- **Detail**: `fingerprint(finding: NormalizedFinding): string` — SHA-256 hex over `[cveId, filePath + lineNumber, endpoint + category, scanner + title]` joined by `\u0000`. Deterministic: same finding → same hash across runs. Property test with 1000 iterations asserts stability.
- **Constraint**: Non-determinism invalidates dedup, correlation, and regression detection — property test is mandatory.

### Step 2: Correlation service

- **File**: `src/correlation/correlation.service.ts` (NEW FILE)
- **Detail**: `@Injectable()` class. `correlate(findings)` groups by `fingerprint`, chooses the richest record (most non-empty optional fields) as primary, marks the rest via a derived `CorrelatedFinding` type that includes `isDuplicate`, `correlationId`, `supersedesScanners`. Does NOT mutate the input.

### Step 3: Severity normalizer

- **File**: `src/correlation/severity-normalizer.ts` (NEW FILE)
- **Detail**: Pure function `normalize(findings, context)` that applies the rules:
  - Shannon exploit confirmed (`exploitProof` present) → floor at HIGH
  - Semgrep with taint metadata → boost one level
  - Nuclei template match without exploit → reduce one level
  - Dependency CVE without reachability → keep as-is
- **Constraint**: Pure. Input not mutated. Governor (Phase H) can override in governed mode.

### Step 4: Markdown + JSON renderers

- **File**: `src/report/renderers/markdown.renderer.ts` (NEW FILE), `src/report/renderers/json.renderer.ts` (NEW FILE)
- **Detail**: Markdown renderer emits executive summary, severity breakdown, findings grouped by category, per-finding block with file:line, evidence (if already redacted), remediation, references. JSON renderer emits `{ summary, findings, scannerResults, durationMs }` as a stable shape.

### Step 5: PDF renderer (pdfmake)

- **File**: `src/report/renderers/pdf.renderer.ts` (NEW FILE)
- **Detail**: Uses `pdfmake` via a docDefinition builder. Includes TOC, severity badges, findings. Returns a `Buffer` (deferred — we return the docDefinition for unit testing; Phase J CLI wires the actual `pdfmake.createPdfKitDocument` to disk).
- **Constraint**: No network. No external fonts — use built-in Roboto or base fonts.

### Step 6: Correlation module + barrel + tests

- **File**: `src/correlation/correlation.module.ts`, `src/correlation/index.ts`, `src/report/report.module.ts`, `src/report/index.ts`, test files
- **Detail**: Module wiring. Tests for fingerprint determinism (1000 iter), correlation merge, severity normalization rules, markdown output structure, JSON output shape, PDF docDefinition structure.

### Step 7: Quality gate + commit + push + STATE update

## Acceptance Criteria

- [ ] `fingerprint(finding)` produces the same hash for 1000 iterations (property test)
- [ ] `correlate(findings)` collapses duplicate fingerprints into one primary + correlationId-linked duplicates
- [ ] `normalize` floors Shannon exploit findings at HIGH, boosts Semgrep taint one level, reduces Nuclei-only one level
- [ ] Markdown renderer produces valid GitHub-flavored markdown
- [ ] JSON renderer produces a stable shape parseable by the Prisma write layer (Phase G)
- [ ] PDF renderer returns a pdfmake docDefinition object
- [ ] Quality gate: 0 errors, 0 warnings
- [ ] STATE.md SMs 28–32 flipped; Phase F COMPLETE

## Security Checklist

- [ ] Fingerprint does NOT include secret values (TruffleHog raw is already redacted upstream)
- [ ] Reports do not leak secret values (evidence already redacted)
- [ ] No scanner output interpolated anywhere
- [ ] Markdown/JSON/PDF outputs escape or safely embed user-controlled strings
- [ ] Governor stays read-only — N/A
- [ ] Prisma scoped — N/A (Phase G)

## Test Requirements

- [ ] Fingerprint determinism: 1000-iteration property test
- [ ] Correlation: 2 findings with same fingerprint → 1 primary + 1 duplicate
- [ ] Correlation: 3 findings spanning 2 fingerprints → 2 primaries + 1 duplicate
- [ ] Severity normalizer: each rule tested in isolation
- [ ] Markdown renderer: emits all sections; no findings → "No findings" banner
- [ ] JSON renderer: output parses back via JSON.parse
- [ ] Coverage: `src/correlation/**` ≥ 95%, `src/report/renderers/**` ≥ 80%

## Execution Order

1 → 2 → 3 → 4 → 5 → 6 → 7

## Rollback

1. `git revert HEAD`
2. `rm -rf src/correlation src/report/renderers`

## Completion

1. Quality gate
2. `git add src/correlation src/report plans/007-correlation-reports.md package.json pnpm-lock.yaml`
3. Commit `[SM-28..32] phase-f: fingerprint + correlation + severity + renderers`
4. Push
5. STATE → Phase F COMPLETE, current_phase=G, current_step=SM-33

# Important Findings

(Append discoveries here as you work.)
