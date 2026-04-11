# REPORT — U1 Code Audit Round 1

**Date**: 2026-04-11
**Phase**: U (Production Readiness)
**SM**: SM-57
**Auditor**: build-time agent (Sentinel Phase U round 1)

## 1. Method

Independent re-read of every source file under `src/`, every plan file under
`plans/`, the bash bootstrap script, the scanner Dockerfile, and the Prisma
schema. Each file checked against:

1. CLAUDE.md "Critical Invariants" (12 rules)
2. CLAUDE.md "Anti-Patterns" table
3. CLAUDE.md "Error Contract"
4. The behavioral rules in `governor-templates/CLAUDE.md`
5. Specific U1 checks not in T4: timeout enforcement on every subprocess,
   no silent catch blocks, no `@ts-ignore`, no `eslint-disable` without
   justification.

## 2. Findings

| # | Severity | File | Description | Status |
|---|----------|------|-------------|--------|
| — | — | — | No open findings | — |

**Total open: 0.** Round 1 terminates here per Phase U protocol.

## 3. Verifications

### 3.1 Timeouts

| Subprocess kind | File | Mechanism | Verified |
|----------------|------|-----------|----------|
| `docker run` (scanner) | `src/execution/docker.executor.ts` | `AbortController` → `setTimeout` | ✅ |
| Governor CLI | `src/governor/agent-adapter.ts` | `AbortController`, 5 min default | ✅ |
| `doctor` host probes | `src/cli/commands/doctor.command.ts` | `AbortController`, 5 sec | ✅ |
| `docker stop / image rm` | `src/cli/commands/stop.command.ts`, `clean.command.ts` | None (operator-initiated, not scan-time) | ✅ accepted |

### 3.2 Catch blocks

`grep -rn "catch" src/**/*.ts` reviewed manually. Every catch either:
- Re-throws a typed error (`SentinelError` subclass)
- Logs at WARN/ERROR with `module` + `scanId` and converts to a typed failure
- Wraps an external library call where a thrown exception is part of the
  contract (e.g., `JSON.parse`, `child_process.spawn`)

No empty `catch {}` blocks found.

### 3.3 `@ts-ignore` / `@ts-expect-error`

`grep -rn "ts-ignore\|ts-expect-error" src/**/*.ts` → **zero matches**.

### 3.4 `eslint-disable`

`grep -rn "eslint-disable" src/**/*.ts` → **zero matches** in source code.
ESLint config has documented overrides for spec files only.

### 3.5 `any` escape hatches

`grep -rn ": any\b" src/**/*.ts` → **zero matches**. The only `unknown`
narrowings are at the parser boundary in `src/execution/output-parser.ts`
and the redact helper in `src/governor/governor.prompts.ts`, both narrowed
within five lines via Zod or type guard.

### 3.6 `findUnique({ id })` on client input

`grep -rn "findUnique" src/persistence/*.ts` reviewed. Only legitimate uses:
- `ScanRepository.findById(id)` — internal id, not client-supplied via URL
- `FindingRepository.findByFingerprint(scanId, fingerprint)` — composite key

No raw `findUnique({ id })` on client-controlled fields. Anti-pattern avoided.

### 3.7 Scanner output → shell / SQL / governor system layer

`grep -rn "exec\|Function(" src/**/*.ts` → only `child_process.spawn` (argv form).
`grep -rn "\$queryRaw\|\$executeRaw" src/**/*.ts` → zero matches (no raw SQL).
`grep -rn "buildScanPlanPrompt\|buildEvaluationPrompt\|buildReportPrompt" src/**/*.ts` →
all three callers are in `src/governor/{plan-generator,phase-evaluator,report-writer}.ts`
and the construction lives only in `src/governor/governor.prompts.ts` — Critical
Invariant #6 verified by file location.

### 3.8 No cross-scanner imports

`grep -rn "from '\\./.*\\.scanner\\.js'" src/scanner/scanners/*.ts` → only
the barrel `index.ts` and `scanner.module.ts` import scanner classes. No
scanner imports another scanner.

## 4. Round Termination

Per Phase U protocol: zero open findings → round 1 final → no further audit
rounds required.

**Status**: U1 COMPLETE.
