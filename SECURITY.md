# Security Policy

AgentDeck is a local-first desktop IDE prototype. This policy covers the application code, GitHub Actions workflows, npm dependencies, security scanning configuration, and repository documentation.

## Reporting Vulnerabilities

Do not publish exploit details, secrets, tokens, private credentials, or reproduction data for an active vulnerability in public issues, pull requests, workflow logs, or chat transcripts.

Use GitHub private vulnerability reporting or a GitHub Security Advisory when it is available for this repository. If private reporting is not available, contact the maintainers through a private channel first and include only the minimum information needed to triage the issue.

## Dependency Remediation

AgentDeck uses npm and a committed `package-lock.json` as the source of truth for dependency resolution. Dependency updates are managed through human-reviewed pull requests.

- `npm audit --audit-level=moderate --json` is the blocking dependency audit threshold for CI.
- `moderate`, `high`, and `critical` vulnerabilities must be triaged before merge.
- `high` and `critical` findings take priority over routine version updates.
- Do not run `npm audit fix` blindly in CI or in pull requests; review lockfile changes and release notes.

## Dependabot Pull Requests

Dependabot monitors npm dependencies in the repository root on a weekly schedule. Dependabot pull requests are labeled with `dependabot`, `security`, and `priority:high` for triage visibility.

Dependabot pull requests are not auto-merged. A maintainer must review the diff, confirm that required checks are green, and decide whether the update is safe for the current development branch.

## Code Scanning

CodeQL runs for JavaScript and TypeScript as an additional code scanning layer alongside SonarCloud. CodeQL alerts should be reviewed in GitHub Code Scanning after the first successful workflow run.

False positives and accepted risks require a short written justification linked to the relevant issue or pull request. Suppressions should be narrow and should not hide broader classes of findings.

## Secrets and CI Logs

Do not commit secrets, tokens, private registry credentials, `.env` files, or local authentication material. Do not paste secret values into issue text, pull request comments, workflow logs, documentation, or chat.

GitHub Actions workflows should keep `permissions: {}` at the workflow root and grant only the job-level permissions required by each tool. New external actions must be pinned by full commit SHA.
