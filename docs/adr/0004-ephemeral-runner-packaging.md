# ADR-0004: Ephemeral CI runner packaging

- Status: accepted
- Date: 2026-09-24
- Module: program

## Decision

The `argus` CLI ships inside `argus/runner` as well as in `argus/cli`. `argus run --ephemeral` in a CI job that uses the runner image starts an in-process runner, drains the suite and exits with the CLI exit code. No Docker socket and no service container are needed.
