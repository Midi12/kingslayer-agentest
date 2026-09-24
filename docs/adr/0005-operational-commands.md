# ADR-0005: Operational commands

- Status: accepted
- Date: 2026-09-24
- Module: program

## Decision

`argus-admin` lives in the `argus/api` image: `migrate`, `bootstrap`, `config validate`, `smoke`, `backup`, `restore`, `upgrade`, `rollback`, `licence load|status|usage-export`. `migrate` and `bootstrap` also run as one-shot Compose services and Helm hook Jobs of the same image. Every command is idempotent and runs in CI.
