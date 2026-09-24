# ARGUS

AI-driven QA platform for web HMIs: plain-language tests, typed Jev decisions inside the run loop, an LLM only on a break and for the report, and one set of Docker images that installs in the cloud, in a hybrid setup, on-prem or air-gapped.

This repository starts from the specification and the implementation plan below. Code lands module by module, gates first, as the plan describes.

## Documents

| Document | Purpose |
| --- | --- |
| [Implementation plan](docs/plan/implementation-plan.md) | End-to-end plan: deployment architecture, repository and CI, phases, tracks, timeline, decisions |
| [Product design](docs/spec/01-product-design.md) | Users, run loop, product surface, editions and pricing |
| [Architecture and contracts](docs/spec/02-architecture-and-contracts.md) | Containers, trust boundaries, run engine, contracts, data model, API, metering, security |
| [Implementation spec](docs/spec/03-implementation-spec.md) | Modules M00 to M20 with their gates, acceptance scenarios and the agent protocol |

## Where things will live

```text
apps/          api  brain  runner  web  cli  fixture-hmi
packages/      contracts  config  testkit  driver  observer  vision  navigator
               analyst  compiler  engine  db  billing  reporting  integrations
tools/         gate  eval
gates/         Mxx.yaml  evidence/
deploy/        docker/  compose.*.yaml  helm/  cloud/  install.sh  images.lock
docs/          plan/  spec/  adr/
```

## Development

Node 22, pnpm 10 (through corepack) and Docker with Compose v2.

```sh
pnpm install
DOCKERHUB_MIRROR=mirror.gcr.io docker compose -f compose.dev.yaml up -d --wait  # postgres :5432, S3 :9000
pnpm build              # turbo: every package's dist
pnpm typecheck          # tsc --noEmit per package (sources through the @argus/source condition)
pnpm lint               # ESLint, typescript-eslint strict
pnpm test               # Vitest per package, behind the Tier A network guard, with coverage
pnpm depcruise          # dependency rules (.dependency-cruiser.cjs)
pnpm format             # Prettier
pnpm gate M00           # one module's gates; writes gates/evidence/M00.json
pnpm gate all --tier A  # the regression suite
pnpm g0 tools/gate      # global gate G0 on package directories
pnpm gate-guard --range origin/main..HEAD --per-commit  # protected paths, commit by commit
```

`tools/gate/README.md` documents gate files, pass expressions and evidence; `.env.example`
the environment variables. `argus/toolchain:dev` (`deploy/docker/toolchain.Dockerfile`) is
the CI image and dev container.
