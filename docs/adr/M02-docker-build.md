# ADR-M02-5: Image build uses `pnpm deploy`, follows the toolchain image's CA pattern

- Status: accepted
- Date: 2026-09-24
- Module: M02

## Context

`deploy/docker/fixture-hmi.Dockerfile` (ADR-0003) must produce a runnable, non-root,
`ubuntu:24.04`-based image from a pnpm workspace package that depends on
`@argus/contracts`. This build environment terminates outbound TLS through an agent
proxy that Node only trusts via `NODE_EXTRA_CA_CERTS`; `--network host` alone is not
enough for `corepack`/`pnpm` to reach `registry.npmjs.org` from inside the container.

## Decision

- The build stage copies the whole repository (`COPY . .`) and runs
  `pnpm install --frozen-lockfile` there, rather than hand-picking package manifests:
  `pnpm-lock.yaml`'s importers list every workspace project, so a partial copy risks a
  frozen-lockfile mismatch. A root `.dockerignore` (new, shared by every module's future
  Dockerfile) keeps `node_modules`, `dist`, `coverage`, `.git` and `docs` out of the
  build context.
- `pnpm exec turbo run build --filter=@argus/fixture-hmi` builds this package and its
  workspace dependency (`@argus/contracts`) in the right order via Turborepo's
  `dependsOn: ["^build"]`, instead of building each package by hand.
- `pnpm --filter @argus/fixture-hmi deploy --prod /app/deploy` produces a self-contained
  runtime directory (`injectWorkspacePackages: true` in `pnpm-workspace.yaml` makes this
  work: workspace dependencies are copied in, not symlinked). Only that directory plus
  `datasets/` crosses into the `ubuntu:24.04` runtime stage.
- The network's CA is passed as the optional BuildKit secret `extra-ca`
  (`--secret id=extra-ca,src=$NODE_EXTRA_CA_CERTS`), exactly as
  `deploy/docker/toolchain.Dockerfile` already does: used for the one `RUN` step that
  needs registry access, never written into any image layer. A build without the secret
  (a customer's network, unmodified) is unaffected.

## Consequences

The Dockerfile needs no change when D1 folds it into the shared multi-target Dockerfile:
the same `pnpm deploy` and secret pattern apply to every `apps/*` image. Rebuilding after
a dependency change is `docker build --network host --secret id=extra-ca,src=<ca> ...`; no
manual dependency list to keep in sync.
