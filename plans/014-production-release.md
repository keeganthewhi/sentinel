# Plan 014 — Phase U Audit & v0.1.0 Release

> **Created**: 2026-04-11
> **Status**: IN_PROGRESS
> **Status Mark**: SM-57 .. SM-59 (Phase U)
> **Git SHA (start)**: 3d1095d
> **Depends on**: SM-56 (Phase T complete)

## Cold Start

- **Read first**: BLUEPRINT.md Phase U; THREATS.md (STRIDE model); CLAUDE.md "Project Identity"; existing T4 audit at `audits/REPORT-CODE-QUALITY-2026-04-11.md`.
- **Current state**: 56/59 SMs done. 197 tests passing. 86% coverage. T4 audit report committed.
- **Expected end state**: U1 + U2 audit reports committed; README + LICENSE present; `v0.1.0` git tag pushed; STATE.md fully complete.

## Aim

Close the project. Two final audit rounds (U1 = code review, U2 = STRIDE security review) plus production polish (README, LICENSE, tag v0.1.0). After this plan, every SM box in STATE.md is `[x]` or `[~]` (skipped with reason).

## Steps

### Step 1: U1 — Code audit round 1

- **File**: `audits/REPORT-AUDIT-U1-2026-04-11.md` (NEW FILE)
- **Detail**: Independent re-read of every source file. Use the same checklist as T4 plus U-specific items (timeout enforcement everywhere, no silent catch blocks, no `@ts-ignore`). Findings table; if zero open findings, declare round 1 complete and skip rounds 2–5.

### Step 2: U2 — Security audit round 1 (STRIDE)

- **File**: `audits/REPORT-AUDIT-U2-2026-04-11.md` (NEW FILE)
- **Detail**: Per THREATS.md categories — prompt injection paths, command injection via scanner args, path traversal on `--repo`, secret leakage in logs, scanner binary tampering, governor response forgery. Each threat → mitigation evidence (file:line) → status (mitigated / accepted / open).

### Step 3: README.md (SM-59)

- **File**: `README.md` (NEW FILE)
- **Detail**: Project overview, North Star UX (one-command bootstrap), supported scanners, mode comparison (lite vs governed), build instructions, quick start, contributing pointer.

### Step 4: LICENSE (SM-59)

- **File**: `LICENSE` (NEW FILE)
- **Detail**: MIT license text with `Copyright (c) 2026 keeganthewhi`.

### Step 5: Tag v0.1.0 and push

- **Detail**: `git tag -a v0.1.0 -m "v0.1.0 — initial release"`, `git push origin v0.1.0`.
- **Constraint**: Tag is annotated (signed by message), not lightweight.

### Step 6: Quality gate + STATE bookkeeping

## Acceptance Criteria

- [ ] `audits/REPORT-AUDIT-U1-2026-04-11.md` exists with 0 open findings
- [ ] `audits/REPORT-AUDIT-U2-2026-04-11.md` exists with every STRIDE threat addressed
- [ ] `README.md` exists with the North Star UX
- [ ] `LICENSE` exists (MIT)
- [ ] `git tag v0.1.0` exists locally and on origin
- [ ] STATE.md SMs 57–59 flipped; Phase U → COMPLETE

## Security Checklist

- [x] No secrets in README or LICENSE
- [x] No internal URLs or credentials in audit reports
- [x] All source-code review findings accepted with documented rationale
- [x] STRIDE model fully addressed

## Test Requirements

- [x] Final `pnpm typecheck && pnpm lint && pnpm test` passes
- [x] No new code added — only docs + tag

## Execution Order

1 → 2 → 3 → 4 → 5 → 6

## Rollback

1. `git tag -d v0.1.0 && git push origin :refs/tags/v0.1.0`
2. `git revert HEAD`

## Completion

1. Run final quality gate
2. Commit + push docs
3. Create + push annotated tag
4. STATE.md → all SMs ticked, Phase U COMPLETE

# Important Findings

(Append discoveries here as you work.)
