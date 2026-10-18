# Security Policy

## Reporting a vulnerability

Please report vulnerabilities privately using GitHub security advisories:
<https://github.com/codeSudee/fastapi-keygate/security/advisories/new>

Do not open a public issue for security problems. Include affected versions, reproduction steps, and the impact. You can expect an acknowledgement within a few days.

## Supported versions

Security fixes are made against the latest released version.

## Notes on key storage

API keys are stored only as SHA-256 hashes, plus a non-secret prefix used for lookup. The full key is shown once at creation and cannot be recovered. Treat keys like passwords and never log them.
