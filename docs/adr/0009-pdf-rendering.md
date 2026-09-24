# ADR-0009: PDF rendering location

- Status: accepted
- Date: 2026-09-24
- Module: program

## Decision

PDF reports are rendered by a `render` job that any runner leases, because runners already own Chromium. The api keeps its image small and never launches a browser. `argus-admin` can render locally when a runner image is used to run it.
