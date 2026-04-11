# Plan 001 — Phase 0 Environment Setup

> **Created**: 2026-04-11
> **Status**: COMPLETE
> **Status Mark**: SM-1 .. SM-4 (Phase 0)
> **Git SHA (start)**: — (repo not yet initialized)
> **Git SHA (end)**: 8249412 (initial governance commit) + follow-up bookkeeping commit
> **Depends on**: N/A — first plan

## Cold Start

- **Read these files first** (in order):
  1. `CLAUDE.md` — behavioral contract
  2. `AGENTS.md` — domain knowledge (not strictly needed for Phase 0, but habitual)
  3. `BLUEPRINT.md` — Phase 0 section (lines 173–199)
  4. `STATE.md` — verify `current_phase=0`, `current_step=SM-1`
  5. `plans/000-template.md` — plan skeleton
- **Current state**: Governance file set exists (CLAUDE.md, AGENTS.md, AGENTS-full.md, BLUEPRINT.md, STATE.md, FEATURES.md, TESTS.md, THREATS.md, MANIFEST.json, docs/adr/README.md, governor-templates/*, plans/000-template.md). No code, no git repo, no GitHub remote.
- **Last agent action**: Prior session finalized governance and wired the real GitHub repo URL `https://github.com/keeganthewhi/sentinel` into BLUEPRINT.md SM-3, STATE.md SM-3, CLAUDE.md, and MANIFEST.json.
- **Expected state after this plan**: Host toolchain verified, git repo initialized, `.gitignore` committed, initial governance commit pushed to `https://github.com/keeganthewhi/sentinel` (private), governor CLI presence documented, STATE.md SMs 1–4 ticked.

## Aim

Prepare the host to build Sentinel: verify prerequisites (Node 22+, Docker, pnpm 9+, `gh auth status`), activate pnpm via corepack, initialize git with a correct `.gitignore`, create the private GitHub repo at `keeganthewhi/sentinel` via `gh repo create`, push the governance bundle as the initial commit, and detect the optional governor CLI. This unlocks every subsequent build phase.

## Steps

### Step 1: Verify host prerequisites (SM-1)

- **File**: — (no file changes; shell verification only)
- **Detail**:
  ```bash
  node --version                 # must be >= v22.0.0
  corepack --version             # should print a version
  pnpm --version                 # >= 9.0.0
  docker --version && docker ps  # Docker must be running
  gh --version && gh auth status # gh must be authenticated with 'repo' scope
  git --version && git config --global user.name && git config --global user.email
  ```
  Record the exact versions in `# Important Findings` below. If any is missing, STOP and surface a blocker.
- **Constraint**: Do not install Docker or `gh` from this agent — those require user interaction. If missing, block.

### Step 2: Activate pnpm via corepack (SM-2)

- **File**: — (corepack toggles pnpm globally)
- **Detail**:
  ```bash
  corepack enable
  corepack prepare pnpm@latest --activate
  pnpm --version
  ```
  If `corepack enable` is a no-op because pnpm is already active, proceed.
- **Constraint**: Do not pin a specific pnpm major here — version is locked later via `packageManager` in `package.json` (Phase A, SM-5).

### Step 3: Create .gitignore (SM-3a)

- **File**: `.gitignore` (NEW FILE)
- **Detail**:
  ```gitignore
  # Sentinel .gitignore — excludes ephemeral state and build artifacts only.
  # Governance (*.md, MANIFEST.json, docs/, governor-templates/, plans/) IS committed.

  # Node / pnpm
  node_modules/
  .pnpm-store/
  pnpm-debug.log*
  npm-debug.log*

  # Build output
  dist/
  build/
  *.tsbuildinfo

  # Runtime state
  data/
  workspaces/
  tools/
  coverage/
  .nyc_output/

  # Databases
  *.db
  *.db-journal
  *.sqlite
  *.sqlite3

  # Environment / secrets
  .env
  .env.*
  !.env.example

  # Agent session state (ephemeral, never committed)
  .claude-session.md

  # OS / editor artifacts
  .DS_Store
  Thumbs.db
  .idea/
  .vscode/*
  !.vscode/extensions.json

  # Test artifacts
  *.log
  audits/*.tmp
  ```
- **Constraint**: `plans/`, `*.md` files, `MANIFEST.json`, `docs/`, and `governor-templates/` MUST NOT be ignored — they are the governance bundle and must be committed.

### Step 4: Initialize git repo and stage governance (SM-3b)

- **File**: — (git operations)
- **Detail**:
  ```bash
  git init
  git branch -M main
  git add .gitignore CLAUDE.md AGENTS.md AGENTS-full.md BLUEPRINT.md STATE.md FEATURES.md TESTS.md THREATS.md MANIFEST.json docs/ governor-templates/ plans/
  git status                     # verify no .env, no data/, no workspaces/ staged
  ```
  Verify `git status` shows only the governance bundle + `.gitignore` + the plan file in staged changes.
- **Constraint**: NEVER `git add -A` or `git add .` — explicit file list only. NEVER stage `.claude-session.md`.

### Step 5: Create initial governance commit (SM-3c)

- **File**: — (git commit)
- **Detail**:
  ```bash
  git commit -m "chore(governance): initial governance file set [SM-3]"
  git log --oneline -1
  ```
- **Constraint**: Commit message format is fixed by BLUEPRINT SM-3. Do not skip hooks — there are no hooks yet.

### Step 6: Create remote and push via gh (SM-3d)

- **File**: — (gh CLI)
- **Detail**:
  ```bash
  gh repo create keeganthewhi/sentinel --private --source=. --remote=origin --push \
    --description "Unified Application Security Testing Platform — self-hosted security scanner orchestrator with optional AI governor"
  git remote -v
  gh repo view keeganthewhi/sentinel --json url,visibility,defaultBranchRef
  ```
  Verify `origin` points at `https://github.com/keeganthewhi/sentinel.git` and the repo is `PRIVATE`.
- **Constraint**: Repo MUST be private. If it already exists on GitHub (should not), STOP — do not overwrite.

### Step 7: Detect optional governor CLIs (SM-4)

- **File**: — (PATH detection)
- **Detail**:
  ```bash
  command -v claude 2>/dev/null || echo "claude: not installed"
  command -v codex  2>/dev/null || echo "codex: not installed"
  command -v gemini 2>/dev/null || echo "gemini: not installed"
  ```
  Record the presence/absence of each in `# Important Findings`. SM-4 is OPTIONAL — if none are installed, mark it N/A with reason "mechanical-only workflow will be exercised first; governor CLI installed before Phase H (SM-37)".
- **Constraint**: Do NOT install a governor CLI autonomously — that's a user decision (which vendor, auth flow, billing).

### Step 8: Update STATE.md and push follow-up commit

- **File**: `STATE.md`
- **Detail**: Flip SM-1, SM-2, SM-3, SM-4 checkboxes from `[ ]` to `[x]` (or `[~]` for SM-4 if N/A). Update YAML frontmatter: `current_phase: "A"`, `current_step: "SM-5"`, `completed_status_marks: 4`, `last_git_sha: <short sha>`, `current_plan_file: "plans/001-env-setup.md"`. Phase header: `## Phase 0 — Environment Setup` from `PENDING` → `COMPLETE`.
- **Constraint**: Do NOT rewrite STATE.md. Only flip checkboxes and edit frontmatter / phase header per the update protocol at the top of the file.

## Acceptance Criteria

- [ ] `node --version` ≥ v22.0.0 recorded in Important Findings
- [ ] `pnpm --version` ≥ 9.0.0 recorded in Important Findings
- [ ] `docker ps` succeeds (Docker daemon reachable) recorded in Important Findings
- [ ] `gh auth status` shows `keeganthewhi` authenticated with `repo` scope
- [ ] `corepack enable` + `corepack prepare pnpm@latest --activate` succeed
- [ ] `.gitignore` exists and excludes all items from BLUEPRINT SM-3.b
- [ ] `git init` succeeded; HEAD is on branch `main`
- [ ] Initial governance commit created with message `chore(governance): initial governance file set [SM-3]`
- [ ] `git remote -v` shows `origin` → `https://github.com/keeganthewhi/sentinel.git`
- [ ] Repo visible on GitHub, private, default branch `main`
- [ ] SM-4 governor CLI status recorded (installed list or N/A reason)
- [ ] STATE.md SM-1..SM-4 checkboxes flipped; YAML frontmatter advanced
- [ ] Quality gate `pnpm typecheck && pnpm lint && pnpm test` — N/A (no code yet, scripts added in SM-9); documented here for the record.

## Security Checklist

- [ ] No scanner output interpolated into a shell command — N/A (no scanners yet)
- [ ] No hardcoded paths, ports, image names, or scanner versions in source — N/A (no source yet)
- [ ] No secrets (tokens, keys, passwords) committed or logged — verify `git status` before commit; `.env*` ignored
- [ ] Governor stays read-only — N/A (no governor code yet)
- [ ] Scanner output parsed through typed parsers — N/A
- [ ] TruffleHog raw secrets redacted — N/A
- [ ] Prisma queries scoped by `scanId` — N/A (no Prisma yet)
- [ ] `.claude-session.md` excluded from git — enforced via `.gitignore`
- [ ] `gh` token NEVER logged or echoed — gh manages its own keyring; do not print `gh auth token`

## Test Requirements

- [ ] Success case: `git log --oneline -1` shows the governance commit after SM-3
- [ ] Success case: `gh repo view keeganthewhi/sentinel` returns the repo with `visibility: PRIVATE`
- [ ] Failure case: if any prerequisite is missing, STOP with a clear blocker message; do not proceed to SM-3
- [ ] Edge case: if the remote already exists, do NOT overwrite — STOP
- [ ] Coverage: N/A — no code in this plan

## Execution Order

**Recommended**: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8
**Rationale**: Verify host first (Step 1 — bail early if missing). Activate pnpm before any install (Step 2). Write `.gitignore` before `git init` so the initial staging is clean (Steps 3–4). Commit before creating the remote so `gh repo create --push` has something to push (Steps 5–6). Governor detection is last because it's optional and independent (Step 7). STATE.md update is the final bookkeeping step (Step 8).

## Rollback

1. `git remote remove origin` if the wrong remote was added
2. `gh repo delete keeganthewhi/sentinel --yes` to remove the GitHub repo (ONLY with explicit user approval — never automatic)
3. `rm -rf .git` to un-initialize the local repo (ONLY with explicit user approval)
4. Revert `STATE.md` checkboxes to `[ ]` and frontmatter to `current_phase: "0"`, `current_step: "SM-1"`, `completed_status_marks: 0`
5. Delete `plans/001-env-setup.md` and `.gitignore` if the plan is fully abandoned

## Completion

1. Run quality gate: N/A for Phase 0 — no TypeScript code yet. Note: scripts `pnpm typecheck && pnpm lint && pnpm test` are added in SM-9. This exception is recorded here and in Important Findings.
2. Re-read every Acceptance Criteria checkbox and verify each is satisfied.
3. Re-read every Security Checklist item.
4. `git add STATE.md plans/001-env-setup.md` after the initial SM-3 commit
5. `git status` to verify no secrets, no unwanted files
6. Commit: `git commit -m "[SM-1..4] phase-0: complete environment setup and STATE.md bookkeeping"`
7. `git push origin main`
8. Update STATE.md frontmatter (done in Step 8 of the plan, committed in step 6 of completion)

# Important Findings

- [Step 1] Host prerequisites verified:
  - `node --version` → `v24.14.1` (✓ ≥ v22)
  - `pnpm --version` → `10.24.0` (✓ ≥ 9) — installed standalone at `C:\Users\Furkan\AppData\Local\pnpm\pnpm`
  - `corepack --version` → `0.34.6` (installed with Node)
  - `docker --version` → `Docker version 29.3.1, build c2be9cc` (✓); `docker ps` reachable, multiple containers running on host
  - `gh --version` → `2.89.0` (✓); `gh auth status` → `keeganthewhi` logged in via keyring, token scopes `gist, read:org, repo` (✓ repo scope sufficient for `gh repo create --private`)
  - `git --version` → `2.53.0.windows.2`; user `keeganthewhi <furkanakyuz1453@gmail.com>`
- [Step 2] `corepack enable` FAILED on Windows with `EPERM: operation not permitted, open 'C:\Program Files\nodejs\yarn'` — corepack tries to write shims into the Node install directory which is owned by TrustedInstaller. Admin elevation would be needed, but unnecessary here because pnpm 10.24.0 is ALREADY installed standalone and on PATH. SM-2 acceptance (`pnpm --version` prints a version) is satisfied via the existing standalone install. Corepack is still usable for `corepack prepare` in non-elevated mode if needed later, but no action is taken here to avoid requiring admin rights. Recorded as a Windows-specific gotcha: future plans that require corepack-managed pnpm on Windows must run the shell as Administrator.
- [Step 7] Governor CLIs — ALL THREE present on PATH:
  - `claude` → `C:\Users\Furkan\AppData\Roaming\npm\claude`
  - `codex`  → `C:\Users\Furkan\AppData\Roaming\npm\codex`
  - `gemini` → `C:\Users\Furkan\AppData\Roaming\npm\gemini`
  SM-4 is fully satisfied (not N/A). Phase H (SM-37+) can choose among all three at runtime.
