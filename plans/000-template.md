# Plan {N} — {Title}

> **Copy this file to `plans/{NNN}-{slug}.md` for every new plan.**
> **NNN** is a zero-padded 3-digit number, sequential across ALL plans ever created — never reuse a number, even if the plan was abandoned.
> **slug** is kebab-case describing the change (e.g., `env-setup`, `trivy-scanner`, `fix-fingerprint-collision`).
>
> Every section below is MANDATORY. Do not delete a section — write `N/A — {reason}` if a section genuinely does not apply. BLUEPRINT.md enforces this at plan review time.

---

> **Created**: {YYYY-MM-DD}
> **Status**: IN_PROGRESS
> **Status Mark**: SM-{N}
> **Git SHA (start)**: {short sha, e.g., abc1234}
> **Depends on**: SM-{N-1} | N/A

## Cold Start

> Everything a fresh agent with zero context needs to resume this plan after compaction.

- **Read these files first** (in order):
  1. `CLAUDE.md` — behavioral contract
  2. `AGENTS.md` — domain knowledge
  3. `BLUEPRINT.md` — phase {letter} section for SM-{N}
  4. `AGENTS-full.md` — seek sections: `AGF::{Token1}`, `AGF::{Token2}`
  5. {any source file the plan will modify}
  6. {any prior plan file whose Important Findings matter here}
- **Current state**: {what the repo/project looks like before this plan runs}
- **Last agent action**: {what SM-{N-1} delivered that this plan builds on}
- **Expected state after this plan**: {concrete description of the world when SM-{N} is ticked}

## Aim

{1-3 sentences: what this plan accomplishes and why. No fluff. Reference the SM's acceptance criteria from BLUEPRINT.md.}

## Steps

> Numbered. Each step: Action verb title + File path (mark new files with `(NEW FILE)`) + Detail (with code snippets for anything non-trivial) + Constraint.

### Step 1: {Action verb} {what}

- **File**: `{exact/path/to/file.ts}` [optionally `(NEW FILE)`]
- **Detail**:
  ```typescript
  // Code snippet that another agent could copy-paste.
  // For non-trivial changes, include enough that there is no ambiguity.
  ```
- **Constraint**: {What MUST NOT be violated. Write "None" if no constraint — never omit this line.}

### Step 2: {Action verb} {what}

- **File**: `{path}`
- **Detail**: {description or snippet}
- **Constraint**: {constraint or "None"}

### Step 3: {Action verb} {what}

- **File**: `{path}`
- **Detail**: {description or snippet}
- **Constraint**: {constraint or "None"}

## Acceptance Criteria

> Checkbox list of objectively testable outcomes. Every criterion must be verifiable — if you can't check it succeeded, split it into two. Quality gate pass is ALWAYS required.

- [ ] {specific, testable outcome #1}
- [ ] {specific, testable outcome #2}
- [ ] {specific, testable outcome #3}
- [ ] `pnpm typecheck && pnpm lint && pnpm test` passes with 0 errors, 0 warnings
- [ ] STATE.md SM-{N} checkbox flipped from `[ ]` to `[x]`

## Security Checklist

> Every plan has a security checklist — even "boring" plans. Write `N/A — {reason}` if genuinely not applicable. NEVER omit this section.

- [ ] No scanner output interpolated into a shell command, SQL query, or governor system prompt
- [ ] No hardcoded paths, ports, image names, or scanner versions in source
- [ ] No secrets (tokens, keys, passwords) committed or logged
- [ ] Governor stays read-only (no `src/governor/*` file gains a `child_process` import)
- [ ] Scanner output parsed through typed parsers in `src/execution/output-parser.ts`
- [ ] TruffleHog raw secrets redacted to `[REDACTED:<fingerprint>]` before entering correlation
- [ ] Prisma queries scoped by `scanId` — no raw `findUnique(id)` on client-supplied IDs
- [ ] {plan-specific security check, or "N/A — {reason}"}

## Test Requirements

> Checkbox list: success case + failure cases + edge cases. For scanners: tool missing / tool crash / tool timeout / empty output / malformed output. For BullMQ workers: job retry / job failure / job timeout. For governor: AI timeout / AI invalid JSON / AI empty response.

- [ ] Success case: {happy path test name}
- [ ] Failure case: {failure test name}
- [ ] Edge case: {edge case test name}
- [ ] {plan-specific tests}
- [ ] Coverage: affected files ≥ 80% (≥ 95% if touching `src/correlation/`, `src/governor/`, or `src/execution/`)

## Execution Order

> Step sequence with rationale. `→` for sequential, `+` for parallel.

**Recommended**: 1 → 2 → 3 → 4
**Rationale**: {why this order — e.g., "Parser first (testable in isolation), then execute(), then wire into registry, then integration test."}

## Rollback

> How to undo this plan if it turns out to be wrong. Always reversible — if a step is non-reversible (column drop, data migration), document it explicitly.

1. `git revert HEAD` to undo the commit
2. {plan-specific rollback — e.g., "Remove `<scanner>` entry from `src/scanner/scanner.registry.ts`"}
3. {plan-specific rollback — e.g., "Run `pnpm prisma:migrate:reset` if a migration was applied"}
4. Update STATE.md: un-tick the SM-{N} checkbox, revert `last_git_sha` to {previous sha}

## Completion

> The fixed sequence that closes out every plan. Do NOT skip a step.

1. Run quality gate: `pnpm typecheck && pnpm lint && pnpm test`
2. Verify every Acceptance Criteria checkbox is truly satisfied (re-read them)
3. Verify every Security Checklist item is addressed (or N/A with reason)
4. `git add <specific files>` (NEVER `git add -A` — review what's being staged)
5. `git status` to verify no secrets or unwanted files are staged
6. Commit: `git commit -m "[SM-{N}] {module}: {imperative description}"`
7. `git push`
8. Update STATE.md: flip SM-{N} checkbox to `[x]`, advance `current_step`, update `last_git_sha`
9. For feature work: update FEATURES.md audit status
10. For Phase U work: append findings to `audits/round-N-findings.md`

# Important Findings

> **MANDATORY `#` heading at the very bottom of every plan file.** This section is the key to surviving context compaction — after compaction, re-read THIS section FIRST before resuming work.
>
> Start empty. Append entries as `- [Step N] {discovery}: {detail}` while you work.
>
> Record: library quirks, version gotchas, unexpected config needs, error causes, workarounds, "I tried X and it didn't work because Y", schema drift, output format surprises.

(Append discoveries here as you work.)
