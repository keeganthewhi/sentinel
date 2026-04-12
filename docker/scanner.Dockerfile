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
#   Subfinder       2.6.7
#   httpx (PD)      1.6.9   (installed LAST for argv[0] precedence over Python httpx)
#   Nuclei          3.3.7   (installed LAST for precedence)
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
# Pinned to specific versions for reproducibility and supply-chain safety.
# Installing AFTER pip guarantees that projectdiscovery/httpx wins the argv[0] race
# against encode/httpx (the Python HTTP client).
ARG SUBFINDER_VERSION=2.6.7
ARG HTTPX_PD_VERSION=1.6.9
ARG NUCLEI_VERSION=3.3.7
RUN set -eux; \
    case "${TARGETARCH:-amd64}" in \
        amd64) PD_ARCH=amd64 ;; \
        arm64) PD_ARCH=arm64 ;; \
        *) echo "unsupported arch ${TARGETARCH}"; exit 1 ;; \
    esac; \
    cd /tmp; \
    curl -fsSL "https://github.com/projectdiscovery/subfinder/releases/download/v${SUBFINDER_VERSION}/subfinder_${SUBFINDER_VERSION}_linux_${PD_ARCH}.zip" -o subfinder.zip; \
    unzip -o subfinder.zip -d /usr/local/bin subfinder; \
    chmod +x /usr/local/bin/subfinder; \
    rm subfinder.zip; \
    curl -fsSL "https://github.com/projectdiscovery/httpx/releases/download/v${HTTPX_PD_VERSION}/httpx_${HTTPX_PD_VERSION}_linux_${PD_ARCH}.zip" -o httpx.zip; \
    unzip -o httpx.zip -d /usr/local/bin httpx; \
    chmod +x /usr/local/bin/httpx; \
    rm httpx.zip; \
    curl -fsSL "https://github.com/projectdiscovery/nuclei/releases/download/v${NUCLEI_VERSION}/nuclei_${NUCLEI_VERSION}_linux_${PD_ARCH}.zip" -o nuclei.zip; \
    unzip -o nuclei.zip -d /usr/local/bin nuclei; \
    chmod +x /usr/local/bin/nuclei; \
    rm nuclei.zip; \
    # Confirm ProjectDiscovery httpx is the one on PATH (not the python one).
    httpx -version 2>&1 | head -1

# ---------- Nuclei templates via git clone (deterministic, no runtime network) ----------
# Clone the template repo baked into the image at /opt/nuclei-templates.
# Pinned to a specific commit for reproducibility and supply-chain safety.
# Nuclei is invoked with `-t /opt/nuclei-templates/http/cves/` etc. from the scanner.
# The git checkout is read by whoever runs nuclei; keep it world-readable.
ARG NUCLEI_TEMPLATES_COMMIT=main
RUN git clone https://github.com/projectdiscovery/nuclei-templates.git /opt/nuclei-templates \
    && cd /opt/nuclei-templates && git checkout "${NUCLEI_TEMPLATES_COMMIT}" \
    && rm -rf .git \
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
      org.sentinel.image.subfinder="2.6.7" \
      org.sentinel.image.httpx="1.6.9" \
      org.sentinel.image.nuclei="3.3.7" \
      org.sentinel.image.nuclei-templates="git-head" \
      org.sentinel.image.nmap="apt"
