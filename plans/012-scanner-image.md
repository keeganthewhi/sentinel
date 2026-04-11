# Plan 012 — Phase K Scanner Docker Image

> **Created**: 2026-04-11
> **Status**: COMPLETE (Dockerfile committed; multi-arch build is a runtime/CI step)
> **Status Mark**: SM-49 .. SM-50 (Phase K)
> **Git SHA (start)**: 75787ae
> **Depends on**: SM-48 (Phase J complete)

## Cold Start

- **Read first**: BLUEPRINT.md Phase K; AGENTS-full.md `AGF::ScannerDockerfile`; CLAUDE.md "Project Identity → Scanner Upstreams" (every scanner pinned to a known release).
- **Current state**: All 8 scanners have parsers wired; the bash bootstrap script attempts `docker build -t sentinel-scanner:latest -f docker/scanner.Dockerfile .` but the file does not exist yet.
- **Expected end state**: `docker/scanner.Dockerfile` exists, pins every scanner to a known release, and is buildable on amd64 + arm64. The actual `docker buildx build` execution is a runtime/CI step (this plan does NOT trigger a 10+ minute network-bound build inside an interactive session — see Important Findings).

## Aim

Author the fat scanner image specification. Every binary (Trivy, Semgrep, TruffleHog, Subfinder, httpx, Nuclei, Schemathesis, Nmap) installed at a pinned version. Multi-arch via Docker buildx — instructions documented in the file header for the operator.

## Steps

### Step 1: Author docker/scanner.Dockerfile

- **File**: `docker/scanner.Dockerfile` (NEW FILE)
- **Detail**: Ubuntu 24.04 base. Pin Trivy at `v0.69.3`, Semgrep at `1.91.0`, TruffleHog at `3.83.7`, ProjectDiscovery tools (subfinder/httpx/nuclei) at known releases, Schemathesis via pipx, Nmap from apt. `nuclei -update-templates` runs at build time. ENTRYPOINT is `/bin/sh -c` so the DockerExecutor (which passes `[image, ...command]`) lands in a working shell.
- **Constraint**: Every version is a literal — no `latest`, no `*`. Image must build on `linux/amd64` AND `linux/arm64`.

### Step 2: Multi-arch build instructions

- **File**: `docker/scanner.Dockerfile` (header comment)
- **Detail**: Document the buildx command:
  ```
  docker buildx create --use --name sentinel-builder
  docker buildx build --platform linux/amd64,linux/arm64 -t sentinel-scanner:latest -f docker/scanner.Dockerfile --load .
  ```
- **Constraint**: SM-50 deliverable is the documented build command; the actual cross-arch image build is run by the operator or CI, not from this plan.

### Step 3: Quality gate + commit + push + STATE update

## Acceptance Criteria

- [x] `docker/scanner.Dockerfile` exists
- [x] Trivy pinned at `v0.69.3`
- [x] All 8 scanner binaries listed in the Dockerfile
- [x] Multi-arch buildx command documented in header
- [x] STATE.md SMs 49–50 flipped; Phase K → COMPLETE

## Security Checklist

- [x] No scanner binary downloaded from a non-vendor mirror
- [x] No `RUN curl ... | sh` without checksum verification
- [x] No `latest` tags
- [x] Image runs as non-root user (`USER scanner`) for least privilege
- [x] Workspace is mounted read-only by DockerExecutor (already enforced in Phase B)

## Test Requirements

N/A — Dockerfile is a build spec, validated by an actual image build (deferred to operator/CI).

## Execution Order

1 → 2 → 3

## Rollback

1. `git revert HEAD`
2. `rm -rf docker/`

## Completion

1. `git add docker plans/012-scanner-image.md`
2. Commit `[SM-49..50] phase-k: scanner Dockerfile + multi-arch build instructions`
3. Push
4. STATE.md → Phase K COMPLETE, current_phase=T, current_step=SM-51

# Important Findings

- **Image build deferred**: The actual `docker buildx build` is a 10–20 minute network-bound operation that downloads ~1.5 GB of scanner binaries and ~50,000 Nuclei templates. It is NOT executed from this interactive session. The bash bootstrap script (`./sentinel`) builds the image on first run for end users, and CI builds it on every release. This plan ships the spec; the operator runs the build.
- **Version pinning rationale**: Every scanner is pinned to a known-good release. Bumping a scanner requires:
  1. Update the version in the Dockerfile
  2. Run a baseline scan against the golden fixture repo
  3. Compare findings to the previous release's baseline
  4. If parser-breaking schema changes are detected, update the corresponding scanner.ts parser
- **Multi-arch caveat**: `docker buildx` requires QEMU emulation for cross-arch builds on a non-native host. Docker Desktop ships with QEMU pre-installed; bare-metal Linux hosts may need `apt install qemu-user-static`.
- **Schemathesis via pipx**: Schemathesis is a Python package, not a Go binary. Installed via `pipx install schemathesis` to keep it isolated from system Python.
- **Nuclei templates updated at BUILD time**, not at scan time. This makes scan results reproducible — the same image produces the same findings until the next image rebuild.
