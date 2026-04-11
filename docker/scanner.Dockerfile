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
# Pinned versions (do NOT use `latest` — bumps require a baseline regression test):
#   Trivy        v0.69.3
#   Semgrep      1.91.0
#   TruffleHog   3.83.7
#   Subfinder    2.6.6
#   httpx        1.6.10
#   Nuclei       3.3.7
#   Schemathesis 3.36.3 (via pipx)
#   Nmap         (apt — Ubuntu 24.04 ships 7.94)

FROM ubuntu:24.04 AS base

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    PATH="/usr/local/go/bin:/root/go/bin:/opt/pipx/bin:${PATH}"

ARG TARGETARCH

# Base toolchain — curl, ca-certificates for downloads; nmap from apt; python for schemathesis; git for repo cloning.
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        wget \
        git \
        unzip \
        nmap \
        python3 \
        python3-pip \
        pipx \
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

# ---------- Semgrep 1.91.0 (via pipx) ----------
ARG SEMGREP_VERSION=1.91.0
RUN pipx install --global "semgrep==${SEMGREP_VERSION}" \
    && semgrep --version

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

# ---------- ProjectDiscovery suite (subfinder, httpx, nuclei) ----------
ARG SUBFINDER_VERSION=2.6.6
ARG HTTPX_VERSION=1.6.10
ARG NUCLEI_VERSION=3.3.7
RUN set -eux; \
    case "${TARGETARCH:-amd64}" in \
        amd64) PD_ARCH=amd64 ;; \
        arm64) PD_ARCH=arm64 ;; \
        *) echo "unsupported arch ${TARGETARCH}"; exit 1 ;; \
    esac; \
    cd /tmp; \
    for tool in \
        "subfinder:${SUBFINDER_VERSION}" \
        "httpx:${HTTPX_VERSION}" \
        "nuclei:${NUCLEI_VERSION}"; do \
        name="${tool%:*}"; \
        version="${tool#*:}"; \
        curl -sL "https://github.com/projectdiscovery/${name}/releases/download/v${version}/${name}_${version}_linux_${PD_ARCH}.zip" -o "${name}.zip"; \
        unzip -o "${name}.zip" -d /usr/local/bin "${name}"; \
        chmod +x "/usr/local/bin/${name}"; \
        rm "${name}.zip"; \
    done

# ---------- Schemathesis 3.36.3 (via pipx) ----------
ARG SCHEMATHESIS_VERSION=3.36.3
RUN pipx install --global "schemathesis==${SCHEMATHESIS_VERSION}" \
    && schemathesis --version

# ---------- Update Nuclei templates at build time ----------
RUN nuclei -update-templates -silent || true

# ---------- Non-root scanner user ----------
RUN useradd --create-home --shell /bin/sh scanner \
    && mkdir -p /workspace \
    && chown -R scanner:scanner /workspace

USER scanner
WORKDIR /workspace

ENTRYPOINT ["/bin/sh", "-c"]
CMD ["echo 'sentinel-scanner image — invoked via DockerExecutor with explicit argv'"]

# Smoke test labels (consumed by `./sentinel doctor`):
LABEL org.sentinel.image.name="sentinel-scanner" \
      org.sentinel.image.trivy="v0.69.3" \
      org.sentinel.image.semgrep="1.91.0" \
      org.sentinel.image.trufflehog="3.83.7" \
      org.sentinel.image.subfinder="2.6.6" \
      org.sentinel.image.httpx="1.6.10" \
      org.sentinel.image.nuclei="3.3.7" \
      org.sentinel.image.schemathesis="3.36.3" \
      org.sentinel.image.nmap="apt"
