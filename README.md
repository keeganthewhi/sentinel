# Sentinel

> **Unified Application Security Testing Platform** — a self-hosted, open-source security scanning orchestrator that chains nine specialized security tools through a mechanical pipeline with an AI governor layer. One command, zero config, full pentest.

[![Status](https://img.shields.io/badge/status-v0.1.3-blue)](https://github.com/keeganthewhi/sentinel/releases/tag/v0.1.3)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

---

## How It Works

```bash
git clone https://github.com/keeganthewhi/sentinel.git
cd sentinel
./sentinel start --repo /path/to/your/code --governed
```

That's it. One command. The report lands in your repo as **`SENTINEL_REPORT.md`**.

Everything is automatic:
- Installs dependencies, builds TypeScript, generates Prisma client
- Starts Redis + Temporal containers
- Clones and builds [Shannon](https://github.com/keeganthewhi/shannon-noapi) (the AI pentest engine)
- Builds the fat scanner Docker image (Trivy + Semgrep + TruffleHog + Nuclei + Nmap + httpx + Subfinder + Schemathesis)
- Runs all 9 scanners across 3 phases in parallel Docker containers
- AI governor evaluates every finding, discards noise, escalates real threats
- Shannon runs a full 5-phase AI penetration test (code analysis → recon → vulnerability analysis → exploitation → report)
- Writes the final AI-authored security report to your repo root

### No API Keys Required

Sentinel uses **your existing AI subscription** — Claude Max/Pro, ChatGPT Plus/Pro, or Google Gemini. It auto-detects whichever CLI is logged in on your machine (`claude`, `codex`, or `gemini`) and uses it directly. Shannon runs inside Docker and authenticates through the same CLI subscription. **Zero API keys, zero per-token charges, zero configuration.**

### What You Get

After the scan, your repo has:

```
your-repo/
├── SENTINEL_REPORT.md          ← AI-authored security report (the deliverable)
├── src/
├── package.json
└── ...
```

The report is a complete security assessment with:
- Executive summary with prioritized action items
- Critical/High/Medium/Low findings with evidence
- Shannon-confirmed exploitation results (if vulnerabilities were found)
- Per-finding remediation guidance
- Governor decision rationale (what was discarded and why)

## Real Example

We ran Sentinel against [Ayarticaret](https://github.com/keeganthewhi/ayarticaret), a 50 MB Turkish B2B e-commerce monorepo (NestJS + Next.js + Prisma). From a completely fresh `git clone`:

| Step | Time |
|------|------|
| Bootstrap (install + build + Shannon clone + Docker images) | ~8 min (first run only) |
| Phase 1: Trivy + Semgrep + TruffleHog (parallel) | 2.5 min |
| Governor AI decisions | ~10 min |
| Phase 3: Shannon 5-phase AI pentest | 87 min |
| **Total** | **~110 min** |

**Result**: 198 findings. 3 critical (production secrets + Axios RCE chain + Shannon-confirmed authorization bypass). AI-authored `SENTINEL_REPORT.md` dropped into the repo root.

## Two Modes

### Normal (mechanical, zero AI)

```bash
./sentinel start --repo /path/to/code
./sentinel start --repo /path/to/code --url https://staging.app    # + live target
```

Runs Phases 1+2 only. No AI, no Shannon, no cost. Template-based markdown report.

### Governed (full AI + Shannon)

```bash
./sentinel start --repo /path/to/code --governed
./sentinel start --repo /path/to/code --url https://staging.app --governed
```

Single flag enables everything:
- 4 AI governor decisions (scan plan → evaluation → evaluation → report)
- Shannon's full 5-phase AI pentest pipeline (30 min to several hours depending on target size)
- Works **with or without `--url`** — Shannon runs code-only when no URL is given
- Every AI failure falls back to the mechanical path automatically

### With a Live Target

```bash
./sentinel start --repo /path/to/code --url https://staging.app --governed
```

This enables Phase 2 scanners against the live URL:
- **Subfinder** — passive subdomain discovery
- **httpx** — endpoint probing
- **Nuclei** — template-based vulnerability scanning
- **Nmap** — port scan + service detection
- **Schemathesis** — OpenAPI fuzzing (auto-discovers spec at `/openapi.json`, `/swagger.json`, etc.)

## The 9 Scanners

| Phase | Scanner | What It Does |
|-------|---------|--------------|
| 1 | **Trivy** | Dependency CVEs, secrets in files, IaC misconfigurations |
| 1 | **Semgrep** | Static analysis — injection, XSS, auth flaws, 2400+ rules |
| 1 | **TruffleHog** | Secrets leaked in git history |
| 1 | **Subfinder** | Passive subdomain enumeration (needs `--url`) |
| 1 | **httpx** | HTTP endpoint probing (needs `--url`) |
| 2 | **Nuclei** | CVE template scanning against live target (needs `--url`) |
| 2 | **Schemathesis** | API fuzzing via OpenAPI spec (needs `--url` + spec) |
| 2 | **Nmap** | Port scan + service fingerprinting (needs `--url`) |
| 3 | **Shannon** | Full AI pentest — code analysis, recon, vuln analysis, exploitation, reporting |

All Phase 1+2 scanners run inside isolated Docker containers with `--cap-drop=ALL`, `--security-opt=no-new-privileges`, `--memory=4g`, `--cpus=2`. Workspace volumes are read-only.

## Shannon — The AI Pentest Engine

[Shannon](https://github.com/keeganthewhi/shannon-noapi) is the original [Keygraph Shannon](https://github.com/KeygraphHQ/shannon) adapted to work with CLI subscriptions instead of API keys. Sentinel auto-clones, builds, and invokes it when you pass `--governed`.

Shannon runs its own 5-phase pipeline inside a Docker worker container:

```
Phase 1: Pre-Recon ──── reads source code, maps architecture, identifies attack surface
Phase 2: Recon ──────── probes live target (if URL given), maps endpoints, discovers auth flows
Phase 3: Vuln Analysis ── 5 parallel AI agents hunt for injection, XSS, SSRF, auth, authz bugs
Phase 4: Exploitation ── proves each vulnerability with working PoC exploits
Phase 5: Report ──────── writes comprehensive security assessment
```

Shannon findings are parsed back into Sentinel and merged into the final `SENTINEL_REPORT.md`.

**Runtime**: 30-90 min for a typical monorepo. The ayarticaret scan took 87 min and used ~$36 in subscription credit (billed through your existing Claude/Codex/Gemini subscription, not separate API charges).

## Commands

```bash
./sentinel doctor                              # check everything is ready
./sentinel start --repo <path>                 # mechanical scan
./sentinel start --repo <path> --governed      # full AI scan
./sentinel start --repo <path> --url <u>       # with live target
./sentinel start --repo <path> --openapi <u>   # with explicit OpenAPI spec
./sentinel history                             # past scans
./sentinel report <scan-id>                    # render a stored report
./sentinel diff <baseline-id> <current-id>     # compare two scans
./sentinel stop                                # stop containers
./sentinel clean --yes                         # remove all state
```

## Prerequisites

- **Docker Desktop** (running)
- **Node.js 22+**
- **pnpm 9+** (`npm i -g pnpm`)
- **At least one AI CLI logged in** (for `--governed`): `claude` / `codex` / `gemini`

Run `./sentinel doctor` to verify everything is ready.

## Architecture

```
./sentinel start --repo X --governed
      │
      ├─ Volume prep: host tar → docker cp → named volume (bypasses 9P on Windows)
      ├─ Governor Decision 1: AI picks which scanners to run
      ├─ Phase 1: 5 scanners in PARALLEL docker containers
      ├─ Governor Decision 2: AI evaluates findings (runs parallel with Phase 2)
      ├─ Phase 2: 3 scanners in PARALLEL (if --url given)
      ├─ Governor Decision 3: AI evaluates merged findings
      ├─ Phase 3: Shannon 5-phase AI pentest (30-90 min)
      ├─ Governor Decision 4: AI writes final report
      ├─ Persist to SQLite + write SENTINEL_REPORT.md to repo root
      └─ Cleanup volumes
```

## Stack

- **Runtime**: Node.js 22+, TypeScript strict mode, NestJS 11
- **Queue**: BullMQ on Redis 7 (containerized)
- **Database**: SQLite via Prisma 7
- **Container**: Docker with per-container resource caps
- **AI**: Claude Code / Codex / Gemini CLI (subscription-based, no API keys)
- **Shannon**: [keeganthewhi/shannon-noapi](https://github.com/keeganthewhi/shannon-noapi) (Temporal + Docker)
- **Reports**: AI-authored Markdown, JSON, PDF

## Contributing

Read `CLAUDE.md` before contributing. Critical invariants are non-negotiable.

## License

[MIT](LICENSE) — Copyright (c) 2026 keeganthewhi.

## Related Projects

- **Shannon (CLI fork)**: https://github.com/keeganthewhi/shannon-noapi — the AI pentest engine, adapted for CLI subscriptions
- **Shannon (upstream)**: https://github.com/KeygraphHQ/shannon — the original by Keygraph
- **PrimaSpec**: https://primaspec.com — the governance pattern Sentinel follows
