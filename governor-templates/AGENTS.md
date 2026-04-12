# Scanner Agents — Runtime Registry for the Governor

> This file ships at `governor-templates/AGENTS.md` and is copied verbatim into `workspaces/<scanId>/AGENTS.md` at the start of every governed scan.
>
> It defines every scanner's capabilities, known false positive patterns, and noise signatures so the governor can make accurate triage decisions.

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
- **Limitations**: no code-level analysis, no runtime testing, no taint tracking. Reports CVEs in ALL dependencies regardless of whether the vulnerable function is called. Pinned version v0.69.3 — schema may differ on upgrade.
- **Configurable**: `scanners` (vuln / secret / misconfig subset), `severity-filter`.

### Trivy — Known False Positives

1. **devDependency CVEs**: Trivy scans the lockfile and reports CVEs in ALL packages including `devDependencies` (test frameworks, linters, bundlers). These never ship to production. **Action**: Discard unless CRITICAL AND there is evidence of dev/prod boundary breach.
2. **Dockerfile lint rules (IaC category)**: "Use WORKDIR instead of RUN cd", "No HEALTHCHECK defined", "Pin versions in apt-get install", "Add USER instruction". These are Docker best practices, not security vulnerabilities. **Action**: Discard from security findings entirely. Do not include in the report as vulnerabilities.
3. **Unreachable CVEs in transitive dependencies**: Trivy reports CVEs in deeply nested transitive dependencies that the application code never imports. Without Semgrep taint confirmation, these are speculative. **Action**: Downgrade to LOW unless corroborated by Semgrep.
4. **`will_not_fix` CVEs in OS packages**: Base image packages where the distro maintainer has decided not to patch. **Action**: Keep but downgrade urgency and note "no fix available from upstream".
5. **Duplicate CVEs across lockfile entries**: The same CVE may appear multiple times if the same vulnerable package appears at different lockfile resolution paths. **Action**: Deduplicate by CVE ID — report once with all affected paths.
6. **Secret detection in example/template files**: Trivy's secret scanner may flag strings in `.env.example`, `config.sample.yml`, or documentation. **Action**: Discard if the file is clearly a template (check filename pattern).

## semgrep

- **Upstream**: https://github.com/semgrep/semgrep
- **Type**: SAST (static analysis / pattern matching / taint)
- **Phase**: 1
- **Requires URL**: no
- **Input**: repo path
- **Output**: JSON with `.results[]` — one entry per rule match
- **Category**: `sast`
- **Strengths**: taint analysis, code pattern matching, TypeScript / JavaScript / Python / Go / Java / Ruby / PHP. Community rule packs with rule metadata (severity, confidence, category).
- **Limitations**: single-file analysis in OSS mode; no cross-file taint in free tier. Many rules are `audit` category (advisory) not `vulnerability` category (confirmed). Schema differs across 1.x and 2.x — parser is defensive.
- **Configurable**: `config` = comma-separated rule packs (e.g., `p/typescript,p/nodejs,p/jwt`). Default `p/default`.

### Semgrep — Known False Positives

1. **`spawn-shell-true` in controlled contexts**: Rule flags ANY use of `spawn()` or `exec()` with `shell: true`. But `shell: true` is required on Windows for `.cmd`/`.bat` wrappers after Node.js CVE-2024-27980 hardening. If the code has a comment explaining why, or limits `shell: true` to specific file extensions (`.cmd`, `.bat`), this is an intentional security trade-off, not a vulnerability. **Action**: Discard if the code has a documented justification AND the shell argument is not user-controlled.
2. **`eval()` in build/config contexts**: Rule flags ALL `eval()` usage, but `eval()` in build scripts, template engines, or developer tooling is not a request-handling vulnerability. **Action**: Discard if the file is a build script, CLI tool, or config loader — not a web handler.
3. **`dangerouslySetInnerHTML` with server-controlled content**: React's `dangerouslySetInnerHTML` is flagged universally, but when the content is generated server-side (not from user input), it is not XSS. **Action**: Discard if the content source is server-generated or sanitized. Keep if content includes any user-controlled input.
4. **Prisma `$queryRaw` with tagged template literals**: Semgrep may flag `$queryRaw\`SELECT ...\`` as SQL injection, but Prisma's tagged template literal syntax is automatically parameterized — it is NOT string interpolation. `$queryRawUnsafe()` IS vulnerable. **Action**: Discard `$queryRaw` with tagged templates. KEEP `$queryRawUnsafe`.
5. **`audit` category rules**: Rules tagged with `semgrep.dev` metadata `category: audit` are advisory matches — "this code pattern COULD be problematic, review it." They are NOT confirmed vulnerabilities. **Action**: Downgrade to MEDIUM or LOW. Do not treat as confirmed vulnerabilities in the report.
6. **Password/secret detection on hash constants**: Rule may flag `const PASSWORD_HASH = '$2b$10$...'` as a hardcoded password. This is a bcrypt/argon2 hash output, not a cleartext password. **Action**: Discard if the value matches hash format (`$2b$`, `$argon2`, SHA-256 hex, etc.).
7. **ReDoS (Regular Expression Denial of Service)**: Rule flags potentially catastrophic regex patterns, but if the regex input is bounded (e.g., validated email field with max length), ReDoS is not exploitable. **Action**: Downgrade to INFO if input length is bounded. Keep as MEDIUM if input is unbounded user input.
8. **`console.log` in CLI tools**: Rule may flag `console.log` as information disclosure. In a CLI application (not a web server), stdout logging is the expected output mechanism. **Action**: Discard if the project is a CLI tool. Keep if the project is a web server and the log may contain sensitive data.
9. **Cross-language rule matches**: When using broad rule packs, Semgrep may apply PHP rules to TypeScript files or Python rules to JavaScript files if the syntax happens to overlap. **Action**: Discard if the rule language does not match the file language.

## trufflehog

- **Upstream**: https://github.com/trufflesecurity/trufflehog
- **Type**: Secret scanner
- **Phase**: 1
- **Requires URL**: no
- **Input**: repo path (scans git history + working tree)
- **Output**: JSON lines — one object per line
- **Category**: `secret`
- **Severity**: HIGH when `Verified == true`, MEDIUM otherwise.
- **Strengths**: finds secrets in git history; actively verifies if a secret is still valid against the service it belongs to. Detects 800+ secret types (API keys, tokens, passwords, certificates).
- **Limitations**: git history only; does not scan running applications. Verification may fail if the service is down or rate-limited (resulting in `Verified: false` for a still-valid secret).
- **Security note**: the `Raw` field contains the actual secret value. Sentinel redacts this to `[REDACTED:<fingerprint>]` before the finding enters correlation or reports. The governor sees only the fingerprint and file path, never the raw value.

### TruffleHog — Known False Positives

1. **Test fixtures and mock data**: Secrets in `__tests__/`, `test/fixtures/`, `*.spec.*`, `*.test.*`, `mock/`, `seed/` directories. These are test data, not real credentials. **Action**: Discard unless the secret format matches a production service (e.g., real AWS key format in a test file — still warrants rotation).
2. **Example/template files**: Secrets in `.env.example`, `config.sample.yml`, `*.template`, `docker-compose.example.yml`. These are placeholder values. **Action**: Discard.
3. **Public keys**: RSA public keys, EC public keys, SSH public keys reported as "secret". Public keys are meant to be distributed. **Action**: Discard. Only PRIVATE keys are findings.
4. **Low-sensitivity service keys**: Sentry DSN, Google Analytics tracking IDs, public Stripe publishable keys (`pk_live_`/`pk_test_`), Firebase client-side config. These are designed to be embedded in client-side code. **Action**: Downgrade to LOW. Note in report but do not treat as critical.
5. **`Verified: false` with old commit date**: Secret found in a commit from months/years ago, verification failed. The secret was likely rotated since then. **Action**: Downgrade to MEDIUM. Still note it because it SHOULD be rotated if not already — but do not escalate to Shannon.
6. **Documentation examples**: Secrets in README.md, CONTRIBUTING.md, or docs/ directories. These are typically example values. **Action**: Discard unless the format matches a real key pattern AND the value has high entropy.
7. **Committed and removed**: Secret was added in commit A and removed in commit B (file now in `.gitignore`). TruffleHog still finds it in git history. **Action**: KEEP — this is a real finding. The secret is in the git history and needs rotation regardless of current file state.

## subfinder

- **Upstream**: https://github.com/projectdiscovery/subfinder
- **Type**: Subdomain discovery
- **Phase**: 1
- **Requires URL**: yes (derives domain from URL)
- **Input**: domain
- **Output**: JSON lines with `.host`
- **Writes to**: `ScanContext.discoveredSubdomains` (does not produce findings)
- **Strengths**: passive subdomain enumeration across public sources (cert transparency, DNS, search engines).
- **Limitations**: passive only, no active brute-force. Some sources require API keys for full coverage.

### Subfinder — Known False Positives

1. **Wildcard DNS**: Some domains have wildcard DNS records (`*.example.com` resolves to any subdomain). Subfinder may report thousands of non-existent subdomains. **Action**: If subfinder returns more than 500 subdomains, suspect wildcard DNS and note the caveat.
2. **Stale DNS records**: Subdomains that no longer resolve or point to decommissioned infrastructure. httpx will filter these (no response), but the governor should not assume all discovered subdomains are live.

## httpx

- **Upstream**: https://github.com/projectdiscovery/httpx
- **Type**: HTTP prober
- **Phase**: 1
- **Requires URL**: yes (reads hosts from subfinder output)
- **Input**: list of hosts from `ScanContext.discoveredSubdomains`
- **Output**: JSON lines with `.url`, `.status_code`, `.technologies`
- **Writes to**: `ScanContext.discoveredEndpoints`
- **Strengths**: confirms live endpoints, detects technologies (frameworks, servers, CMSs). Fast. Filters dead subdomains.
- **Limitations**: surface-level only — no deep crawling. Technology detection is header/response-based and may miss non-standard setups.

### httpx — Known False Positives

1. **Technology misdetection**: httpx detects technologies based on response headers and body patterns. A custom "Powered by X" string in an error page may cause false technology attribution. **Action**: Do not base scanner selection decisions on httpx technology detection alone — cross-reference with file tree analysis.
2. **WAF/CDN responses**: Endpoints behind Cloudflare or other WAFs may return the WAF's error pages, leading httpx to report the WAF's technology stack instead of the origin's. **Action**: Note "endpoint is behind WAF" as a caveat.

## nuclei

- **Upstream**: https://github.com/projectdiscovery/nuclei (templates: https://github.com/projectdiscovery/nuclei-templates)
- **Type**: Template-based vulnerability scanner
- **Phase**: 2
- **Requires URL**: yes
- **Input**: URLs from `ScanContext.discoveredEndpoints`
- **Output**: JSON lines with `.info.severity`, `.matched-at`, `.template-id`
- **Category**: depends on template (`dependency`, `misconfig`, `dast`, `network`)
- **Strengths**: 12,000+ community templates, fast, known-CVE detection, exposed-panel detection.
- **Limitations**: template-based — only finds what templates exist for. Many templates match on URL patterns or response strings that can appear in non-vulnerable contexts. High false positive rate without corroboration. Emits progress to stderr even with `-silent` (not an error).
- **Configurable**: `templates` = list of template directories (default: `cves/`, `misconfiguration/`, `exposed-panels/`), `rateLimit` = requests per second (default 150).
- **Governor note**: You can narrow templates based on detected stack. Do NOT override the rate limit set in the scan plan.

### Nuclei — Known False Positives

1. **Wrong tech stack templates**: Nuclei runs ALL selected templates against ALL discovered endpoints. A WordPress login template will match any URL returning a page containing "Username" and "Password" form fields — including NestJS, Django, or any custom login page. **Action**: Discard if template targets technology not present in the scanned project. Check `template-id` prefix (e.g., `wordpress-` templates on a non-WordPress site).
2. **`info` severity templates**: These are technology detection templates (server version, framework fingerprint, CMS detection). They are reconnaissance data, not vulnerabilities. **Action**: Do not include in findings. Move to the report's "Scan Context" section as technology observations.
3. **Error page pattern matches**: Some templates match on strings that commonly appear in error pages (404, 500). A template looking for "Internal Server Error" may match any application that returns that generic error text. **Action**: Discard if the match is on a generic error page response.
4. **Exposed panel detection for public login pages**: Templates like `exposed-panel-detect` match on login forms. But a login page IS the intended public entry point — it's not "exposed" in the vulnerability sense. **Action**: Discard unless the panel should NOT be public (admin panels, debug consoles, phpMyAdmin, etc.).
5. **Template duplicates**: Multiple templates may match the same endpoint for the same underlying issue (e.g., three different templates detecting the same WordPress vulnerability). **Action**: Keep the most specific template match, discard duplicates.
6. **Rate-limited false negatives/positives**: If the target rate-limits responses (429), Nuclei may receive truncated or error responses that match templates incorrectly. **Action**: Note rate-limiting as a caveat if many findings come from templates matching error responses.

## schemathesis

- **Upstream**: https://github.com/schemathesis/schemathesis
- **Type**: Property-based API fuzzer
- **Phase**: 2
- **Requires URL**: yes
- **Requires**: OpenAPI spec (`ScanContext.openApiSpec`)
- **Input**: OpenAPI spec + base URL
- **Output**: JUnit XML or stderr; failures become findings
- **Category**: `api`
- **Strengths**: property-based API testing, finds edge cases, unusual status codes, schema violations. Tests contract compliance.
- **Limitations**: needs an OpenAPI spec; does not test business logic; false positives on aggressive fuzzing settings. May crash against APIs with complex auth flows.

### Schemathesis — Known False Positives

1. **500 errors on intentionally invalid input**: Some APIs return 500 for edge cases that are not security vulnerabilities (missing error handling for extreme input sizes, etc.). **Action**: Keep if the 500 indicates a crash or stack trace leak. Discard if it's a graceful error response with status 500.
2. **Schema violations on optional fields**: API may omit optional response fields that the OpenAPI spec declares. This is a spec accuracy issue, not a security vulnerability. **Action**: Downgrade to INFO.
3. **Status code mismatches**: Expected 200, got 201 (or vice versa). This is a spec documentation issue. **Action**: Discard unless the status code indicates an auth bypass (expected 401, got 200).
4. **Timeout on slow endpoints**: Schemathesis may flag endpoints that take too long as failures. **Action**: Discard unless the timeout is reproducible and suggests a DoS condition.

## nmap

- **Upstream**: https://github.com/nmap/nmap
- **Type**: Port scanner + service fingerprinter
- **Phase**: 2
- **Requires URL**: yes
- **Input**: hostname (extracted from URL)
- **Output**: XML
- **Category**: `network`
- **Strengths**: port discovery, service / version fingerprinting, NSE script scanning.
- **Limitations**: network-level only; no application logic. Firewalls may filter results.
- **Configurable**: port range (default `--top-ports 1000`), NSE categories (not enabled by default).

### Nmap — Known False Positives

1. **Intentional open ports**: Port 22 (SSH), 80 (HTTP), 443 (HTTPS) on a VPS are intentional. These are the services the server is supposed to run. **Action**: Discard unless the service version has a known CVE (cross-reference with Trivy).
2. **Filtered ports**: Nmap reports ports as "filtered" when a firewall drops packets. This is correct security behavior, not a finding. **Action**: Do not report filtered ports as findings.
3. **Service version banners**: Nmap reports "nginx/1.25.3" or "OpenSSH_9.2p1". These are informational — only report if the specific version has a known CVE. **Action**: Cross-reference version with Trivy CVE data. If no CVE, move to recon section.
4. **High-numbered ephemeral ports**: Ports in the 49152-65535 range may be temporarily open for outbound connections or container networking. **Action**: Discard unless the port is consistently open across multiple scans or hosts a recognizable service.

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
- **Strengths**: autonomous exploitation, proof-by-exploit, auth bypass, injection, business-logic flaws. Uses findings from Phase 1 + Phase 2 as hypotheses. When Shannon confirms a vulnerability with an exploit PoC, the finding confidence is definitive.
- **Limitations**: expensive (time and compute); requires AI subscription; limited vuln categories (focuses on web auth, injection, IDOR, SSRF). May produce false positives if the application has unusual error handling that mimics exploitation success.
- **Governor note**: Only escalate findings with a plausible exploit path and supporting scanner evidence. Do not escalate CVEs without reachability evidence. Maximum 10 escalations per scan.

### Shannon — Known False Positives

1. **"Confirmed" exploit that only returned a different error message**: Shannon may interpret a 403 instead of 401, or a detailed error message instead of a generic one, as "exploitation confirmed." Verify that the exploit PoC demonstrates actual unauthorized access or data leakage, not just a different error path. **Action**: Downgrade if the PoC shows different error handling but no actual security bypass.
2. **Rate-limited responses interpreted as WAF bypass**: If a WAF starts blocking requests partway through Shannon's testing, the changing response patterns may be interpreted as a vulnerability. **Action**: Note WAF interference as a caveat.

---

## Scanner Quick Reference Table

| Scanner | Phase | URL? | Category | When to Enable | FP Risk |
|---------|-------|------|----------|----------------|---------|
| trivy | 1 | no | dependency + secret + iac | Always | Medium (devDeps, Dockerfile lint) |
| semgrep | 1 | no | sast | Always (pick rule packs per stack) | High (audit rules, cross-language) |
| trufflehog | 1 | no | secret | Always | Medium (test fixtures, public keys) |
| subfinder | 1 | yes | recon | Only if URL present and target has subdomains | Low |
| httpx | 1 | yes | recon | Only if subfinder enabled | Low |
| nuclei | 2 | yes | vuln (broad) | Only if URL present; pick templates per stack | High (wrong stack templates) |
| schemathesis | 2 | yes + spec | api | Only if OpenAPI spec exists in repo | Medium (schema vs security) |
| nmap | 2 | yes | network | Only if URL present and reachable | Low (mostly informational) |
| shannon | 3 | yes + gov CLI | dast | Only if governor escalates at least one target | Low (exploit-confirmed) |

---

## Notes for the Governor

- You may DISABLE a scanner in the scan plan with a reason. The pipeline will skip it cleanly.
- You CAN override default configs per scanner via `scannerConfigs` in the scan plan.
- You CAN narrow Nuclei template sets based on detected stack — be specific: `cves/, misconfiguration/, exposed-panels/` for generic web; add `wordpress/` for WordPress targets; add `jira/` for Jira; etc.
- You CANNOT propose a scanner that isn't in this file. The mechanical registry is the source of truth.
- You CANNOT execute tools directly. You write a scan plan; the mechanical pipeline runs the tools.
- Always narrow Semgrep rule packs to the detected language and framework. `p/default` alone generates excessive noise from cross-language matches.
- Always cross-reference Trivy CVEs with Semgrep taint findings. A CVE without a reachable code path is a dependency issue, not an application vulnerability.
- When multiple scanners find related issues, correlate them explicitly in your evaluation. Cross-scanner correlation is your highest-value contribution.

---

*This file ships with Sentinel at `governor-templates/AGENTS.md`. For the AGENTS.md used by agents BUILDING Sentinel, see the repo root `AGENTS.md`.*
