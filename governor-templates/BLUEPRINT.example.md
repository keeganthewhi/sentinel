# Scan Plan — Example

> This file ships at `governor-templates/BLUEPRINT.example.md` and documents the canonical format the governor MUST emit when writing `workspaces/<scanId>/BLUEPRINT.md` during Decision 1.
>
> The values below are a worked example for a NestJS B2B SaaS scan — they are illustrative, not mandated content.

---

Target: https://staging.3yoto.com
Repo: /home/user/projects/ayarticaret (mounted read-only at /workspace)
Generated: 2026-04-11T14:30:00Z
Governor: claude (via SENTINEL_GOVERNOR_CLI)
Scan ID: sentinel-20260411-143000-abc123

## Tech Stack Detected

- Framework: NestJS 11 (TypeScript 5.6)
- ORM: Prisma 5
- Database: PostgreSQL 16
- Cache: Redis 7
- Queue: BullMQ
- Auth: JWT + role-based guards (custom)
- Frontend: Next.js 16 App Router
- Package Manager: pnpm
- Deployment: Docker Compose on VPS behind Cloudflare

## Attack Surface Priority

1. **Auth endpoints** — JWT issuance, refresh, role checks, password reset flow
2. **Payment callbacks** — Sanal POS integration (`/api/payments/*`)
3. **API endpoints with user input** — search, filters, CRUD (`/api/products`, `/api/orders`)
4. **Admin panel routes** — `/api/admin/*`
5. **File upload endpoints** — `/api/uploads/*`

## Scanner Plan

| Scanner      | Enabled | Config                                          | Reason                                                  |
|--------------|---------|------------------------------------------------|---------------------------------------------------------|
| Trivy        | yes     | `scanners=vuln,secret,misconfig`                | Check npm deps + Dockerfile + embedded secrets          |
| Semgrep      | yes     | `config=p/typescript,p/nodejs,p/jwt`            | NestJS + JWT auth = high-value SAST                     |
| TruffleHog   | yes     | `--only-verified`                               | Active secret verification; avoid false positives       |
| Subfinder    | yes     | `-d 3yoto.com`                                  | Map subdomains for staging vs prod separation           |
| httpx        | yes     | standard                                        | Confirm live endpoints and detect technologies          |
| Nuclei       | yes     | `templates=cves/,misconfiguration/,exposed-panels/` | Known vulns on discovered endpoints                  |
| Schemathesis | skip    | n/a                                            | No `openapi.json` / `swagger.json` found in repo         |
| Nmap         | yes     | `--top-ports 1000`                              | Service fingerprinting on staging host                  |
| Shannon      | conditional | Focus: auth bypass, payment flow, IDOR     | Triggered by escalations after Phase 1 + Phase 2        |

## Escalation Criteria (Governor will apply after Phase 1 / Phase 2)

- Any confirmed CVE with a reachable taint path → Shannon
- Any auth-related finding from Semgrep → Shannon
- Any CRITICAL from Nuclei → Shannon
- Payment-related endpoints with ANY finding → Shannon

## Discard Criteria (Governor will apply after Phase 1 / Phase 2)

- WordPress template matches (project is NestJS, not WordPress)
- Windows-specific CVEs (deployment is Linux only)
- CVEs in dev-only dependencies (scripts, test utilities) — unless CRITICAL

## Severity Adjustment Heuristics

- Trivy HIGH CVE + Semgrep taint path to the vulnerable function → upgrade to CRITICAL
- Nuclei HIGH template match without corroborating evidence → reduce to MEDIUM
- Shannon-confirmed exploit → floor at HIGH (cannot go below)

## Rationale

NestJS / Prisma / PostgreSQL B2B SaaS with JWT auth and payment integration. This is an auth-heavy codebase with a live staging URL — full mechanical coverage plus Shannon for high-confidence escalations is appropriate. Skipping Schemathesis because no OpenAPI spec was found; the team could provide one to enable deeper API fuzzing in future scans.

The tech stack is clearly in the TypeScript / Node ecosystem, so Semgrep rule packs are narrowed to TypeScript / Node / JWT to improve signal. Nuclei templates are the standard trio; we did not add niche template sets (`wordpress/`, `jira/`) because none of those technologies are in the stack.

Payment flows are the highest-impact attack surface — a bug in sanal POS callback verification is a revenue-loss event. Expect the evaluator to escalate payment-related findings aggressively.

---

## Notes for the Governor

The format above is the canonical layout. When writing `workspaces/<scanId>/BLUEPRINT.md` during Decision 1:

- Begin with the `Target`, `Repo`, `Generated`, `Governor`, `Scan ID` header.
- Include a `Tech Stack Detected` section — list what you inferred from the file tree and manifests.
- Include an `Attack Surface Priority` numbered list.
- Include the `Scanner Plan` table with one row per scanner in the AGENTS.md registry.
- Include `Escalation Criteria`, `Discard Criteria`, `Severity Adjustment Heuristics` as bullet lists.
- Conclude with a `Rationale` paragraph in plain English.

The companion JSON decision payload (returned to the pipeline) MUST match the JSON shape defined in `governor-templates/CLAUDE.md` under "Decision 1 — Scan Plan (JSON)".

---

*This example ships with Sentinel at `governor-templates/BLUEPRINT.example.md`. The per-scan generated file lives at `workspaces/<scanId>/BLUEPRINT.md`.*
