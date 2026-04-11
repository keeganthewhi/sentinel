# Scan State — Example

> This file ships at `governor-templates/STATE.example.md` and documents the canonical format the governor MUST use when writing `workspaces/<scanId>/STATE.md` during Decisions 2 + 3.
>
> The values below are a worked example for an in-progress governed scan — they are illustrative, not mandated content.

---

Scan ID: sentinel-20260411-143000-abc123
Status: RUNNING
Current Phase: 2
Governor: claude (via SENTINEL_GOVERNOR_CLI)
Started: 2026-04-11T14:30:00Z
Last updated: 2026-04-11T14:34:21Z

---

## Phase 1 — COMPLETED (53s)

| Scanner    | Status | Findings | Notes |
|-----------|--------|----------|-------|
| Trivy      | OK     | 12 (3 HIGH, 9 MEDIUM) | Dependencies + Dockerfile |
| Semgrep    | OK     | 8 (1 CRITICAL, 4 HIGH, 3 MEDIUM) | TypeScript + JWT rules |
| TruffleHog | OK     | 2 (2 HIGH — verified active) | AWS keys in git history |
| Subfinder  | OK     | — | 14 subdomains discovered |
| httpx      | OK     | — | 11 live endpoints confirmed |

### Governor Decision (Post Phase 1)

**Escalate to Shannon**:

1. Semgrep finding `a7b3c2f1e9d8` (JWT `ignoreExpiration: true` in `src/guards/jwt.guard.ts:42`)
   - Reason: Auth-related Semgrep finding with taint path; matches Escalation Criterion #2.
2. Semgrep finding `b4c2d9e8f1a7` (Unvalidated redirect in `src/controllers/auth.controller.ts:88`)
   - Reason: Public endpoint accepting user input; exploit path plausible.

**Discard**: 0 (no noise detected in Phase 1)

**Severity Adjustments**:

1. Trivy finding `c1e9d8a7b3c2` upgraded **HIGH → CRITICAL**
   - Reason: Reachable per Semgrep taint (CVE confirmed in `jsonwebtoken@8.5.1`, used by `src/guards/jwt.guard.ts:42`). Matches Severity Adjustment Heuristic #1.

**Notes**: Strong signal for auth bypass pattern. Two independent scanners confirm the same issue. Shannon will attempt auth bypass exploitation in Phase 3.

---

## Phase 2 — RUNNING (2m 14s elapsed)

| Scanner      | Status   | Findings | Notes |
|--------------|----------|----------|-------|
| Nuclei       | RUNNING  | — (in progress) | 2m elapsed, ~150 templates checked |
| Schemathesis | SKIPPED  | — | No OpenAPI spec found (documented in BLUEPRINT.md) |
| Nmap         | COMPLETED | 3 (1 HIGH, 2 INFO) | Top 1000 ports; 22/tcp, 443/tcp, 8080/tcp open |

---

## Phase 3 — PENDING

(Will only run when Phase 2 completes AND at least one escalation exists. Currently 2 escalations queued from Phase 1.)

---

## Phase 4 — PENDING

(Mechanical aggregation + governor report writer)

---

## Notes for the Governor

The format above is the canonical layout. When updating `workspaces/<scanId>/STATE.md` during Decisions 2 + 3:

- Update the header block (`Status`, `Current Phase`, `Last updated`).
- Mark the completed phase with ` — COMPLETED (Nm Ns)`.
- Update the per-scanner table with final Findings counts.
- Append a **Governor Decision** subsection with:
  - `Escalate to Shannon`: numbered list of `findingFingerprint` values with reasons.
  - `Discard`: count and list (if any).
  - `Severity Adjustments`: list of `findingFingerprint` values with old → new and reason.
  - `Notes`: one or two sentences summarizing patterns you noticed.
- Do NOT rewrite prior phases. Append, don't replace. STATE.md is append-only during a scan — the final form is the full history.
- Do NOT delete the header block or phase sections. The mechanical pipeline reads this file to track progress.

The companion JSON decision payload (returned to the pipeline and persisted in `GovernorDecision`) MUST match the JSON shape defined in `governor-templates/CLAUDE.md` under "Decision 2 + 3 — Phase Evaluation (JSON)".

---

*This example ships with Sentinel at `governor-templates/STATE.example.md`. The per-scan generated file lives at `workspaces/<scanId>/STATE.md`.*
