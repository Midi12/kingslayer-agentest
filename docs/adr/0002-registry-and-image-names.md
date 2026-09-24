# ADR-0002: Registry and image names

- Status: accepted
- Date: 2026-09-24
- Module: program

## Decision

Images are published as `ghcr.io/midi12/argus/<image>` with tags `<semver>`, `<major>.<minor>`, `<major>`, `sha-<short>` and `edge`. Every Compose file, the Helm chart and `install.sh` read the registry from `ARGUS_REGISTRY`, so a customer mirror or an air-gap bundle replaces it with one variable. Local builds tag `argus/<image>:dev`.
