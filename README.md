# Sentinel

> **Unified Application Security Testing Platform** — a self-hosted, open-source security scanning orchestrator that chains seven specialized security tools through a mechanical BullMQ pipeline with an optional AI governor layer.

[![Status](https://img.shields.io/badge/status-v0.1.1-blue)](https://github.com/keeganthewhi/sentinel/releases/tag/v0.1.1)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

---

## North Star UX

```bash
git clone https://github.com/keeganthewhi/sentinel.git
cd sentinel
./sentinel start --repo /path/to/your/code
```

That's it. The bash bootstrap script handles `pnpm install`, Docker, Redis, the scanner image build, Prisma client generation, and database migration. The first run takes a few minutes (scanner image + nuclei templates); subsequent runs are seconds.

To enable the AI governor layer, pass `--governed`:

```bash
./sentinel start --repo /path/to/your/code --governed
```

Sentinel auto-detects the first available AI CLI on your PATH in this order: **Claude Code → Cursor → Codex → Gemini**. Override with `SENTINEL_GOVERNOR_CLI=cursor` (or any of the four) if you want a specific vendor.

## What Sentinel Is

Sentinel chains nine security tools into a single coherent pipeline:

| Phase | Scanner | Purpose | Upstream |
|-------|---------|---------|----------|
| 1 | **Trivy** | SCA, secrets, IaC | https://github.com/aquasecurity/trivy |
| 1 | **Semgrep** | SAST + taint analysis | https://github.com/semgrep/semgrep |
| 1 | **TruffleHog** | Secret scanning over git history | https://github.com/trufflesecurity/trufflehog |
| 1 | **Subfinder** | Passive subdomain discovery | https://github.com/projectdiscovery/subfinder |
| 1 | **httpx** | HTTP endpoint probing | https://github.com/projectdiscovery/httpx |
| 2 | **Nuclei** | Template-based vuln scanning | https://github.com/projectdiscovery/nuclei |
| 2 | **Schemathesis** | OpenAPI fuzzer | https://github.com/schemathesis/schemathesis |
| 2 | **Nmap** | Port scan + service detection | https://github.com/nmap/nmap |
| 3 | **Shannon** | AI-powered DAST exploitation (optional) | https://github.com/keeganthewhi/shannon-noapi |

A mechanical correlation engine deduplicates findings across scanners and a severity normalizer applies consistent rules. The optional AI governor layer reads results and makes four decisions: what to scan, what to escalate, what to discard, and how to report.

## Two Modes

### Lite Mode (default — zero config beyond Docker)

```bash
./sentinel start --repo /path/to/code
```

- SQLite (`file:./data/sentinel.db`)
- Auto-managed Redis container (`sentinel-redis`)
- Mechanical pipeline only (no AI)
- Template-based markdown report

### Governed Mode (teams + AI overseer)

```bash
./sentinel start --repo /path/to/code --url https://staging.example.com --governed
```

- AI governor enabled via `--governed`
- **Vendor-agnostic**: works with Claude Code, Cursor, Codex, or Gemini — whichever CLI is on your PATH
- Four governor decisions per scan:
  1. **Scan plan** (before Phase 1) — AI reads the repo digest + package.json, writes a per-scan BLUEPRINT.md
  2. **Phase 1 evaluation** — AI reads static-scan findings, decides what to escalate / discard / re-severity
  3. **Phase 2 evaluation** — AI reads dynamic-scan findings, same pattern
  4. **Report writer** (end of scan) — AI authors the final markdown with fingerprint-verified citations
- Every governor failure falls back to the mechanical path automatically — the scan never blocks on AI
- Full audit trail in `workspaces/<scan-id>/deliverables/governor-decisions.json`

Adding `--shannon` enables the optional Phase 3 exploitation step against governor-escalated targets (requires an authenticated AI CLI).

## Commands

```bash
./sentinel doctor                          # verify host toolchain
./sentinel start --repo <path>             # mechanical scan
./sentinel start --repo <path> --governed  # AI-governed scan
./sentinel history                         # past scans
./sentinel report <scan-id>                # render a saved report
./sentinel diff <baseline-id> <current-id> # compare two scans
./sentinel stop                            # stop the redis container
./sentinel clean --yes                     # remove all sentinel state
```

## Architecture

```
./sentinel start
     ▼
┌──────────────────────────────────────────────┐
│  Phase 1 (parallel via BullMQ)               │
│  Trivy · Semgrep · TruffleHog · Subfinder · httpx │
└──────────────┬───────────────────────────────┘
               ▼
┌──────────────────────────────────────────────┐
│  Phase 2 (parallel, needs Phase 1 context)   │
│  Nuclei · Schemathesis · Nmap                │
└──────────────┬───────────────────────────────┘
               ▼
┌──────────────────────────────────────────────┐
│  Phase 3 (optional, --shannon flag)          │
│  Shannon AI exploitation                     │
└──────────────┬───────────────────────────────┘
               ▼
┌──────────────────────────────────────────────┐
│  Phase 4: Mechanical aggregation             │
│  Fingerprint → dedup → render report         │
└──────────────────────────────────────────────┘
```

The optional AI governor sits above and watches; it never executes scanners (Critical Invariant #4 in `CLAUDE.md`).

## Stack

- **Runtime**: Node.js 22+, TypeScript strict mode
- **Framework**: NestJS 11
- **Queue**: BullMQ on Redis 7
- **Database**: SQLite via Prisma 7 (lite mode), PostgreSQL 16 (full mode)
- **Container**: Docker (fat scanner image with all 8 tools)
- **CLI**: Commander.js + bash bootstrap
- **Reports**: Markdown, JSON, PDF (pdfmake)
- **Governor (optional)**: Claude Code, Codex, or Gemini CLI subprocess

## Build From Source

```bash
git clone https://github.com/keeganthewhi/sentinel.git
cd sentinel
pnpm install
pnpm prisma:generate
pnpm prisma:migrate:deploy
pnpm build

# build the scanner image
docker build -t sentinel-scanner:latest -f docker/scanner.Dockerfile .

# run a scan
./sentinel start --repo /path/to/code
```

Quality gate:

```bash
pnpm typecheck && pnpm lint && pnpm test
```

## Project Status

**v0.1.1** — first end-to-end verified release.

- All 8 scanners wired to real DockerExecutor calls and producing real findings (first verified on a 44 MB NestJS monorepo: 41 findings including a HIGH-severity production secret).
- Governor layer wired into `PipelineService.run()`; `--governed` now actually invokes plan-generator / phase-evaluator / report-writer with mechanical fallback at every step.
- Four-CLI agent support (Claude Code / Cursor / Codex / Gemini) with auto-detection and Windows `.cmd`-aware spawn.
- Tolerant SQLite persistence — the mechanical pipeline works even without the `better-sqlite3` native binding (fresh Windows checkouts without MSVC build tools).
- Clean-clone bootstrap verified in a temp directory: `git clone && cd sentinel && ./sentinel start --repo X` works end-to-end.

Integration / E2E / performance tests are documented in `audits/REPORT-DEFERRED-TESTS-2026-04-11.md` and run by operators or CI.

## Contributing

Sentinel is a single-developer project with strict architectural rules in
`CLAUDE.md`. Read it before opening a PR. Critical invariants are
non-negotiable.

## License

[MIT](LICENSE) — Copyright (c) 2026 keeganthewhi.

## Related Projects

- **Shannon (fork)**: https://github.com/keeganthewhi/shannon-noapi
- **Shannon (upstream)**: https://github.com/KeygraphHQ/shannon
- **PrimaSpec**: https://primaspec.com — the governance pattern Sentinel follows
