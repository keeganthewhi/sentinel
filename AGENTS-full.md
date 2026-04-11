# AGENTS-full.md — Sentinel Deep Reference Atlas

> Deep specification per module/entity. Search by `AGF::` tokens.
> **Read CLAUDE.md for rules, AGENTS.md for overview first.**
> This file is the source of truth for field-level details, invariants, and pitfalls.

---

## Module Index

| Token | Section | What you get |
|-------|---------|--------------|
| [`AGF::Scan`](#agfscan) | Scan entity | Fields, state machine, invariants |
| [`AGF::PhaseRun`](#agfphaserun) | PhaseRun entity | Fields, scanner execution record |
| [`AGF::Finding`](#agffinding) | Finding entity | Fields, fingerprint rules, severity |
| [`AGF::GovernorDecision`](#agfgovernordecision) | GovernorDecision entity | Decision types, JSON shapes |
| [`AGF::Report`](#agfreport) | Report entity | Output artifacts |
| [`AGF::DatabaseSchema`](#agfdatabaseschema) | Full Prisma schema | Relations, constraints |
| [`AGF::ConfigSchema`](#agfconfigschema) | Zod config schema | CLI flags + YAML + env merging |
| [`AGF::Logger`](#agflogger) | pino logger | Fields, levels, redaction |
| [`AGF::BaseScanner`](#agfbasescanner) | BaseScanner abstract class | Contract, lifecycle |
| [`AGF::ScannerRegistry`](#agfscannerregistry) | Scanner registry | Invocation details per scanner |
| [`AGF::DockerExecutor`](#agfdockerexecutor) | Docker executor | Argument safety, timeout |
| [`AGF::OutputParser`](#agfoutputparser) | Output parsers | JSON / JSONL / XML helpers |
| [`AGF::TrivyScanner`](#agftrivyscanner) | Trivy integration | Command, parser, edge cases |
| [`AGF::SemgrepScanner`](#agfsemgrepscanner) | Semgrep integration | Command, parser, schema drift |
| [`AGF::TruffleHogScanner`](#agftrufflehogscanner) | TruffleHog integration | Command, parser, secret redaction |
| [`AGF::SubfinderScanner`](#agfsubfinderscanner) | Subfinder integration | Passive enumeration |
| [`AGF::HttpxScanner`](#agfhttpxscanner) | httpx integration | Live endpoint probing |
| [`AGF::NucleiScanner`](#agfnucleiscanner) | Nuclei integration | Template selection, rate limits |
| [`AGF::SchemathesisScanner`](#agfschemathesisscanner) | Schemathesis integration | OpenAPI-driven fuzzing |
| [`AGF::NmapScanner`](#agfnmapscanner) | Nmap integration | Port scan + service fingerprint |
| [`AGF::ShannonScanner`](#agfshannonscanner) | Shannon integration | AI-DAST wrapper |
| [`AGF::Pipeline`](#agfpipeline) | BullMQ orchestration | Phases, workers, resume |
| [`AGF::PhaseOneStatic`](#agfphaseonestatic) | Phase 1 orchestrator | Parallel dispatch |
| [`AGF::PhaseTwoInfra`](#agfphasetwoinfra) | Phase 2 orchestrator | Context hand-off |
| [`AGF::PhaseThreeExploit`](#agfphasethreeexploit) | Phase 3 orchestrator | Shannon gating |
| [`AGF::ScannerWorker`](#agfscannerworker) | BullMQ worker | Job processing |
| [`AGF::TerminalUI`](#agfterminalui) | Real-time UI | Spinner + phase display |
| [`AGF::Fingerprint`](#agffingerprint) | Finding fingerprint | Deterministic hash |
| [`AGF::CorrelationEngine`](#agfcorrelationengine) | Mechanical dedup | Group, merge, primary selection |
| [`AGF::SeverityNormalizer`](#agfseveritynormalizer) | Severity rules | Floor, boost, reduce |
| [`AGF::MarkdownRenderer`](#agfmarkdownrenderer) | Markdown report | Template, sections |
| [`AGF::JsonRenderer`](#agfjsonrenderer) | JSON report | Deterministic output |
| [`AGF::PdfRenderer`](#agfpdfrenderer) | PDF report | pdfmake template |
| [`AGF::Governor`](#agfgovernor) | Governor service | Decisions 1-4 |
| [`AGF::AgentAdapter`](#agfagentadapter) | CLI abstraction | Claude / Codex / Gemini |
| [`AGF::PlanGenerator`](#agfplangenerator) | Decision 1 | Scan plan generation |
| [`AGF::PhaseEvaluator`](#agfphaseevaluator) | Decisions 2+3 | Escalate / discard / adjust |
| [`AGF::ReportWriter`](#agfreportwriter) | Decision 4 | AI-authored report |
| [`AGF::GovernorContract`](#agfgovernorcontract) | governor-templates/CLAUDE.md | Runtime contract |
| [`AGF::ScanRepository`](#agfscanrepository) | Scan persistence | Transactional writes |
| [`AGF::FindingRepository`](#agffindingrepository) | Finding persistence | Scoped queries |
| [`AGF::RegressionService`](#agfregressionservice) | Regression detection | Cross-scan diff |
| [`AGF::CLI`](#agfcli) | Commander entry | Subcommands |
| [`AGF::BootstrapScript`](#agfbootstrapscript) | `sentinel` bash script | Prerequisite checks |
| [`AGF::DoctorCommand`](#agfdoctorcommand) | doctor subcommand | Toolchain checks |
| [`AGF::HistoryCommand`](#agfhistorycommand) | history subcommand | Past scan listing |
| [`AGF::DiffCommand`](#agfdiffcommand) | diff subcommand | Regression view |
| [`AGF::ScannerDockerfile`](#agfscannerdockerfile) | Scanner image build | Multi-arch, pinned |
| [`AGF::TestStrategy`](#agfteststrategy) | Test pyramid | Unit / integration / e2e |
| [`AGF::ScannerFixtures`](#agfscannerfixtures) | Test fixtures | Golden repo, mock outputs |
| [`AGF::GovernorMock`](#agfgovernormock) | Governor mock | Deterministic AI responses |
| [`AGF::AuditLoop`](#agfauditloop) | Audit-fix loop | Max 5 rounds |
| [`AGF::ProductionChecklist`](#agfproductionchecklist) | v0.1.0 polish | README, LICENSE, tag |

---

## AGF::Scan

**Purpose**: Root aggregate for a single scan run. One `Scan` owns one set of `PhaseRun`s, one set of `Finding`s, zero or more `GovernorDecision`s, and at most one `Report`.

### Data Model

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| `id` | String | `@id @default(cuid())` | Also used as workspace directory name |
| `status` | String | Enum: PENDING, RUNNING, COMPLETED, FAILED, PARTIAL | Default PENDING |
| `targetUrl` | String? | URL format | Optional — URL-less scans run SCA/SAST only |
| `targetRepo` | String | Absolute path, readable | Required |
| `governed` | Boolean | Default false | True when `--governed` flag present |
| `configJson` | String? | JSON | Merged config (CLI + YAML + env) for audit |
| `blueprintMd` | String? | Markdown | Governor-generated scan plan (governed mode only) |
| `startedAt` | DateTime? | | Set when pipeline enters RUNNING |
| `completedAt` | DateTime? | | Set when pipeline exits (any terminal state) |
| `createdAt` | DateTime | `@default(now())` | |

### State Machine

```
PENDING → RUNNING → { COMPLETED, FAILED, PARTIAL }
```

- `PARTIAL` is expected: any individual scanner crash demotes a COMPLETED → PARTIAL.
- State transitions are atomic. Never update status without updating `startedAt`/`completedAt` in the same transaction.

### Invariants

- A Scan with `status = COMPLETED` or `PARTIAL` MUST have a `Report` row.
- A Scan's `targetRepo` MUST exist at scan start. Validate before inserting the row.
- `governed = true` requires `SENTINEL_GOVERNOR_CLI` to be set before the scan begins.
- Deleting a Scan cascades to PhaseRun, Finding, GovernorDecision, Report.

### Pitfalls

- ⚠ Do not use `scan.id` as a shell argument without quoting — cuid is safe but future ID schemes may not be.
- ⚠ On resume after a crash, a scan with `status = RUNNING` but no live process must be promoted to FAILED (or resumed cleanly from STATE.md).
- ⚠ Two scans on the same repo concurrently are supported but writes to `workspaces/<scanId>/` must never cross.

### Testing Notes

- Success: PENDING → RUNNING → COMPLETED end-to-end
- Failure: PENDING → RUNNING → FAILED when bootstrap raises
- Partial: one Phase 1 scanner crashes → PARTIAL with remaining findings
- Regression: previous scan PARTIAL, new scan COMPLETED → regression detector treats them as comparable

---

## AGF::PhaseRun

**Purpose**: Record of a single scanner execution inside a scan. One row per scanner per scan.

### Data Model

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| `id` | String | `@id @default(cuid())` | |
| `scanId` | String | FK → Scan, cascade | |
| `phase` | Int | 1 / 2 / 3 | |
| `scanner` | String | Scanner name from registry | |
| `status` | String | Enum: PENDING, RUNNING, COMPLETED, FAILED, TIMED_OUT, SKIPPED | |
| `startedAt` | DateTime? | | |
| `completedAt` | DateTime? | | |
| `findingCount` | Int | Default 0 | Denormalized for quick queries |
| `rawOutput` | String? | | Truncated at 5MB per row |
| `errorLog` | String? | stderr on FAILED / TIMED_OUT | |
| `createdAt` | DateTime | `@default(now())` | |

### Invariants

- `findingCount` must match the actual `Finding` rows for `(scanId, scanner)`.
- `SKIPPED` status requires an `errorLog` explaining why (e.g., "no OpenAPI spec found").
- Per-scanner timeout is enforced by `DockerExecutor`; PhaseRun.status reflects the docker result.

### Pitfalls

- ⚠ `rawOutput` can be huge for Nuclei — truncate at 5 MB with a `... [truncated]` marker. Store the full output in `workspaces/<scanId>/deliverables/<scanner>.stdout`.
- ⚠ Empty output is NOT an error. Zero findings is a valid outcome.

---

## AGF::Finding

**Purpose**: Normalized finding after parsing. Unique per `[scanId, fingerprint]`.

### Data Model

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| `id` | String | `@id @default(cuid())` | |
| `scanId` | String | FK → Scan, cascade | |
| `fingerprint` | String | Unique `(scanId, fingerprint)` | SHA-256 from `fingerprint(finding)` |
| `title` | String | | Human-readable short title |
| `description` | String | | Detail from the scanner |
| `severity` | String | Enum: CRITICAL, HIGH, MEDIUM, LOW, INFO | |
| `normalizedScore` | Float | Default 0 | Normalized CVSS-like score |
| `scanner` | String | | Primary scanner that reported this |
| `category` | String | Enum: dependency, secret, iac, sast, network, api, dast, misconfig, other | |
| `cveId` | String? | | CVE-YYYY-NNNNN |
| `cweId` | String? | | CWE-NNN |
| `filePath` | String? | | Repo-relative path |
| `lineNumber` | Int? | | |
| `endpoint` | String? | | URL or port for network/api findings |
| `evidence` | String? | | Truncated, sensitive fields redacted |
| `exploitProof` | String? | | Shannon PoC |
| `remediation` | String? | | Fix hint |
| `isDuplicate` | Boolean | Default false | |
| `correlationId` | String? | | Links duplicates to primary |
| `isRegression` | Boolean | Default false | Set by RegressionService |
| `governorAction` | String? | Enum: escalated, discarded, severity_adjusted | Null in mechanical mode |
| `createdAt` | DateTime | `@default(now())` | |

### Fingerprint Rules (see AGF::Fingerprint)

### Invariants

- `filePath` is repo-relative, never absolute. Strip the mount prefix in the parser.
- `evidence` never contains raw secret values. TruffleHog `Raw` → `[REDACTED:<fingerprint>]`.
- `governorAction` is null in mechanical mode.
- `correlationId` points to the primary Finding's `id` for duplicates; null for primaries.

### Pitfalls

- ⚠ Multiple scanners can report the same issue. The primary is chosen by evidence richness; do NOT use scanner precedence.
- ⚠ Severity can change between mechanical and governor normalization. Store both: use `normalizedScore` for the mechanical base and `severity` for the final (governor-adjusted if applicable) value.

---

## AGF::GovernorDecision

**Purpose**: Auditable record of each governor decision. Persists full input and output for traceability.

### Data Model

| Field | Type | Constraints |
|-------|------|-------------|
| `id` | String | `@id @default(cuid())` |
| `scanId` | String | FK → Scan, cascade |
| `phase` | Int | 0 = scan plan, 1 = post-Phase-1, 2 = post-Phase-2, 4 = report |
| `decisionType` | String | Enum: scan_plan, evaluation, report |
| `inputJson` | String | JSON serialized — what governor received |
| `outputJson` | String | JSON serialized — what governor decided |
| `rationale` | String? | Human-readable summary |
| `createdAt` | DateTime | `@default(now())` |

### Decision JSON Shapes

**scan_plan output**:
```json
{
  "scanPlan": {
    "enabledScanners": ["trivy", "semgrep", "trufflehog"],
    "disabledScanners": ["subfinder", "httpx", "nmap"],
    "disableReasons": { "subfinder": "no URL provided" },
    "scannerConfigs": {
      "semgrep": { "config": "p/typescript,p/nodejs" },
      "nuclei": { "templates": ["cves/", "misconfiguration/"] }
    },
    "rationale": "NestJS/Prisma/PostgreSQL B2B app. No public URL."
  }
}
```

**evaluation output**:
```json
{
  "escalateToShannon": [
    { "findingFingerprint": "abc123", "reason": "..." }
  ],
  "discardFindings": [
    { "findingFingerprint": "def456", "reason": "..." }
  ],
  "adjustSeverity": [
    { "findingFingerprint": "ghi789", "newSeverity": "CRITICAL", "reason": "..." }
  ],
  "notes": "..."
}
```

**report output**: Markdown string (validated length, min section count).

### Invariants

- Every decision is validated against a Zod schema before persistence.
- Invalid governor responses → persist with `decisionType = evaluation`, `outputJson = null`, `rationale = "fallback to mechanical"`.
- `phase = 0` (scan_plan) creates exactly one row per scan.

---

## AGF::Report

**Purpose**: Final report artifacts for a scan.

### Data Model

| Field | Type | Constraints |
|-------|------|-------------|
| `id` | String | `@id @default(cuid())` |
| `scanId` | String | Unique FK → Scan |
| `markdownPath` | String? | Path to `workspaces/<scanId>/deliverables/report.md` |
| `jsonPath` | String? | Path to `workspaces/<scanId>/deliverables/report.json` |
| `pdfPath` | String? | Path to `workspaces/<scanId>/deliverables/report.pdf` |
| `summary` | String | One-paragraph human summary |
| `aiAuthored` | Boolean | True when written by governor |
| `createdAt` | DateTime | `@default(now())` |

### Pitfalls

- ⚠ Paths are stored as strings relative to the data directory. Reconstruct absolute paths via `path.join(DATA_DIR, 'workspaces', scanId, 'deliverables', ...)`.
- ⚠ PDF path may be null if `pdfmake` crashes on unusual content; markdown and JSON must always exist for a COMPLETED scan.

---

## AGF::DatabaseSchema

**Purpose**: Complete Prisma schema.

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

model Scan {
  id            String             @id @default(cuid())
  status        String             @default("PENDING")
  targetUrl     String?
  targetRepo    String
  governed      Boolean            @default(false)
  configJson    String?
  blueprintMd   String?
  startedAt     DateTime?
  completedAt   DateTime?
  createdAt     DateTime           @default(now())
  findings      Finding[]
  phases        PhaseRun[]
  decisions     GovernorDecision[]
  report        Report?

  @@index([targetRepo, createdAt])
}

model PhaseRun {
  id           String    @id @default(cuid())
  scanId       String
  scan         Scan      @relation(fields: [scanId], references: [id], onDelete: Cascade)
  phase        Int
  scanner      String
  status       String    @default("PENDING")
  startedAt    DateTime?
  completedAt  DateTime?
  findingCount Int       @default(0)
  rawOutput    String?
  errorLog     String?
  createdAt    DateTime  @default(now())

  @@index([scanId, phase])
  @@index([scanId, scanner])
}

model Finding {
  id              String   @id @default(cuid())
  scanId          String
  scan            Scan     @relation(fields: [scanId], references: [id], onDelete: Cascade)
  fingerprint     String
  title           String
  description     String
  severity        String
  normalizedScore Float    @default(0)
  scanner         String
  category        String
  cveId           String?
  cweId           String?
  filePath        String?
  lineNumber      Int?
  endpoint        String?
  evidence        String?
  exploitProof    String?
  remediation     String?
  isDuplicate     Boolean  @default(false)
  correlationId   String?
  isRegression    Boolean  @default(false)
  governorAction  String?
  createdAt       DateTime @default(now())

  @@unique([scanId, fingerprint])
  @@index([scanId, severity])
  @@index([scanId, category])
  @@index([scanId, isRegression])
}

model GovernorDecision {
  id           String   @id @default(cuid())
  scanId       String
  scan         Scan     @relation(fields: [scanId], references: [id], onDelete: Cascade)
  phase        Int
  decisionType String
  inputJson    String
  outputJson   String
  rationale    String?
  createdAt    DateTime @default(now())

  @@index([scanId, phase])
}

model Report {
  id           String   @id @default(cuid())
  scanId       String   @unique
  scan         Scan     @relation(fields: [scanId], references: [id], onDelete: Cascade)
  markdownPath String?
  jsonPath     String?
  pdfPath      String?
  summary      String
  aiAuthored   Boolean  @default(false)
  createdAt    DateTime @default(now())
}
```

### Pitfalls

- ⚠ SQLite does not natively support `Json` type well — all JSON payloads are `String` and parsed on read.
- ⚠ Index order matters for SQLite range queries; `[targetRepo, createdAt]` supports the regression service's most common query.
- ⚠ PostgreSQL provider swap: only change `datasource db.provider = "postgresql"`. No schema changes required.

---

## AGF::ConfigSchema

**Purpose**: Zod schema merging CLI flags + `sentinel.yaml` + environment variables.

### Schema shape

```typescript
export const ConfigSchema = z.object({
  target: z.object({
    repo: z.string().min(1),
    url: z.string().url().optional(),
  }),
  mode: z.object({
    governed: z.boolean().default(false),
    shannon: z.boolean().default(false),
    phases: z.array(z.number().int().min(1).max(3)).optional(),
  }),
  scanners: z.object({
    only: z.array(z.string()).optional(),
    exclude: z.array(z.string()).optional(),
    configs: z.record(z.unknown()).default({}),
  }),
  timeouts: z.object({
    scannerMs: z.number().int().positive().default(30 * 60 * 1000),
    governorMs: z.number().int().positive().default(5 * 60 * 1000),
  }),
  runtime: z.object({
    redisUrl: z.string().default('redis://localhost:6379'),
    databaseUrl: z.string().default('file:./data/sentinel.db'),
    scannerImage: z.string().default('sentinel-scanner:latest'),
    dataDir: z.string().default('./data'),
  }),
  authentication: z.object({
    type: z.enum(['none', 'bearer', 'cookie']).default('none'),
    token: z.string().optional(),
    cookies: z.record(z.string()).optional(),
  }).optional(),
  verbose: z.boolean().default(false),
});
```

### Merge order

1. Defaults from Zod schema.
2. `sentinel.yaml` if present (explicit `--config <path>` or current directory).
3. Environment variables (`REDIS_URL`, `DATABASE_URL`, `SCANNER_IMAGE`, `DATA_DIR`, `SENTINEL_GOVERNOR_CLI`).
4. CLI flags (highest priority).

### Pitfalls

- ⚠ `authentication.token` must NOT be logged or persisted beyond runtime memory.
- ⚠ CLI flag parsing via Commander → Zod: unknown flags rejected with a clear error.

---

## AGF::Logger

**Purpose**: pino-based structured logger, imported everywhere via `src/common/logger.ts`.

### Standard fields

- `scanId` (when in scan context)
- `scanner` (when in scanner context)
- `phase` (when in pipeline context)
- `durationMs` (when timing)

### Levels

- `error`: unrecoverable failure that ends the scan.
- `warn`: recoverable failure (scanner crash, governor fallback).
- `info`: phase transitions, decision outcomes, persistence writes.
- `debug`: per-scanner progress, subprocess args (only when `--verbose`).

### Redaction

- `authentication.token` → redacted
- `evidence` field when scanner is `trufflehog` → replaced with `[REDACTED:<fingerprint>]`
- `rawOutput` → never logged by default; opt in with `--verbose`
- Governor prompts and responses → logged at `debug` level only

---

## AGF::BaseScanner

**Purpose**: Abstract class every scanner extends.

```typescript
export abstract class BaseScanner {
  abstract name: string;
  abstract phase: 1 | 2 | 3;
  abstract requiresUrl: boolean;

  abstract execute(context: ScanContext): Promise<ScannerResult>;
  abstract parseOutput(raw: string): NormalizedFinding[];
  abstract isAvailable(): Promise<boolean>;
}

export interface ScannerResult {
  scanner: string;
  findings: NormalizedFinding[];
  rawOutput: string;
  executionTimeMs: number;
  success: boolean;
  error?: string;
}

export interface ScanContext {
  scanId: string;
  targetUrl?: string;
  targetRepo: string;
  openApiSpec?: string;
  authentication?: AuthConfig;
  governed: boolean;
  discoveredSubdomains?: string[];
  discoveredEndpoints?: string[];
  phase1Findings?: NormalizedFinding[];
  phase2Findings?: NormalizedFinding[];
  governorEscalations?: string[];
}
```

### Contract

- `execute()` MUST NOT throw for tool crash / timeout / empty output — return `{ success: false, ...}` instead.
- `execute()` MAY throw for programmer errors (bad context, missing required config).
- `parseOutput()` MUST be pure: same input → same output, no side effects.
- `isAvailable()` checks tool presence in the scanner image — used by `doctor`.

---

## AGF::ScannerRegistry

**Purpose**: In-memory map of all scanner implementations.

### API

```typescript
class ScannerRegistry {
  register(scanner: BaseScanner): void;
  get(name: string): BaseScanner | undefined;
  all(): BaseScanner[];
  forPhase(phase: 1 | 2 | 3): BaseScanner[];
}
```

- Registration happens at module import. Scanner modules are imported by `ScannerModule`.
- Registering the same name twice throws.
- `forPhase` is the primary API used by `PhaseOneStatic` and `PhaseTwoInfra`.

---

## AGF::DockerExecutor

**Purpose**: Run scanner tool inside `sentinel-scanner` container.

### API

```typescript
interface DockerRunOptions {
  image: string;
  command: string[];        // argv array, NOT a shell string
  workspaceRepo?: string;   // host path, mounted read-only at /workspace
  timeoutMs: number;
  env?: Record<string, string>;
}

interface DockerRunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
}

class DockerExecutor {
  run(options: DockerRunOptions): Promise<DockerRunResult>;
}
```

### Invariants

- `command` is an argv array — NEVER a string. Shell injection impossible by construction.
- Container runs with `--rm` so it self-deletes on exit.
- Workspace mounted read-only: `-v <repo>:/workspace:ro`.
- Timeout enforced via `AbortController` passed to `child_process.spawn`.
- `timedOut: true` when the subprocess was killed by the AbortController.

### Pitfalls

- ⚠ On macOS, Docker Desktop's bind mount can be slow — avoid scanners that walk every file unless necessary.
- ⚠ WSL2: rewrite `/mnt/c/...` paths to `C:/...` for Docker Desktop mount resolution.
- ⚠ `exitCode` can be `null` if the process was killed by signal — treat as failure.

---

## AGF::OutputParser

**Purpose**: Shared JSON / JSONL / XML parsing helpers.

### API

```typescript
export function parseJson<T>(raw: string, schema: z.ZodType<T>): T;
export function parseJsonLines<T>(raw: string, schema: z.ZodType<T>): T[];
export function parseXml(raw: string): unknown;

export class ParseError extends Error {
  constructor(
    message: string,
    public readonly line?: number,
    public readonly scanner?: string,
  );
}
```

- JSON / JSONL always go through Zod. `any` at the parser boundary is narrowed within the function.
- XML uses `fast-xml-parser` with `attributeNamePrefix: ""`, `ignoreAttributes: false`, `parseTagValue: true`.

---

## AGF::TrivyScanner

**Purpose**: SCA + secret + IaC scanning on repo source.

- **Command**: `trivy fs --format json --quiet --scanners vuln,secret,misconfig /workspace`
- **Input**: Repo mounted at `/workspace`
- **Output**: JSON with `.Results[].Vulnerabilities[]`, `.Results[].Secrets[]`, `.Results[].Misconfigurations[]`
- **Category mapping**: `vuln → dependency`, `secret → secret`, `misconfig → iac`
- **Severity mapping**: Trivy UNKNOWN → INFO, LOW → LOW, MEDIUM → MEDIUM, HIGH → HIGH, CRITICAL → CRITICAL
- **Pitfalls**:
  - ⚠ Empty repo returns `"Results": null` — parser must handle null.
  - ⚠ Pinned version `v0.69.3` in Dockerfile — schema drift on upgrades.
  - ⚠ Trivy outputs `VulnerabilityID`, not `CVE` — map to `cveId` field.

---

## AGF::SemgrepScanner

**Purpose**: SAST pattern matching with taint analysis.

- **Command**: `semgrep --config <ruleset> --json /workspace`
- **Default ruleset**: `p/default` (overridable via config)
- **Output**: JSON with `.results[]`
- **Severity mapping**: `ERROR → HIGH`, `WARNING → MEDIUM`, `INFO → LOW`
- **Pitfalls**:
  - ⚠ Schema differs across Semgrep 1.x / 2.x — parse defensively, ignore unknown top-level keys.
  - ⚠ `metavars` field may contain user code — redact before storing in `evidence`.

---

## AGF::TruffleHogScanner

**Purpose**: Secret scanning across git history.

- **Command**: `trufflehog filesystem --json --only-verified /workspace`
- **Output**: JSON lines — one object per line
- **Severity**: `HIGH` if `Verified = true`, `MEDIUM` otherwise
- **Pitfalls**:
  - ⚠ `Raw` field contains the actual secret — NEVER store. Redact to `[REDACTED:<fingerprint>]`.
  - ⚠ Blank lines between records are valid — skip without error.

---

## AGF::SubfinderScanner

**Purpose**: Passive subdomain enumeration.

- **Command**: `subfinder -d <domain> -json`
- **Only runs when**: `context.targetUrl` is set (extract domain from URL)
- **Output**: JSON lines with `.host`
- **Writes to**: `context.discoveredSubdomains` (does NOT emit findings)

---

## AGF::HttpxScanner

**Purpose**: Live endpoint probing.

- **Command**: `httpx -json -status-code -tech-detect -u <host>`
- **Input**: Hosts from `context.discoveredSubdomains`
- **Writes to**: `context.discoveredEndpoints` with `{ url, statusCode, technologies }`

---

## AGF::NucleiScanner

**Purpose**: Template-based vulnerability scanning.

- **Command**: `nuclei -jsonl -silent -t <templates> -u <url> -rate-limit <N>`
- **Default templates**: `cves/,misconfiguration/,exposed-panels/`
- **Pitfalls**:
  - ⚠ Progress output on stderr even with `-silent` — do NOT treat non-empty stderr as crash indicator.
  - ⚠ Rate limit from context takes precedence over default. Governor-set rate limits MUST NOT be overridden.
  - ⚠ Huge output for wide scope — truncate `rawOutput` stored in `PhaseRun` to 5 MB.

---

## AGF::SchemathesisScanner

**Purpose**: Property-based API fuzzer.

- **Command**: `schemathesis run --base-url <url> <spec> --checks all --junit-xml -`
- **Only runs when**: `context.openApiSpec` is set
- **Parser**: JUnit XML → failures → findings with `endpoint` field populated

---

## AGF::NmapScanner

**Purpose**: Port scan + service fingerprinting.

- **Command**: `nmap -sV --top-ports 1000 -oX - <host>`
- **Parser**: XML via `fast-xml-parser` with `attributeNamePrefix: ""`
- **Findings**: Carry open ports as `endpoint` field (`tcp/22`)

---

## AGF::ShannonScanner

**Purpose**: AI-powered DAST wrapper. Receives governor escalations as priority targets.

- **Command**: Delegated to governor CLI subprocess (Claude / Codex / Gemini)
- **Input**: URL + repo + `context.governorEscalations`
- **Output**: Markdown report → parsed into findings with `exploitProof` populated
- **Pitfalls**:
  - ⚠ Requires governor CLI authenticated on host.
  - ⚠ Very expensive — configurable hard cap per target (default 30 min).

---

## AGF::Pipeline

**Purpose**: BullMQ orchestration across Phases 1–3 with Phase 4 mechanical aggregation.

### Key properties

- Single queue `sentinel-scans`
- Typed job data: `{ scanId, phase, scannerName, context }`
- Concurrency: unlimited within a phase (Phase 1 scanners all parallel), phase-level barrier between phases
- Resume: phase boundaries are the only resume points; mid-phase crashes restart the phase

### Flow (mechanical)

```
bootstrap → create Scan row → Phase 1 dispatch
  → Phase 1 barrier → Phase 2 dispatch
  → Phase 2 barrier → Phase 3 (optional)
  → Phase 4: correlation + mechanical report
  → write Report row → mark Scan COMPLETED/PARTIAL
```

### Flow (governed)

```
bootstrap → create Scan row
  → Governor Decision 1 (scan plan) → write workspaces/<scanId>/BLUEPRINT.md
  → Phase 1 dispatch (per plan)
  → Phase 1 barrier → Governor Decision 2+3 (post-phase-1 evaluation)
  → Phase 2 dispatch (per plan + governor adjustments)
  → Phase 2 barrier → Governor Decision 2+3 (post-phase-2 evaluation)
  → Phase 3 (optional, targets from governor escalations)
  → Phase 3 barrier → Governor Decision 4 (report writer)
  → write Report row → mark Scan COMPLETED/PARTIAL
```

---

## AGF::PhaseOneStatic

**Purpose**: Dispatch all Phase 1 scanners in parallel.

- Uses `registry.forPhase(1)` to list enabled scanners
- Filters out scanners where `requiresUrl && !context.targetUrl`
- Filters out scanners disabled in governor's scan plan (when governed)
- `Promise.allSettled` — one failure does not cancel others
- Writes discovered subdomains/endpoints to `ScanContext` for Phase 2

---

## AGF::PhaseTwoInfra

**Purpose**: Dispatch Phase 2 scanners after Phase 1 completes.

- Waits for Phase 1 barrier
- Reads `context.discoveredSubdomains` + `context.discoveredEndpoints`
- Filters out scanners disabled in plan
- Same failure-isolation semantics as Phase 1

---

## AGF::PhaseThreeExploit

**Purpose**: Optional Shannon exploitation.

- Runs only when `--shannon` flag AND at least one target escalated by governor (or explicitly in mechanical mode)
- Passes `context.governorEscalations` to Shannon

---

## AGF::ScannerWorker

**Purpose**: BullMQ job processor.

- Looks up scanner in registry by name
- Calls `execute(ctx)`, catches errors, records `PhaseRun`
- Persists findings via `FindingRepository`
- Emits progress events to `TerminalUI`

---

## AGF::TerminalUI

**Purpose**: Real-time terminal display.

- Uses `ora` for spinners or custom ansi-escape implementation
- Per-scanner status: PENDING / RUNNING / OK / FAIL / SKIP
- Phase headers with elapsed time
- Governor lines rendered in cyan
- Refreshes at most every 100 ms

---

## AGF::Fingerprint

**Purpose**: Deterministic finding fingerprint.

### Algorithm

```typescript
function fingerprint(f: NormalizedFinding): string {
  const keys: string[] = [];
  if (f.cveId) keys.push(`cve:${f.cveId}`);
  else if (f.filePath && f.lineNumber !== undefined) keys.push(`loc:${f.filePath}:${f.lineNumber}`);
  else if (f.endpoint) keys.push(`ep:${f.endpoint}:${f.category}`);
  else keys.push(`title:${f.title}:${f.category}`);

  const canonical = keys.join('|');
  return crypto.createHash('sha256').update(canonical).digest('hex').substring(0, 16);
}
```

### Invariants

- Deterministic: same input → same hash across 1000 property-test iterations.
- Short (16 hex chars) but collision-resistant enough for typical scan size.
- Never includes timestamps, scan IDs, or other non-semantic fields.

---

## AGF::CorrelationEngine

**Purpose**: Mechanical cross-scanner dedup.

### Algorithm

1. Group findings by fingerprint.
2. For each group with size > 1, pick the primary: the finding with the richest evidence (most non-null fields, preferring Shannon > Semgrep > Trivy > Nuclei > others).
3. Mark non-primary as `isDuplicate = true`, set `correlationId = primary.id`.
4. Merge scanner names: primary's `scanner` becomes a comma-separated list if multiple scanners report.

### Invariants

- Correlation is idempotent: running twice produces the same result.
- Order-independent: findings in different orders produce the same groups.
- Governor mode: governor's correlation decisions (if any) override mechanical.

---

## AGF::SeverityNormalizer

**Purpose**: Mechanical severity adjustment rules.

### Rules

| Condition | Adjustment |
|-----------|-----------|
| Shannon exploit confirmed (`exploitProof != null`) | Floor at HIGH |
| Semgrep taint trace (`evidence` contains taint markers) | Boost one level (up to CRITICAL) |
| Nuclei template match without exploit proof | Reduce one level (down to LOW) |
| Dependency CVE (Trivy) without reachability evidence | Unchanged |
| Correlated finding (multiple scanners) | Boost one level (signals confidence) |

### Invariants

- Ordering matters: apply floor, then boost, then reduce.
- Governor decisions in governed mode override the mechanical normalizer.
- Never adjusts below LOW or above CRITICAL.

---

## AGF::MarkdownRenderer

**Purpose**: Template-based Markdown report.

### Sections

1. Header (target, repo, mode, start time, duration)
2. Executive summary (finding counts by severity, governor highlights)
3. Scan plan (from BLUEPRINT.md when governed, else default)
4. Findings by category (dependency, sast, secret, network, api, dast, iac, misconfig)
5. Per-finding block: title, severity, file:line, scanner(s), description, evidence, exploit proof (if present), remediation, references
6. Governor decisions appendix (when governed)
7. Regressions vs. previous scan (when applicable)

### Invariants

- Every finding cites at least one of: scanner name, file:line, CVE ID, endpoint.
- Severity badges use emoji only when `--emoji` flag is set (default: text).
- Markdown is valid GitHub-flavored Markdown.

---

## AGF::JsonRenderer

**Purpose**: Deterministic JSON report.

- Sorted keys at every level
- Sorted arrays where order is not semantically meaningful
- Schema versioned: `{ "schema": "sentinel-report-v1", "sentinelVersion": "0.1.0", ...}`

---

## AGF::PdfRenderer

**Purpose**: Polished PDF via `pdfmake`.

- TOC with page jumps
- Severity badges (CRITICAL red, HIGH orange, MEDIUM yellow, LOW blue, INFO gray)
- Code excerpts for file:line findings
- Footer with scan ID + page number
- Target size ≤ 2 MB for 100-finding report

---

## AGF::Governor

**Purpose**: Top-level governor service orchestrating the four decisions.

### API

```typescript
class GovernorService {
  generateScanPlan(repoPath: string, targetUrl: string | undefined, availableScanners: string[]): Promise<ScanPlan>;
  evaluatePhaseResults(phase: number, findings: NormalizedFinding[], context: ScanContext, previousDecisions: GovernorDecision[]): Promise<EvaluationDecision>;
  writeReport(allFindings: NormalizedFinding[], context: ScanContext, allDecisions: GovernorDecision[], blueprint: ScanPlan): Promise<string>;
}
```

### Invariants

- Never spawns a scanner subprocess.
- Never imports from `src/scanner/scanners/`.
- Always falls back to mechanical defaults on any error.

---

## AGF::AgentAdapter

**Purpose**: Abstraction over Claude Code / Codex / Gemini CLI.

### API

```typescript
interface AgentAdapterInterface {
  query(prompt: string): Promise<string>;
  isAvailable(): Promise<boolean>;
  name: string;
}
```

### Behavior

- Spawns subprocess: `<cli> --print <prompt>` via spawn argv array.
- 5-minute hard timeout via `AbortController`.
- On timeout / non-zero exit / empty output → throws typed error.
- `NO_COLOR=1` set in env to strip ANSI.

### Pitfalls

- ⚠ `claude --print` may emit prefix lines — strip until first `{`.
- ⚠ Codex wraps responses in ANSI — `NO_COLOR=1` required.
- ⚠ Gemini may truncate long prompts — chunk findings array if > 64 KB.

---

## AGF::PlanGenerator

**Purpose**: Decision 1 — generate scan plan before Phase 1.

### Input

- Repo file tree (mechanical)
- `package.json` / equivalents (mechanical)
- `targetUrl` (if set)
- `availableScanners` (from registry)

### Output

- `ScanPlan` (validated via Zod)
- Written to `workspaces/<scanId>/BLUEPRINT.md`
- Persisted as `GovernorDecision` with `decisionType = scan_plan`

### Fallback

- On any error: enable all URL-less scanners; enable URL-dependent scanners iff `targetUrl` is set; default rulesets.

---

## AGF::PhaseEvaluator

**Purpose**: Decisions 2 + 3 — escalate / discard / adjust after each phase.

### Input

- Phase number
- Normalized findings for that phase (and prior phases as context)
- Previous governor decisions
- ScanContext

### Output

- `EvaluationDecision` (Zod-validated)
- Updates `workspaces/<scanId>/STATE.md`
- Persisted as `GovernorDecision` with `decisionType = evaluation`

### Fallback

- No escalations, no discards, no severity adjustments.

---

## AGF::ReportWriter

**Purpose**: Decision 4 — write the final report.

### Input

- All findings
- All governor decisions
- Blueprint
- ScanContext

### Output

- Markdown report string — validated against a minimum-sections rule
- Fallback to mechanical markdown renderer on any failure

### Invariants

- Every citation verifiable: file paths must exist in actual findings, CVE IDs must match real findings. A post-hoc verification step removes any unverifiable citation and logs a WARN.

---

## AGF::GovernorContract

**Purpose**: The runtime governor behavioral contract shipped at `governor-templates/CLAUDE.md` and copied into every `workspaces/<scanId>/` directory at scan start.

See `governor-templates/CLAUDE.md` for the verbatim content. Key points:

- Never fabricate findings.
- Never skip CRITICAL / HIGH during noise filtering.
- Only escalate to Shannon when there is a plausible exploit path with scanner evidence.
- Correlation requires matching on CVE ID, file:line, or endpoint+category.
- Cite file paths, line numbers, and scanner names in the report.
- Respect rate limits set in BLUEPRINT.md.
- Return valid JSON for each decision type per the shapes in AGF::GovernorDecision.

---

## AGF::ScanRepository

**Purpose**: Persistence for Scan + cross-table read helpers.

### Key methods

```typescript
create(input: CreateScanInput): Promise<Scan>;
updateStatus(scanId: string, status: ScanStatus): Promise<void>;
findById(scanId: string): Promise<ScanWithRelations | null>;
listRecent(limit: number): Promise<Scan[]>;
findLastCompletedForRepo(repo: string): Promise<Scan | null>;
```

- All multi-row writes inside `prisma.$transaction()`.

---

## AGF::FindingRepository

**Purpose**: Scoped finding persistence.

### Invariant

- All queries scoped by `scanId`. Never `findUnique(id)` on a raw ID — use `findUnique({ where: { scanId_fingerprint } })` or `findFirst({ where: { scanId, ... } })`.

---

## AGF::RegressionService

**Purpose**: Compare current scan to the most recent completed scan of the same repo.

### Algorithm

1. Find previous scan: `findLastCompletedForRepo(targetRepo)` excluding current scan.
2. Load previous findings set (by fingerprint).
3. For each current finding: if `fingerprint` not in previous set → `isRegression = true`.
4. First-scan case: no previous scan → no regressions.

---

## AGF::CLI

**Purpose**: Commander.js entry point.

### Commands

- `start` — run a scan (most complex)
- `history` — list past scans
- `report <id>` — render saved report
- `diff <id1> <id2>` — regression comparison
- `doctor` — toolchain check
- `stop` — stop Redis container
- `clean` — remove all state

### Exit codes

- 0: success
- 1: scan failed (with findings or error)
- 2: prerequisite missing
- 3: invalid arguments
- 4: governor failed irrecoverably in governed mode

---

## AGF::BootstrapScript

**Purpose**: `sentinel` bash script at repo root.

See BLUEPRINT.md SM-45 for implementation requirements and the spec for the canonical bash source.

### Key responsibilities

- Check Node 22+, Docker running, pnpm 9+
- Install deps + build on first run
- Auto-start Redis container
- Build scanner image on first run
- Initialize Prisma database
- Check governor CLI when `--governed`
- Export env vars and exec `node dist/cli.js`

### Platform support

- macOS bash 3.2+ (no bash 4 features)
- Linux bash 4+
- WSL2 (rewrite `/mnt/c/...` → `C:/...` for Docker paths)

---

## AGF::DoctorCommand

**Purpose**: Toolchain readiness check.

### Checks

- Node version
- Docker daemon running
- pnpm version
- Redis container reachable
- Scanner image present
- Each governor CLI (if installed)
- Prisma DB file present / connectable

### Output

- Per-check: `[OK]` / `[MISSING]` / `[STALE]` with remediation hint
- Exits non-zero if any required dependency is missing

---

## AGF::HistoryCommand

**Purpose**: List past scans from the database.

- Columns: scan ID, target, mode, started, duration, counts by severity
- `--limit` flag (default 20)
- `--repo <path>` filters to one repo
- Supports `--json` for scripting

---

## AGF::DiffCommand

**Purpose**: Compare two scans.

- Arguments: `<old-scan-id> <new-scan-id>`
- Output: new findings (regressions) + disappeared findings (fixes) + severity changes
- Supports `--json`, `--markdown`, `--format pdf`

---

## AGF::ScannerDockerfile

**Purpose**: Fat image with all scanners.

See BLUEPRINT.md Phase K and the spec Dockerfile for canonical content.

### Pinned versions

- Trivy: `v0.69.3` (verified pre-incident)
- Semgrep: latest pip
- TruffleHog: latest go install (v3)
- Nuclei: latest go install (v3) + `-update-templates` at build
- Subfinder, httpx: latest go install
- Schemathesis: latest pip
- Nmap: apt package

### Multi-arch

- `docker buildx build --platform linux/amd64,linux/arm64`
- Verify on both architectures in CI

---

## AGF::TestStrategy

**Purpose**: Test pyramid and coverage targets.

See TESTS.md for the full plan. Summary:

- Unit: 70% — parsers, scanners (mocked execute), correlation, governor prompts
- Integration: 20% — BullMQ + SQLite + mocked Docker
- E2E: 10% — real Docker + golden fixture repo

Coverage: ≥ 80% overall, ≥ 95% for `correlation/`, `governor/`, `execution/`.

---

## AGF::ScannerFixtures

**Purpose**: Test fixtures for every scanner.

### Structure

```
test/fixtures/
├── scanners/
│   ├── trivy/
│   │   ├── output.json         # real Trivy output
│   │   └── expected.json       # expected NormalizedFinding[]
│   ├── semgrep/
│   └── ...
├── repos/
│   ├── vulnerable-nestjs/      # golden fixture repo
│   └── empty/                  # edge-case empty repo
└── targets/
    └── mock-server/            # fixture HTTP server for httpx/nuclei/nmap
```

---

## AGF::GovernorMock

**Purpose**: Deterministic mock for governor in tests.

- Implements `AgentAdapterInterface`
- Returns canned JSON responses from `test/fixtures/governor/`
- Supports latency simulation and timeout simulation
- Used in integration tests to exercise governor code paths without spending real AI budget

---

## AGF::AuditLoop

**Purpose**: Test-audit-fix loop that runs in Phase U.

### Protocol

1. Read every source file.
2. Check each against: correctness, timeout handling, error paths, no hardcoded paths, no secrets.
3. Write findings to `audits/round-N-findings.md`.
4. For each finding → create plan → execute plan → commit.
5. Re-audit. Max 5 rounds. Stop when zero new findings.

---

## AGF::ProductionChecklist

**Purpose**: v0.1.0 release gate.

- README includes North Star UX verbatim from the spec
- LICENSE file (MIT)
- `sentinel --version` prints `sentinel 0.1.0`
- Git tag `v0.1.0` pushed to main
- All 59 SMs in STATE.md checked
- `audits/final-report.md` with zero open findings

---

*Generated to match the format produced by [PrimaSpec](https://primaspec.com).*
