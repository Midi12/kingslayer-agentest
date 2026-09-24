# ADR-0001: CI platform

- Status: accepted
- Date: 2026-09-24
- Module: program

## Context

The spec assumes GitLab CI (`.gitlab-ci.yml`, a GitLab CI component). The repository is hosted on GitHub.

## Decision

GitHub Actions is the active pipeline (`.github/workflows/`). `.gitlab-ci.yml` is kept as a working reference with the same jobs. Both call only `pnpm gate …`, `pnpm scenario …` and `docker buildx bake`, so the logic lives in the repository, not in the CI definition. The GitLab CI kit for customers (M15) is unaffected.

## Consequences

Moving CI is a file change, not a rewrite. The `gate-guard` job reads the diff range from the CI platform's variables.
