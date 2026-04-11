# Scanner Agents — Runtime Registry for the Governor

> This file ships at `governor-templates/AGENTS.md` and is copied verbatim into `workspaces/<scanId>/AGENTS.md` at the start of every governed scan.
>
> It defines every scanner's capabilities so the governor knows what's available when generating the scan plan and evaluating results.

---

## trivy

- **Upstream**: https://github.com/aquasecurity/trivy
- **Type**: SCA + secret + IaC scanner
- **Phase**: 1
- **Requires URL**: no
- **Input**: repo path (mounted read-only at `/workspace`)
- **Output**: JSON with `.Results[].Vulnerabilities[]`, `.Results[].Secrets[]`, `.Results[].Misconfigurations[]`
- **Category mapping**: vuln → `dependency`, secret → `secret`, misconfig → `iac`
- **Strengths**: dependency CVEs, container misconfigs, embedded secrets, IaC issues (Terraform, Dockerfile, Kubernetes YAML). Fast. Broad coverage.
- **Limitations**: no code-level analysis, no runtime testing, no taint tracking. Pinned version v0.69.3 — schema may differ on upgrade.
- **Configurable**: `scanners` (vuln / secret / misconfig subset), `severity-filter`.

## semgrep

- **Upstream**: https://github.com/semgrep/semgrep
- **Type**: SAST (static analysis / pattern matching / taint)
- **Phase**: 1
- **Requires URL**: no
- **Input**: repo path
- **Output**: JSON with `.results[]` — one entry per rule match
- **Category**: `sast`
- **Strengths**: taint analysis, code pattern matching, TypeScript / JavaScript / Python / Go / Java / Ruby / PHP. Community rule packs.
- **Limitations**: single-file analysis in OSS mode; no cross-file taint in free tier. Schema differs across 1.x and 2.x — parser is defensive.
- **Configurable**: `config` = comma-separated rule packs (e.g., `p/typescript,p/nodejs,p/jwt`). Default `p/default`.

## trufflehog

- **Upstream**: https://github.com/trufflesecurity/trufflehog
- **Type**: Secret scanner
- **Phase**: 1
- **Requires URL**: no
- **Input**: repo path (scans git history + working tree)
- **Output**: JSON lines — one object per line
- **Category**: `secret`
- **Severity**: HIGH when `Verified == true`, MEDIUM otherwise.
- **Strengths**: finds secrets in git history; actively verifies if a secret is still valid against the service it belongs to.
- **Limitations**: git history only; does not scan running applications.
- **Security note**: the `Raw` field contains the actual secret value. Sentinel redacts this to `[REDACTED:<fingerprint>]` before the finding enters correlation or reports. The governor sees only the fingerprint and file path, never the raw value.

## subfinder

- **Upstream**: https://github.com/projectdiscovery/subfinder
- **Type**: Subdomain discovery
- **Phase**: 1
- **Requires URL**: yes (derives domain from URL)
- **Input**: domain
- **Output**: JSON lines with `.host`
- **Writes to**: `ScanContext.discoveredSubdomains` (does not produce findings)
- **Strengths**: passive subdomain enumeration across public sources.
- **Limitations**: passive only, no active brute-force.

## httpx

- **Upstream**: https://github.com/projectdiscovery/httpx
- **Type**: HTTP prober
- **Phase**: 1
- **Requires URL**: yes (reads hosts from subfinder output)
- **Input**: list of hosts from `ScanContext.discoveredSubdomains`
- **Output**: JSON lines with `.url`, `.status_code`, `.technologies`
- **Writes to**: `ScanContext.discoveredEndpoints`
- **Strengths**: confirms live endpoints, detects technologies (frameworks, servers, CMSs).
- **Limitations**: surface-level only — no deep crawling.

## nuclei

- **Upstream**: https://github.com/projectdiscovery/nuclei (templates: https://github.com/projectdiscovery/nuclei-templates)
- **Type**: Template-based vulnerability scanner
- **Phase**: 2
- **Requires URL**: yes
- **Input**: URLs from `ScanContext.discoveredEndpoints`
- **Output**: JSON lines with `.info.severity`, `.matched-at`, `.template-id`
- **Category**: depends on template (`dependency`, `misconfig`, `dast`, `network`)
- **Strengths**: 12 000+ community templates, fast, known-CVE detection, exposed-panel detection.
- **Limitations**: template-based — only finds what templates exist for. Emits progress to stderr even with `-silent` (not an error).
- **Configurable**: `templates` = list of template directories (default: `cves/`, `misconfiguration/`, `exposed-panels/`), `rateLimit` = requests per second (default 150).
- **Governor note**: You can narrow templates based on detected stack. Do NOT override the rate limit set in the scan plan.

## schemathesis

- **Upstream**: https://github.com/schemathesis/schemathesis
- **Type**: Property-based API fuzzer
- **Phase**: 2
- **Requires URL**: yes
- **Requires**: OpenAPI spec (`ScanContext.openApiSpec`)
- **Input**: OpenAPI spec + base URL
- **Output**: JUnit XML or stderr; failures become findings
- **Category**: `api`
- **Strengths**: property-based API testing, finds edge cases, unusual status codes, schema violations.
- **Limitations**: needs an OpenAPI spec; does not test business logic; false positives on aggressive fuzzing settings.

## nmap

- **Upstream**: https://github.com/nmap/nmap
- **Type**: Port scanner + service fingerprinter
- **Phase**: 2
- **Requires URL**: yes
- **Input**: hostname (extracted from URL)
- **Output**: XML
- **Category**: `network`
- **Strengths**: port discovery, service / version fingerprinting, NSE script scanning.
- **Limitations**: network-level only; no application logic.
- **Configurable**: port range (default `--top-ports 1000`), NSE categories (not enabled by default).

## shannon

- **Upstream (used by Sentinel)**: https://github.com/keeganthewhi/shannon-noapi (fork — no hosted API dependency)
- **Upstream (original)**: https://github.com/KeygraphHQ/shannon
- **Type**: AI-powered DAST (dynamic application security testing) runner
- **Phase**: 3
- **Requires URL**: yes
- **Requires**: governor CLI authenticated on host (Claude Code / Codex / Gemini); `tools/shannon-noapi/` cloned by the bootstrap script
- **Input**: URL + repo + context from prior phases + governor escalation list
- **Output**: Markdown report with proof-of-concept exploits; findings with `exploitProof` field
- **Category**: `dast`
- **Strengths**: autonomous exploitation, proof-by-exploit, auth bypass, injection, business-logic flaws. Uses findings from Phase 1 + Phase 2 as hypotheses.
- **Limitations**: expensive (time); requires AI subscription; limited vuln categories (focuses on web auth, injection, IDOR, SSRF).
- **Governor note**: Only escalate findings with a plausible exploit path and supporting scanner evidence. Do not escalate CVEs without reachability evidence.

---

## Scanner Quick Reference Table

| Scanner | Phase | URL? | Category | When to Enable |
|---------|-------|------|----------|----------------|
| trivy | 1 | no | dependency + secret + iac | Always |
| semgrep | 1 | no | sast | Always (pick rule packs per stack) |
| trufflehog | 1 | no | secret | Always |
| subfinder | 1 | yes | recon | Only if URL present and target has subdomains |
| httpx | 1 | yes | recon | Only if subfinder enabled |
| nuclei | 2 | yes | vuln (broad) | Only if URL present; pick templates per stack |
| schemathesis | 2 | yes + spec | api | Only if OpenAPI spec exists in repo |
| nmap | 2 | yes | network | Only if URL present and reachable |
| shannon | 3 | yes + gov CLI | dast | Only if governor escalates at least one target |

---

## Notes for the Governor

- You may DISABLE a scanner in the scan plan with a reason. The pipeline will skip it cleanly.
- You CAN override default configs per scanner via `scannerConfigs` in the scan plan.
- You CAN narrow Nuclei template sets based on detected stack — be specific: `cves/, misconfiguration/, exposed-panels/` for generic web; add `wordpress/` for WordPress targets; add `jira/` for Jira; etc.
- You CANNOT propose a scanner that isn't in this file. The mechanical registry is the source of truth.
- You CANNOT execute tools directly. You write a scan plan; the mechanical pipeline runs the tools.

---

*This file ships with Sentinel at `governor-templates/AGENTS.md`. For the AGENTS.md used by agents BUILDING Sentinel, see the repo root `AGENTS.md`.*
