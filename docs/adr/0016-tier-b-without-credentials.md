# ADR-0016: Tier B gates without credentials

- Status: accepted
- Date: 2026-09-24
- Module: program

## Decision

Tier B gates are implemented completely: datasets, harness, metrics and pass expressions. When `TYPESAFE_API_KEY` or the LLM key is absent, the gate runner reports `not_run` with the missing variable names, and evidence records it. A Tier B gate is never satisfied by fakes or cassettes recorded from fakes. The go or no-go (M19-G1, M19-G2) stays open until a run with real keys.
