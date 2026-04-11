# Plan 011 — Phase J CLI & Bootstrap

> **Created**: 2026-04-11
> **Status**: IN_PROGRESS
> **Status Mark**: SM-44 .. SM-48 (Phase J)
> **Git SHA (start)**: 98d0013
> **Depends on**: SM-43 (Phase I complete)

## Cold Start

- **Read first**: BLUEPRINT.md Phase J; AGENTS-full.md `AGF::CLI`, `AGF::BootstrapScript`, `AGF::DoctorCommand`, `AGF::HistoryCommand`, `AGF::DiffCommand`; CLAUDE.md exit code taxonomy.
- **Current state**: Mechanical pipeline + governor + Shannon all wired. CLI is a Commander stub with no subcommands. No bootstrap script.
- **Expected end state**: `src/cli.ts` registers `start`, `history`, `report`, `diff`, `doctor`, `stop`, `clean` subcommands; each is a thin function in `src/cli/commands/*.ts`. `sentinel` bash script at the repo root bootstraps Node, Docker, pnpm, Redis, scanner image, and Prisma DB before delegating to `node dist/cli.js`. CLI tests verify command registration and basic argv parsing.

## Aim

Ship the user-facing CLI surface and the one-command bootstrap experience. The CLI is the only entry point from end users; every command flows through Commander → a lightweight command function → the appropriate service (PipelineService, repositories, etc.). The bash script handles host-level concerns (Docker, Redis container, scanner image) so the Node code can assume a healthy environment.

## Steps

### Step 1: Doctor command (SM-46)

- **File**: `src/cli/commands/doctor.command.ts` (NEW FILE)
- **Detail**: Reports versions of node, docker, pnpm, redis (via `redis-cli ping`), scanner image (via `docker image inspect`), and each governor CLI (`claude --version`, `codex --version`, `gemini --version`). Exits non-zero if any HARD dependency (node, docker, pnpm) is missing. Soft-missing (Redis, scanner image, governor CLI) → warn but exit 0.
- **Constraint**: Never `exec()`, always `spawn` argv array. Each version probe has a 5-second timeout.

### Step 2: Start command (SM-44)

- **File**: `src/cli/commands/start.command.ts` (NEW FILE)
- **Detail**: Wires config → ScanRepository.create → PipelineService.run → CorrelationService.correlate → SeverityNormalizer → MarkdownRenderer.render. Persists findings via FindingRepository. Writes report to `workspaces/<scanId>/deliverables/report.md`. Honours `--governed`, `--shannon`, `--phases`, `--config`, `--verbose` flags.
- **Constraint**: Exit codes follow CLAUDE.md taxonomy (0 success, 1 scan failed with findings, 2 prerequisite missing, 3 invalid arguments, 4 governor failed irrecoverably).

### Step 3: History / Report / Diff commands (SM-47)

- **File**: `src/cli/commands/history.command.ts`, `src/cli/commands/report.command.ts`, `src/cli/commands/diff.command.ts` (NEW FILES)
- **Detail**:
  - `history` — `ScanRepository.findAllRecent` → table-formatted list of past scans
  - `report <id>` — read findings via FindingRepository → render via MarkdownRenderer / JsonRenderer based on `--format` flag
  - `diff <id1> <id2>` — compare two scans via the regression service

### Step 4: Stop / Clean commands (SM-48)

- **File**: `src/cli/commands/stop.command.ts`, `src/cli/commands/clean.command.ts` (NEW FILES)
- **Detail**:
  - `stop` — stops the `sentinel-redis` container via `docker stop`
  - `clean` — removes redis container, scanner image, `data/`, `workspaces/`. Prompts for confirmation unless `--yes` is passed.

### Step 5: Wire commands into cli.ts (SM-44)

- **File**: `src/cli.ts` (MODIFY)
- **Detail**: Replace the stub with a Commander program that registers all 7 subcommands. Each command function takes its parsed options and a NestJS application context (which it builds lazily on demand to avoid the NestJS bootstrap cost on `--help`).

### Step 6: Sentinel bash bootstrap (SM-45)

- **File**: `sentinel` (NEW FILE) at repo root
- **Detail**: Bash script that:
  1. Verifies Node 22+, Docker, pnpm 9+
  2. Starts the `sentinel-redis` container if not running
  3. Builds the scanner image if not present
  4. Applies Prisma migrations (`prisma migrate deploy`)
  5. Exports `REDIS_URL`, `DATABASE_URL`, `SCANNER_IMAGE`, `DATA_DIR`, `SHANNON_DIR`, `SENTINEL_GOVERNOR_CLI`
  6. Clones `keeganthewhi/shannon-noapi` into `tools/shannon-noapi/` ONLY when `--shannon` is in argv and the dir does not exist
  7. Executes `node dist/cli.js "$@"`
- **Constraint**: Bash 3.2+ compatible (no `[[ var =~ ... ]]` requiring 4+). WSL detection rewrites `/mnt/c/...` paths to `C:/...`.

### Step 7: Tests

- **File**: `src/cli/commands/*.spec.ts` (a small set — focus on flag parsing and exit-code semantics)
- **Detail**: Test the command functions in isolation by passing mocked dependencies (mock PipelineService, mock repositories). No real subprocess invocation. No real DB.

### Step 8: Quality gate + commit + push + STATE update

## Acceptance Criteria

- [ ] All 7 subcommands registered in `src/cli.ts`
- [ ] `node dist/cli.js --help` lists all subcommands
- [ ] `node dist/cli.js --version` prints `sentinel 0.1.0`
- [ ] `sentinel` bash script exists, is executable, and bootstraps the environment
- [ ] Bash script is bash-3.2 compatible (no 4+ syntax)
- [ ] Quality gate passes
- [ ] STATE.md SMs 44–48 flipped; Phase J → COMPLETE

## Security Checklist

- [ ] No shell-string interpolation in CLI subprocess calls
- [ ] `clean --yes` is the only path that skips confirmation
- [ ] No secrets logged or echoed by the bash script
- [ ] Bash script never runs `eval` on user input
- [ ] All subprocess invocations use argv arrays

## Test Requirements

- [ ] CLI registers all 7 subcommands (verified by inspecting `program.commands.length`)
- [ ] Doctor command exit code is 0 when all hard deps are reachable
- [ ] Start command parses `--phases 1,2,3` correctly
- [ ] Report command rejects unknown `--format` value

## Execution Order

1 → 2 → 3 → 4 → 5 → 6 → 7 → 8

## Rollback

1. `git revert HEAD`
2. `rm -rf src/cli/ sentinel`
3. Restore `src/cli.ts` to its Phase A stub

## Completion

1. Quality gate
2. `git add src/cli src/cli.ts sentinel plans/011-cli-bootstrap.md`
3. Commit `[SM-44..48] phase-j: cli commands + sentinel bootstrap script`
4. Push
5. STATE.md → Phase J COMPLETE, current_phase=K, current_step=SM-49

# Important Findings

(Append discoveries here as you work.)
