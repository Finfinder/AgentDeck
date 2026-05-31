## Objective
Add Dependabot (GitHub Dependabot alerts/PRs), an `npm audit` CI step and CodeQL scanning for JavaScript/TypeScript as a complement to SonarCloud.

## Context
Following the SonarCloud integration, we should add a dedicated dependency and security scanning layer to detect vulnerable npm packages, supply chain issues, and CodeQL security query findings. SonarCloud focuses on code quality and some SAST rules, but SCA (Software Composition Analysis) and CodeQL security queries provide additional coverage.

## Scope
- Configure Dependabot for npm (`.github/dependabot.yml`) with a weekly update schedule and sensible ecosystem settings.
- Add an `npm audit` job/step to CI that runs `npm ci --ignore-scripts` and `npm audit --audit-level=moderate --json` and fails or warns per policy.
- Add a `.github/workflows/codeql.yml` workflow configured for `javascript` and `typescript` using the default CodeQL packs.
- Document the remediation policy (reviewers, auto-merge rules, severity thresholds) in `SECURITY.md` or `docs/`.

## Rationale
SonarCloud is valuable for SAST and quality metrics, but third-party dependency vulnerabilities and CodeQL security detections are a different risk category. Combining SCA (Dependabot/npm audit) with CodeQL increases our defense-in-depth.

## Benefits
- Better detection of vulnerable npm packages and supply-chain issues.
- Faster time-to-remediation for CVEs through Dependabot PRs.
- Additional CodeQL detections for security anti-patterns not covered by SonarCloud.
- Improves overall security posture and reduces dependency-regression risk.

## Definition of Done
- [ ] `.github/dependabot.yml` exists with an appropriate schedule and scope.
- [ ] CI contains an `npm audit` job/step producing machine-readable output and enforcing the audit policy.
- [ ] `.github/workflows/codeql.yml` is configured for `javascript`/`typescript` and enabled.
- [ ] Documentation in `SECURITY.md` or `docs/` describes the dependency remediation policy and CodeQL review process.
- [ ] Labels/triage rules defined for Dependabot PRs (e.g., `dependabot`, `security`, `priority:high`).

## Milestone
1.0 Stabilizacja MVP
