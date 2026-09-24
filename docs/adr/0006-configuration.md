# ADR-0006: Configuration contract

- Status: accepted
- Date: 2026-09-24
- Module: program

## Decision

One `.env` file configures every service; Helm values mirror the same keys. Precedence: environment variable, then the file named by `<KEY>_FILE`, then the default. `packages/config` holds one TypeBox schema tagged by consuming service. Every service validates at start and exits with code 78 naming the invalid keys, never printing a secret. The key reference is Appendix A of the plan.
