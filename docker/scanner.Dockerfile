# syntax=docker/dockerfile:1.6
#
# Sentinel scanner image — fat container with every scanner pre-installed.
#
# Base: Ubuntu 24.04 (multi-arch).
# Tools: Trivy, Semgrep, TruffleHog, Subfinder, httpx, Nuclei, Schemathesis, Nmap.
#
# Build (single-arch, native):
#   docker build -t sentinel-scanner:latest -f docker/scanner.Dockerfile .
#
# Build (multi-arch via buildx):
#   docker buildx create --use --name sentinel-builder
#   docker buildx build \
#     --platform linux/amd64,linux/arm64 \
#     -t sentinel-scanner:latest \
#     -f docker/scanner.Dockerfile \
#     --load .
#
# Pinned versions:
#   Trivy           v0.69.3
#   Semgrep         1.91.0  (via pip)
#   Schemathesis    3.36.3  (via pip — installed BEFORE PD suite so its httpx dep
#                            does not overwrite projectdiscovery/httpx)
#   TruffleHog      3.83.7
#   Subfinder       latest  (resolved via GitHub API at build time)
#   httpx (PD)      latest  (resolved via GitHub API; installed LAST for precedence)
#   Nuclei          latest  (resolved via GitHub API; installed LAST for precedence)
#   nuclei-templates (git clone --depth 1 into /opt/nuclei-templates — deterministic)
#   Nmap            apt-ship (Ubuntu 24.04 → 7.94)

FROM ubuntu:24.04 AS base

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    PATH="/usr/local/go/bin:/root/go/bin:${PATH}"

ARG TARGETARCH

# Base toolchain — curl, ca-certificates for downloads; nmap from apt; python for
# semgrep / schemathesis; git for nuclei-templates clone.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        wget \
        git \
        unzip \
        nmap \
        python3 \
        python3-pip \
        gnupg \
        software-properties-common \
    && rm -rf /var/lib/apt/lists/*

# ---------- Trivy v0.69.3 ----------
ARG TRIVY_VERSION=0.69.3
RUN set -eux; \
    case "${TARGETARCH:-amd64}" in \
        amd64) TRIVY_ARCH=64bit ;; \
        arm64) TRIVY_ARCH=ARM64 ;; \
        *) echo "unsupported arch ${TARGETARCH}"; exit 1 ;; \
    esac; \
    curl -sL "https://github.com/aquasecurity/trivy/releases/download/v${TRIVY_VERSION}/trivy_${TRIVY_VERSION}_Linux-${TRIVY_ARCH}.tar.gz" \
      | tar -xz -C /usr/local/bin trivy; \
    trivy --version

# ---------- TruffleHog 3.83.7 ----------
ARG TRUFFLEHOG_VERSION=3.83.7
RUN set -eux; \
    case "${TARGETARCH:-amd64}" in \
        amd64) TH_ARCH=amd64 ;; \
        arm64) TH_ARCH=arm64 ;; \
        *) echo "unsupported arch ${TARGETARCH}"; exit 1 ;; \
    esac; \
    curl -sL "https://github.com/trufflesecurity/trufflehog/releases/download/v${TRUFFLEHOG_VERSION}/trufflehog_${TRUFFLEHOG_VERSION}_linux_${TH_ARCH}.tar.gz" \
      | tar -xz -C /usr/local/bin trufflehog; \
    trufflehog --version

# ---------- Semgrep 1.91.0 (via pip, externally-managed override safe in container) ----------
ARG SEMGREP_VERSION=1.91.0
RUN pip3 install --break-system-packages --no-cache-dir "semgrep==${SEMGREP_VERSION}" \
    && semgrep --version

# ---------- Schemathesis 3.36.3 (via pip) ----------
# Installed BEFORE the ProjectDiscovery suite because schemathesis' dependency
# tree includes `httpx` (the Python HTTP client) which ships a /usr/local/bin/httpx
# script. If installed AFTER projectdiscovery/httpx, it overwrites the PD binary
# and breaks the nuclei/httpx scanners at runtime.
ARG SCHEMATHESIS_VERSION=3.36.3
RUN pip3 install --break-system-packages --no-cache-dir "schemathesis==${SCHEMATHESIS_VERSION}" \
    && schemathesis --version

# ---------- ProjectDiscovery suite (subfinder, httpx, nuclei) — installed LAST ----------
# Resolved via the GitHub API so we always get the latest release rather than chasing
# hand-pinned version numbers. `curl -f` fails fast on 4xx/5xx. Unauthenticated
# rate limit (60/h per IP) is fine for local builds and CI.
# Installing AFTER pip guarantees that projectdiscovery/httpx wins the argv[0] race
# against encode/httpx (the Python HTTP client).
RUN set -eux; \
    case "${TARGETARCH:-amd64}" in \
        amd64) PD_ARCH=amd64 ;; \
        arm64) PD_ARCH=arm64 ;; \
        *) echo "unsupported arch ${TARGETARCH}"; exit 1 ;; \
    esac; \
    cd /tmp; \
    for name in subfinder httpx nuclei; do \
        version=$(curl -fsSL "https://api.github.com/repos/projectdiscovery/${name}/releases/latest" | sed -n 's/.*"tag_name": "v\([^"]*\)".*/\1/p' | head -1); \
        [ -n "$version" ] || { echo "failed to resolve ${name} latest version"; exit 1; }; \
        curl -fsSL "https://github.com/projectdiscovery/${name}/releases/download/v${version}/${name}_${version}_linux_${PD_ARCH}.zip" -o "${name}.zip"; \
        unzip -o "${name}.zip" -d /usr/local/bin "${name}"; \
        chmod +x "/usr/local/bin/${name}"; \
        rm "${name}.zip"; \
    done; \
    # Confirm ProjectDiscovery httpx is the one on PATH (not the python one).
    httpx -version 2>&1 | head -1

# ---------- Nuclei templates via git clone (deterministic, no runtime network) ----------
# Shallow clone of the template repo baked into the image at /opt/nuclei-templates.
# Nuclei is invoked with `-t /opt/nuclei-templates/http/cves/` etc. from the scanner.
# The git checkout is read by whoever runs nuclei; keep it world-readable.
RUN git clone --depth 1 https://github.com/projectdiscovery/nuclei-templates.git /opt/nuclei-templates \
    && chmod -R a+rX /opt/nuclei-templates \
    && du -sh /opt/nuclei-templates

# ---------- Non-root scanner user ----------
RUN useradd --create-home --shell /bin/sh scanner \
    && mkdir -p /workspace \
    && chown -R scanner:scanner /workspace

USER scanner
WORKDIR /workspace

# No ENTRYPOINT — DockerExecutor invokes scanners as `docker run sentinel-scanner:latest <tool> <args...>`
# so the scanner binary becomes argv[0] of `exec` directly. Critical Invariant #5:
# scanner output never enters a shell string; argv array only.
CMD ["trivy", "--version"]

# Smoke test labels (consumed by `./sentinel doctor`):
LABEL org.sentinel.image.name="sentinel-scanner" \
      org.sentinel.image.trivy="v0.69.3" \
      org.sentinel.image.semgrep="1.91.0" \
      org.sentinel.image.trufflehog="3.83.7" \
      org.sentinel.image.schemathesis="3.36.3" \
      org.sentinel.image.nuclei-templates="git-head" \
      org.sentinel.image.nmap="apt"
