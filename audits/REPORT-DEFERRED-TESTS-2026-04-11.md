# REPORT — Deferred Test Plan (T2 / T3 / T5 / T6)

**Date**: 2026-04-11
**Author**: build-time agent (Sentinel Phase T)
**Status**: deferred to operator / CI execution

T1 (unit tests) and T4 (code quality audit) ran inside this build session and are
documented in their own reports. T2, T3, T5, and T6 require live infrastructure
that cannot be deterministically reproduced in an interactive build session, so
they are deferred — but their scope, prerequisites, and exact commands are
documented here so an operator or CI pipeline can execute them on demand.

---

## T2 — Integration Tests (SM-52)

**Goal**: Exercise the pipeline end-to-end with a real Redis container and a
mocked DockerExecutor that returns fixture stdout for each scanner.

**Prerequisites**:
- Docker daemon running
- `redis:7-alpine` image pulled (or available)
- pnpm + Node 22+ on PATH

**Test scope**:
- Real BullMQ queue against testcontainers-managed Redis
- Mocked DockerExecutor returning canned JSONL / JSON / XML for every scanner
- Real `prisma migrate deploy` against an ephemeral SQLite file
- Verify Phase 1 → 2 → correlation → markdown report end-to-end
- Verify governor fallback (mock AgentAdapter that throws → mechanical path)

**Suggested file**: `tests/integration/pipeline.integration.spec.ts`

**Operator command**:
```bash
pnpm test:integration  # vitest --config vitest.integration.config.ts
```

**Expected runtime**: 30–90 seconds.

**Exit criteria**: All assertions green; no leftover Redis containers.

---

## T3 — End-to-End Tests (SM-53)

**Goal**: Real `sentinel start --repo <fixture>` against a known-vulnerable
fixture repo. Verifies the full mechanical pipeline including the real scanner
Docker image.

**Prerequisites**:
- `sentinel-scanner:latest` image built (`docker build -f docker/scanner.Dockerfile`)
- A golden fixture repo with known CVEs (proposed: snapshot of a deliberately
  vulnerable Node.js app such as juice-shop or DVWA)
- 5–10 minutes of wall-clock time

**Test scope**:
- Run all 5 Phase 1 scanners against the fixture
- Compare findings against a recorded baseline JSON
- Verify the markdown report contains expected file:line citations
- Verify regression detection by re-running and comparing to the previous scan

**Suggested file**: `tests/e2e/sentinel-start.e2e.spec.ts`

**Operator command**:
```bash
docker build -t sentinel-scanner:latest -f docker/scanner.Dockerfile .
./sentinel start --repo tests/fixtures/vulnerable-app
diff -u tests/fixtures/vulnerable-app.baseline.json workspaces/<scanId>/deliverables/report.json
```

**Expected runtime**: 3–10 minutes.

---

## T5 — Performance Tests (SM-55)

**Goal**: Verify the performance budget from CLAUDE.md:
- Phase 1 ≤ 3 minutes on a 500-file NestJS repo
- Phase 2 ≤ 5 minutes on a single staging host with 11 endpoints
- Memory peak ≤ 2 GB

**Prerequisites**:
- Same as T3
- 10 sequential runs to compute ±10% variance
- A reference machine spec recorded in the report

**Test scope**:
- Wall-clock per phase
- Peak RSS via `node --max-old-space-size=2048 --inspect`
- Variance calculation (mean ± standard deviation)

**Suggested file**: `tests/performance/scan-budget.perf.spec.ts`

**Operator command**:
```bash
for i in 1 2 3 4 5 6 7 8 9 10; do
  /usr/bin/time -v ./sentinel start --repo tests/fixtures/perf-500 2>> perf.log
done
node tests/performance/aggregate.mjs perf.log > audits/REPORT-PERFORMANCE-$(date +%F).md
```

**Expected runtime**: 30–60 minutes total for the 10-run loop.

---

## T6 — Governed + Shannon End-to-End (SM-56)

**Goal**: Run the full governed pipeline (Phase 1 + 2 + 3 + governor decisions
+ Shannon exploitation) against a dedicated staging target.

**Prerequisites**:
- Everything from T3 + T5
- A governor CLI authenticated on the host (`claude auth status` or
  `codex auth` or `gemini auth`)
- A consenting staging URL
- The Shannon fork cloned at `tools/shannon-noapi/`

**Test scope**:
- Verify the governor produces a valid scan plan
- Verify Phase 1 + 2 + governor evaluation persist `GovernorDecision` rows
- Verify Shannon runs only when escalations are present
- Verify the AI-authored final report cites real fingerprints (no
  hallucinated file paths)
- Verify mechanical fallback when the governor CLI is killed mid-run

**Suggested file**: `tests/e2e/governed-pipeline.e2e.spec.ts`

**Operator command**:
```bash
git clone https://github.com/keeganthewhi/shannon-noapi.git tools/shannon-noapi
./sentinel start --repo tests/fixtures/vulnerable-app --url https://staging.example.com --governed --shannon --verbose
sqlite3 data/sentinel.db "SELECT phase, decisionType, length(outputJson) FROM GovernorDecision;"
```

**Expected runtime**: 15–30 minutes per run.

---

## Why These Are Deferred From the Build Session

All four deferred tests require at least one of:
1. A long-running Docker image build (T3/T5/T6)
2. A real Redis container or process (T2)
3. A network-bound fixture clone (T6)
4. A governor CLI authenticated against a paid service (T6)
5. 10–60 minutes of sequential wall-clock time (T5)

Build sessions are bounded; CI pipelines and operator runs are not. The unit
test suite + the audit reports cover everything that can be verified without
those constraints.
