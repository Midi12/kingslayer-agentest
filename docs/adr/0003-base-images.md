# ADR-0003: Base images

- Status: accepted
- Date: 2026-09-24
- Module: program

## Context

The plan proposed `node:22-bookworm-slim`. Three facts changed the choice: Playwright's own images are Ubuntu 24.04 (noble); PostgreSQL 16 client tools and Tesseract 5 are in Ubuntu 24.04 main without extra repositories; Debian mirrors are unreachable from this build environment while the Ubuntu archive is.

## Decision

- Build stages: `${DOCKERHUB_MIRROR}/library/node:22-bookworm-slim` (pnpm through corepack; no apt).
- Runtime stages for `api`, `brain`, `runner`, `cli`, `fixture-hmi`, `fakes`: `${DOCKERHUB_MIRROR}/library/ubuntu:24.04` with `/usr/local/bin/node` copied from the official Node 22 image.
- `web`: `${DOCKERHUB_MIRROR}/nginxinc/nginx-unprivileged:1.27-alpine`.
- `DOCKERHUB_MIRROR` defaults to `docker.io`; this environment uses `mirror.gcr.io`. Release builds pin every base by digest in `deploy/images.lock`.

## Consequences

One apt ecosystem for every runtime image. Node patch updates come from the official Node image digest bump.
