# ADR M00-containers: Shared dev services and the toolchain image

- Status: accepted
- Date: 2026-09-24
- Module: M00

## Context

Later modules rely on Postgres 16 and an S3 store on loopback, shared by every worktree,
and M00-G1 needs a fresh container to bootstrap a clean clone in. The Docker Hub mirror,
the blocked Debian mirrors and the TLS-re-terminating network of this host constrain both.

## Decision

- `compose.dev.yaml`, project `argus-dev`, named volumes only, loopback ports:
  `postgres` (`${DOCKERHUB_MIRROR:-docker.io}/library/postgres:16-bookworm`,
  `pg_isready` health check) and `s3`
  (`ghcr.io/versity/versitygw:v1.8.0@sha256:30292fc2…`, POSIX backend on `/data`,
  `127.0.0.1:9000:7070`).
- The bucket `argus` is created by the `s3` container itself: its entrypoint starts the
  gateway, waits for `/health`, runs `versitygw admin create-bucket --owner argus`
  (idempotent on `BucketAlreadyOwnedByYou`) and keeps the gateway in the foreground. The
  health check requires the gateway and the bucket, so `up --wait` returns with the
  bucket in place. A one-shot init service was rejected: `docker compose up --wait`
  exits 1 when any container exits, even with status 0. A bucket made with `mkdir` was
  rejected: it has no owner or ACL, and CreateBucket on it answers 500.
- `deploy/docker/toolchain.Dockerfile` builds `argus/toolchain:dev`: Ubuntu 24.04, Node
  22 (binary, npm and corepack) from `node:22-bookworm-slim`, pnpm 10.33.0 through
  corepack in `/opt/corepack`, git, Tesseract with eng and fra, `postgresql-client-16`,
  the Chromium libraries of Playwright 1.56.1 for noble by package name, and fonts.
  Browsers are mounted at `/opt/pw-browsers`.
- A network that re-terminates TLS passes its CA as the optional build secret
  `extra-ca`; it is not stored in the image. M00-G1 passes `$NODE_EXTRA_CA_CERTS` that
  way and mounts it read-only into the clean-clone container.
- M00-G1 builds the image (not counted in the 10 minutes), streams `git archive HEAD`
  into a new container (`--network host` for the registry, `/opt/pw-browsers` read-only),
  and times `pnpm install --frozen-lockfile`, `pnpm build` and `pnpm test` there. The
  container wall time must stay under 600 s.

## Consequences

`docker compose -f compose.dev.yaml up -d --wait` works from any worktree and in CI.
G1 tests HEAD, so it passes only on committed work.
