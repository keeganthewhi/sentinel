# Sentinel

> **Unified Application Security Testing Platform** — a self-hosted, open-source security scanning orchestrator that chains nine specialized security tools through a mechanical BullMQ pipeline with an optional AI governor layer.

[![Status](https://img.shields.io/badge/status-v0.1.3-blue)](https://github.com/keeganthewhi/sentinel/releases/tag/v0.1.3)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

---

## North Star UX

```bash
git clone https://github.com/keeganthewhi/sentinel.git
cd sentinel
./sentinel start --repo /path/to/your/code
```

That's it. The bash bootstrap script handles `pnpm install`, Docker, Redis, the scanner image build, Prisma client generation, migration, and — when you pass `--governed` — cloning and building `shannon-noapi`. The first run takes a few minutes (scanner image + nuclei templates + shannon worker image); subsequent runs are seconds.

To enable the AI governor layer (governor decisions + Shannon AI-DAST exploitation), pass `--governed`:

```bash
./sentinel start --repo /path/to/your/code --governed
```

Sentinel auto-detects the first available AI CLI on your PATH in this order: **Claude Code → Cursor → Codex → Gemini**. Override with `SENTINEL_GOVERNOR_CLI=cursor` (or any of the four) if you want a specific vendor. The AI CLI drives Shannon through its subscription — **no API keys required**.

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
| 2 | **Schemathesis** | OpenAPI fuzzer (auto-discovers spec) | https://github.com/schemathesis/schemathesis |
| 2 | **Nmap** | Port scan + service detection | https://github.com/nmap/nmap |
| 3 | **Shannon** | AI-powered DAST exploitation (governed mode) | https://github.com/keeganthewhi/shannon-noapi |

A mechanical correlation engine deduplicates findings across scanners and a severity normalizer applies consistent rules. The optional AI governor layer reads results and makes four decisions: what to scan, what to escalate, what to discard, and how to report.

## Two Modes

### Normal Mode (default — mechanical, zero AI cost)

```bash
./sentinel start --repo /path/to/code                           # source-only
./sentinel start --repo /path/to/code --url https://staging.app # + live target
```

- SQLite (`file:./data/sentinel.db`)
- Auto-managed Redis container (`sentinel-redis`)
- Mechanical pipeline only — no AI anywhere
- Runs Phase 1 + Phase 2 scanners, template-based markdown report
- No Shannon, no governor calls

### Governed Mode (full AI + Shannon exploitation)

```bash
./sentinel start --repo /path/to/code --governed                # code-only shannon
./sentinel start --repo /path/to/code --url https://staging.app --governed
```

- `--governed` is a **single flag** that enables everything AI: governor plan + evaluations + AI-authored report + full 5-phase Shannon exploitation. No separate `--shannon` flag needed.
- **Works with or without `--url`**: when no target URL is given, Shannon runs its code-only pipeline (source SAST + dependency analysis). Phase 2 URL scanners skip cleanly.
- **Vendor-agnostic**: works with Claude Code, Cursor, Codex, or Gemini — whichever CLI is on your PATH.
- Four governor decisions per scan (audit trail in `workspaces/<scan-id>/deliverables/governor-decisions.json`):
  1. **Scan plan** (before Phase 1) — AI reads the repo digest + package.json, picks which scanners to run
  2. **Phase 1 evaluation** — AI reads static-scan findings, decides what to discard / re-severity / escalate to Shannon. **Runs in parallel with Phase 2 scanners** (since v0.1.3) so there's no idle wait.
  3. **Phase 2 evaluation** — AI reads the merged finding set, same pattern
  4. **Report writer** (end of scan) — AI authors the final markdown. Citation fingerprints are verified at ≥75% validity (since v0.1.3) — minor drift is tolerated, full hallucination falls back mechanically.
- Shannon's 5-phase pipeline (pre-recon → recon → vuln-exploitation → reporting) runs fully through the authenticated AI CLI subscription. **Real runs against real sites take 30 minutes to several hours** depending on target size and scope.
- Every governor failure falls back to the mechanical path automatically — the scan never blocks on AI.

Pass `--openapi <url>` to explicitly supply an OpenAPI spec for schemathesis. If omitted and `--url` is set, schemathesis auto-probes common paths (`/openapi.json`, `/swagger.json`, `/v3/api-docs`, `/api-docs`, `/api-json`, `/openapi.yaml`).

## Commands

```bash
./sentinel doctor                              # verify host toolchain + runtime readiness
./sentinel start --repo <path>                 # mechanical scan
./sentinel start --repo <path> --governed      # AI-governed scan (auto shannon)
./sentinel start --repo <path> --url <u>       # with live target
./sentinel start --repo <path> --openapi <u>   # with explicit OpenAPI spec
./sentinel history                             # past scans
./sentinel report <scan-id>                    # render a saved report
./sentinel diff <baseline-id> <current-id>     # compare two scans
./sentinel stop                                # stop the redis container
./sentinel clean --yes                         # remove all sentinel state
```

## Architecture

```
./sentinel start --governed
      │
      ▼
┌─ Volume prep (one-shot, ~45 s): host tar → docker cp → docker named volume
│   bypasses Docker Desktop 9P bind-mount bottleneck on Windows
│
├─ Governor Decision 1 (scan_plan)  ← 1 AI-CLI call, picks enabled scanners
│
├─ Phase 1 — all scanners run in PARALLEL, each in its own docker container
│   ├── trivy           sentinel-trivy-<hex>
│   ├── semgrep         sentinel-semgrep-<hex>
│   ├── trufflehog      sentinel-trufflehog-<hex>
│   ├── subfinder       sentinel-subfinder-<hex>
│   └── httpx           sentinel-httpx-<hex>
│   per-container resource caps: --memory=4g --cpus=2 (overridable)
│
├─ Governor Decision 2 (phase1_evaluation)   ← 1 AI-CLI call
│   runs CONCURRENTLY with Phase 2 (v0.1.3+) — no idle wait
│
├─ Phase 2 — all scanners run in PARALLEL
│   ├── nuclei          sentinel-nuclei-<hex>
│   ├── schemathesis    sentinel-schemathesis-<hex>  (auto-discovers OpenAPI spec)
│   └── nmap            sentinel-nmap-<hex>
│
├─ Join Decision 2 → apply discards/escalations to Phase 1 findings
│
├─ Governor Decision 3 (phase2_evaluation)   ← 1 AI-CLI call
│
├─ Phase 3 — Shannon AI exploitation (governed mode only)
│   spawns shannon-noapi's 5-phase pipeline in its own docker worker
│   container via Temporal; sentinel polls session.json + streams
│   shannon's workflow.log phase transitions for live progress
│
├─ Governor Decision 4 (report)  ← 1 AI-CLI call, writes final markdown
│   10-min timeout, ≥75% citation validity accepted
│
└─ Correlate → severity normalize → persist (SQLite) → render markdown/JSON
   volume torn down in a finally block even on error
```

Critical invariants enforced throughout (see `CLAUDE.md`):
- Scanners run in isolated docker containers — never on the host
- Governor code NEVER spawns a scanner subprocess (Invariant #4)
- Governor prompt input is structurally separated from scanner output (Invariant #6)
- Governor failures always fall back to mechanical path (Invariant #7)
- Per-scan docker workspace volume + read-only mounts prevent cross-scan leakage
- Per-container `--memory` + `--cpus` caps bound the blast radius of a runaway scanner

## Stack

- **Runtime**: Node.js 22+, TypeScript strict mode
- **Framework**: NestJS 11
- **Queue**: BullMQ on Redis 7 (containerized)
- **Database**: SQLite via Prisma 7 (default), PostgreSQL 16 (full mode)
- **Container**: Docker (fat scanner image with all 8 tools + shannon worker image for Phase 3)
- **CLI**: Commander.js + bash bootstrap
- **Reports**: Markdown, JSON, PDF (pdfmake)
- **Governor (optional)**: Claude Code, Cursor, Codex, or Gemini CLI subprocess

## Build From Source

```bash
git clone https://github.com/keeganthewhi/sentinel.git
cd sentinel
pnpm install                # postinstall runs prisma generate
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

**v0.1.3** — pure-perfection pass on top of v0.1.1's end-to-end verified release.

Since v0.1.1:

- **Per-scan Docker volume replaces the 9P bind mount on Windows.** Host-side `tar` piped into `docker cp` populates a named volume once; every scanner mounts it read-only. Semgrep on a ~50 MB NestJS monorepo went from hitting the 30-minute timeout to finishing in 48 seconds. Every other scanner also got a 3–30× speedup.
- **Shannon real integration.** `shannon.scanner.ts` spawns `node tools/shannon-noapi/shannon start`, polls `workspace/session.json` for completion, streams phase transitions from `workflow.log` into sentinel's logger so users see live progress, and parses shannon's actual per-phase `## N. Exploitation Queue` JSON blocks into NormalizedFindings.
- **`--governed` is now the single AI flag.** It implicitly enables Phase 3 Shannon (with `code-only` when no `--url` is given). The old `--shannon` flag is removed.
- **Governor honors its own scan plan.** Scanners that the plan disables are skipped at the phase runner with a clear reason — not just logged as advisory.
- **Parallel governor Decision 2.** Phase 2 scanners now run concurrently with the phase1_evaluation governor call, saving 2–5 min per governed scan.
- **Schemathesis auto-discovery.** Probes `/openapi.json`, `/openapi.yaml`, `/swagger.json`, `/v3/api-docs`, `/api-docs`, `/api-json`, and three `/api/*` variants before skipping. Explicit `--openapi <url>` flag overrides.
- **Report-writer citation threshold 100% → 75%.** Stops the report writer from trashing otherwise-valid 30 KB reports over a single invented citation fingerprint.
- **Docker per-container resource caps.** `--memory=4g --cpus=2` by default — a runaway nuclei can't OOM-kill the host.
- **SQLite persistence hardened.** `insertMany` dedupes by fingerprint before `createMany` to sidestep SQLite's lack of Prisma's `skipDuplicates`. Previously crashed on nmap/nuclei fingerprint collisions.
- **12-hour scanner timeout ceiling** so big-monorepo Shannon runs don't get cut short.
- **`sentinel doctor` runtime-readiness probes** — scanner image, redis container, shannon-noapi cloned+built state, better-sqlite3 native binding — plus the Windows `.cmd` spawn fix so claude/codex/gemini/pnpm don't falsely report MISSING.
- **203 unit tests**, all green, real shannon fixture-based parser tests included.

Verified end-to-end on https://primaspec.com with all four AI CLIs authenticated:
- **Claude governed**: 9 scanners processed, 4/4 AI-authored governor decisions, Shannon's real 5-phase pipeline ran 64 minutes (~$23 equivalent via subscription), produced 9 per-phase deliverable markdowns.
- **Codex governed**: 184 findings, 4/4 AI-authored decisions, 6 min.
- **Gemini governed**: quota-locked externally but adapter degrades cleanly to mechanical fallback at every decision, 2.7 min.
- **Non-governed ayarticaret + primaspec**: 5.3 min wall clock, 218 raw findings, 182 persisted unique (deduped), sev CRITICAL:2 HIGH:56 MEDIUM:110 LOW:11 INFO:3.

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
