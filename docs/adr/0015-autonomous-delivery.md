# ADR-0015: Autonomous delivery protocol

- Status: accepted
- Date: 2026-09-24
- Module: program

## Context

The spec's protocol assumes merge requests and a human approving each gates merge request. This build runs autonomously on one integration branch.

## Decision

- Each module is developed on `mod/<MOD>` in its own worktree and merged into the integration branch with `--no-ff`.
- The gates-first rule becomes a commit rule: a module's first commit holds its gates, gate tests and goldens; implementation commits never touch protected paths. `gate-guard` checks each commit of a range, and also supports the spec's merge-request mode.
- Every module is reviewed by an independent agent before merge, looking for weakened gates, placeholders and spec deviations.
- Human checkpoints are listed in `docs/checkpoints.md` with the evidence to review. They are pending sign-offs, not waived.
- A Tier B failure or a gate-change is recorded in `docs/gate-changes/` and in `docs/checkpoints.md` for a human decision.
