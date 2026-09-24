# ADR-0007: Chromium sandboxing

- Status: accepted
- Date: 2026-09-24
- Module: program

## Decision

On Docker the runner keeps Chromium's sandbox, using the seccomp profile `deploy/seccomp/chromium.json` that allows the namespace syscalls without `SYS_ADMIN`. On Kubernetes under the `restricted` pod security standard the pod is the boundary and Chromium runs with `--no-sandbox`. Hosts that cannot load the profile set `ARGUS_CHROMIUM_SANDBOX=off`. The mode is written into `run.started`.
