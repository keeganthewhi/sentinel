# Sentinel

> **Unified Application Security Testing Platform** — a self-hosted, open-source security scanning orchestrator that chains seven specialized security tools through a mechanical BullMQ pipeline with an optional AI governor layer.

[![Status](https://img.shields.io/badge/status-v0.1.0-blue)](https://github.com/keeganthewhi/sentinel/releases/tag/v0.1.0)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

---

## North Star UX

```bash
git clone https://github.com/keeganthewhi/sentinel.git
cd sentinel
./sentinel start --repo /path/to/your/code
```

That's it. The bash bootstrap script handles Docker, Redis, the scanner image, and the Prisma database. The first run takes a few minutes while the scanner image builds; subsequent runs are seconds.

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
- Selects scanners based on repo type
- Cross-scanner correlation
- AI-authored final report with file:line citations
- Falls back to mechanical path on any AI failure

Adding `--shannon` enables the optional Phase 3 exploitation step against governor-escalated targets.

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

**v0.1.0** — initial release. Mechanical pipeline + governor layer + Shannon integration all implemented and unit-tested. Integration / E2E / performance / governed-pipeline tests are documented in `audits/REPORT-DEFERRED-TESTS-2026-04-11.md` and run by operators or CI.

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
