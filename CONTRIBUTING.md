# Contributing

Thanks for helping improve fastapi-keygate.

## Development setup

```bash
git clone https://github.com/codeSudee/fastapi-keygate
cd fastapi-keygate
pip install -e ".[dev]" && pytest
```

Python 3.9 or newer is required. Optional extras: `redis`, `postgres`.

## Pull requests

- Branch from `main` and keep each PR focused on one change.
- Add or update tests in `tests/` for any behavior change, and make sure `pytest` passes.
- Update `README.md` for user-facing changes and add an entry to `CHANGELOG.md`.
- Keep the public API backwards compatible where possible; call out breaking changes in the PR.
- Never include real API keys or secrets in code, tests, or issues.

## Release flow

1. Bump `version` in `pyproject.toml` and update `CHANGELOG.md`.
2. Push to `main`.
3. Create a GitHub release with a matching tag (for example `v0.2.1`).
4. The publish workflow builds the package and uploads it to PyPI via trusted publishing.

## Security issues

Do not open public issues for vulnerabilities. See [SECURITY.md](SECURITY.md).
