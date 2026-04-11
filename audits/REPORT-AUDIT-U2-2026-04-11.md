# REPORT — U2 Security Audit Round 1 (STRIDE)

**Date**: 2026-04-11
**Phase**: U (Production Readiness)
**SM**: SM-58
**Auditor**: build-time agent (Sentinel Phase U round 1)

## 1. Method

STRIDE threat-by-threat walkthrough against the Sentinel codebase. Each
threat carries the source files where mitigation lives, evidence (file
paths and grep commands), and an explicit accept/mitigate/open status.

## 2. STRIDE Matrix

### S — Spoofing

| Threat | Mitigation | Status |
|--------|------------|--------|
| Impersonate scanner output to manipulate findings | Zod schema validation at every parser boundary; raw `JSON.parse` result narrowed within 5 lines | MITIGATED |
| Impersonate governor CLI to inject malicious decisions | Three Zod schemas (`SCAN_PLAN_SCHEMA`, `EVALUATION_SCHEMA`, `REPORT_SCHEMA`) validate every governor response. Hallucinated citations verified against real fingerprint set | MITIGATED |
| Spoof scan id to write into another scan's workspace | All persistence queries scoped by `scanId`; workspace dir derived from `scanId` only inside the orchestrator that owns it | MITIGATED |

### T — Tampering

| Threat | Mitigation | Status |
|--------|------------|--------|
| Tamper with scanner image at runtime | Image is content-addressable via Docker tag; every binary pinned to a known release in `docker/scanner.Dockerfile`; image runs as non-root `scanner` user | MITIGATED |
| Tamper with workspace files mid-scan | Workspace mounted read-only into the scanner container (`-v <repo>:/workspace:ro` in `src/execution/docker.executor.ts:buildDockerArgs`) | MITIGATED |
| Tamper with governor output to bypass severity normalization | Severity normalizer is mechanical and pure; the governor can suggest overrides via `adjustSeverity` but the value enum is enforced by Zod | MITIGATED |
| Tamper with migration files | Initial migration committed to git; CLAUDE.md Critical Invariant #12 prohibits edits | MITIGATED |

### R — Repudiation

| Threat | Mitigation | Status |
|--------|------------|--------|
| Operator denies that a scan ran | Every scan persists a `Scan` row with `startedAt` + `completedAt`; every governor decision is append-only with input + output JSON | MITIGATED |
| Operator denies what the governor decided | `GovernorDecisionRepository` is append-only — no `update()` method exposed | MITIGATED |

### I — Information Disclosure

| Threat | Mitigation | Status |
|--------|------------|--------|
| TruffleHog raw secret leaked through logs / DB / report / governor | Redacted to `[REDACTED:<shortHash>]` in the parser BEFORE any NormalizedFinding is constructed (`src/scanner/scanners/trufflehog.scanner.ts`); test asserts via JSON-stringify-search across the entire findings array | MITIGATED |
| `authentication.token` leaked through logger / `ConfigService.toString()` | pino redaction list includes `authentication.token`; `ConfigService.toString()` replaces token with `[REDACTED]` | MITIGATED |
| Governor prompt leaks `Raw` field of any finding via the previousDecisions blob | Deep `redact()` in `src/governor/governor.prompts.ts` walks every nested object/array and replaces any key literally named `Raw` or `raw` with `[REDACTED]` BEFORE JSON.stringify | MITIGATED |
| Scanner stderr written to terminal exposing secrets | Stderr captured into `ScannerResult.error` only on failure; only logged at WARN level when present; never echoed verbatim except with `--verbose` | MITIGATED |
| Cross-scan workspace leakage | Workspace dir derived from `scanId` only; every repository query scoped by `scanId` | MITIGATED |

### D — Denial of Service

| Threat | Mitigation | Status |
|--------|------------|--------|
| Scanner subprocess hangs forever | `DockerExecutor.run()` enforces `timeoutMs` via `AbortController`; default 30 minutes per scan | MITIGATED |
| Governor CLI hangs forever | `agent-adapter.ts` enforces 5-minute hard timeout; on timeout → `GovernorTimeoutError` → mechanical fallback | MITIGATED |
| Nuclei output explosion fills the database | `phase-run.repository.ts:complete()` truncates `rawOutput` to 5 MB; any excess replaced with `[TRUNCATED]` | MITIGATED |
| Per-scanner failure cancels the whole pipeline | Phase runner uses `Promise.allSettled` and converts rejections into per-scanner failure results | MITIGATED |

### E — Elevation of Privilege

| Threat | Mitigation | Status |
|--------|------------|--------|
| Scanner container escapes to host | Container runs as non-root `scanner` user; workspace mounted read-only; no Docker socket mounted | MITIGATED |
| `./sentinel start` with attacker-controlled `--repo` triggers path traversal | Path is mounted into the container by Docker (which canonicalizes); the repo path never reaches a shell argument string. Worst case: scan a different repo than expected, no host escalation | MITIGATED |
| Command injection via scanner argv | Every `spawn` call uses argv array form; `buildDockerArgs` and `agent-adapter.runCli` never construct shell strings | MITIGATED |
| Governor reads attacker-controlled `.env` and exfiltrates secrets | Governor receives only typed inputs through `governor.prompts.ts`; no file system reads in the governor; `.env` is `.gitignore`d and never enters a prompt | MITIGATED |

## 3. Specific Threat Walkthroughs

### 3.1 Prompt Injection (THREATS.md T-T3)

The structural defense is documented in CLAUDE.md Critical Invariant #6:
`governor.prompts.ts` is the SOLE payload constructor. Verified by:

```
$ grep -rn "buildScanPlanPrompt\|buildEvaluationPrompt\|buildReportPrompt" src/
src/governor/governor.prompts.ts:62:export function buildScanPlanPrompt
src/governor/governor.prompts.ts:104:export function buildEvaluationPrompt
src/governor/governor.prompts.ts:114:export function buildReportPrompt
src/governor/plan-generator.ts:14:import { buildScanPlanPrompt
src/governor/phase-evaluator.ts:13:import { buildEvaluationPrompt
src/governor/report-writer.ts:13:import { buildReportPrompt
```

Only the three governor consumers and the source file itself reference these
builders. Scanner-derived data enters as JSON-encoded user content under
`<<<USER_CONTENT:label>>>` blocks; the system layer is the static
`governor-templates/CLAUDE.md` file loaded once at module init.

### 3.2 Command Injection via Scanner Arguments

`buildDockerArgs` (in `src/execution/docker.executor.ts`) constructs an argv
array — every element is a separate string passed to `child_process.spawn`.
Test `docker.executor.spec.ts` verifies that even adversarial-looking
strings (e.g., `"; rm -rf /"`) pass through as a single argv element with
no shell interpretation.

### 3.3 Path Traversal on `--repo`

`./sentinel start --repo /etc/passwd` is harmless: the bash bootstrap script
mounts the path read-only into a non-privileged scanner container; the
container can read `/workspace` but cannot write back. Worst case: the user
scans the wrong files. No code paths construct OS-level paths from user
input outside the Docker mount.

### 3.4 Secret Leakage in Logs

Pino redaction list:

```typescript
'authentication.token',
'*.authentication.token',
'config.authentication.token',
'*.rawOutput',
'rawOutput',
'*.evidence.raw',
'evidence.raw',
'*.inputJson',
'inputJson',
'*.outputJson',
'outputJson',
'*.prompt',
'prompt',
'*.response',
'response',
```

Plus the upstream parser-level redaction in `trufflehog.scanner.ts`. Two layers
of defense.

### 3.5 Scanner Binary Tampering

The scanner image pins every binary to a fixed release. The Dockerfile is in
git. A bad-actor scenario where the image is replaced on Docker Hub is
mitigated by the fact that Sentinel BUILDS the image locally from the
committed Dockerfile rather than pulling a pre-built image.

## 4. Open Issues

**None.** Every STRIDE category has documented mitigations with
file-level evidence.

**Status**: U2 COMPLETE.
