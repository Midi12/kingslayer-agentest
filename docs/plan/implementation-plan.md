# ARGUS end-to-end implementation plan

| | |
| --- | --- |
| Status | Proposed, for review at the Phase 0 checkpoint |
| Date | 2026-09-24 |
| Scope | From this empty repository to the shipped product in every edition: cloud, hybrid (managed and private AI), on-prem and air-gapped, plus the CI kit |
| Binding inputs | [Product design](../spec/01-product-design.md), [Architecture and contracts](../spec/02-architecture-and-contracts.md), [Implementation spec](../spec/03-implementation-spec.md) |

The three specification documents define what ARGUS is, its contracts, and the twenty-one modules with their gates. This plan does not restate them. It fixes the order of work, the delivery mechanics (repository, CI, images, Compose, Helm, installer), the parallel tracks, the estimates, and the decisions that must be taken before code is written. Where this plan and the specification disagree, the specification wins until an ADR records the change.

## 1. Outcome: what "done" means

One set of container images, built once per release, that installs in any environment with one command and no hand-installed dependency.

| Environment | One command | Time to healthy |
| --- | --- | --- |
| Developer laptop (Linux, macOS, Windows with Docker Desktop) | `docker compose -f compose.dev.yaml up -d && pnpm dev` | under 2 min |
| Single VM, on-prem, connected | `./install.sh --edition onprem` | under 5 min including the pull |
| Single VM, air-gapped | `./install.sh --edition onprem --airgap ./bundle` | under 5 min |
| Kubernetes, any distribution | `helm install argus oci://<registry>/charts/argus -f values.yaml` | under 5 min |
| Customer host, hybrid runner | `docker compose -f compose.hybrid-runner.yaml up -d` | under 1 min |
| CI job (GitLab first) | `argus run --suite smoke --wait --junit argus-junit.xml` | the job's own time |

Release criteria, the program's definition of done:

1. Every module M00 to M20 has a committed evidence file that passes on the release commit: Tier A on every commit, Tier C on `main`, Tier B before the release.
2. Scenarios S1 to S12 pass from built images with fake AI, and all but S9 pass with live AI.
3. M19-G1 and M19-G2 passed, or a human recorded the documented limitation (French shipped as beta).
4. Every image is multi-arch, non-root, signed, carries an SBOM, has no critical CVE and is within its size budget.
5. `install.sh` brings a clean host to healthy within 120 s; the air-gap install shows zero egress; the upgrade from release N-1 keeps every ledger entry; the Helm install on kind passes S1.
6. The M18 security gates are green and the five human checkpoints are signed off.

## 2. Principles that shape the plan

1. **Docker from the first commit.** A package gets its image the day it exists, the images are built in CI on every commit, and the on-prem stack is kept bootable at the end of every milestone, not only at M17.
2. **One image set, many placements.** Editions differ by which services a Compose profile or Helm values start, and by environment variables. There is never an edition-specific build.
3. **One configuration contract.** A single `.env` file, or the same keys as Helm values and Kubernetes secrets, configures every service. Every service validates its configuration at start and names the offending key.
4. **Gates before code, and deployment is a gate.** The Tier C jobs run on `main`, so a change that breaks the install is caught the day it lands.
5. **Risk first.** The grounding go or no-go after M06 is the only fork. The platform track runs in parallel because it does not depend on the outcome.
6. **Nothing manual in operations.** Every operational action (migrate, bootstrap, backup, restore, upgrade, smoke) is an `argus-admin` command that also runs in CI.

## 3. Deployment architecture

Everything customer-facing is the six containers of the architecture document plus the CLI image. The dev-only images (fixture HMI, fakes, toolchain) never ship to customers.

### 3.1 Image catalogue

| Image | Base | Contents | Commands | Size budget | Listens |
| --- | --- | --- | --- | --- | --- |
| `argus/api` | `node:22-bookworm-slim`, digest pinned | `apps/api`, `argus-admin`, PostgreSQL 16 client tools | `api` (default), `migrate`, `bootstrap`, `admin <cmd>` | 400 MB | 3000, internal |
| `argus/web` | `nginxinc/nginx-unprivileged:1.27-alpine`, digest pinned | Console build, nginx template proxying `/api`, `/runner`, `/brain`, `/schemas` | nginx | 400 MB, expected under 60 | 8080, 8443 |
| `argus/brain` | `node:22-bookworm-slim` | `apps/brain`, `prompts/`, `thresholds/`, question catalogue | `brain` | 400 MB | 3100, internal |
| `argus/runner` | `node:22-bookworm-slim` + Playwright Chromium + Tesseract 5 (eng, fra) + fonts | `apps/runner`, `apps/cli` | `runner` (default), `selftest`, `run-local`, `health`, `argus` | 1.6 GB | none; outbound only |
| `argus/cli` | `node:22-bookworm-slim` | `apps/cli` | `argus` | 400 MB, expected under 150 | none |
| `argus/fixture-hmi` | `node:22-bookworm-slim` | `apps/fixture-hmi`, datasets | `fixture-hmi` | dev only | 4000 |
| `argus/fakes` | `node:22-bookworm-slim` | fake Jev, fake LLM, cassette player | `fake-jev`, `fake-llm`, `all` | dev only | 4100, 4200 |
| `argus/toolchain` | `node:22-bookworm` | pnpm, Chromium dependencies, Docker CLI, helm, kubeconform, trivy, syft, cosign | shell | CI only | none |
| Third party | `postgres:16-bookworm`, `minio/minio`, optional `caddy:2`, optional `ollama/ollama` or `vllm/vllm-openai` | unchanged, digest pinned in `deploy/images.lock` | | | |

Every ARGUS image shares the same properties, enforced by M17-G5 and M11-G6:

- Runs as user `argus`, uid and gid 10001, never root.
- Works with a read-only root file system: writes go to `/tmp` (tmpfs) and to declared volumes only (`/var/lib/argus/spool` for the runner).
- `tini` as PID 1; SIGTERM handled by the application (M11-G4 for the runner).
- `HEALTHCHECK` implemented with Node's global `fetch` against `/healthz`, so no `curl` in the image. The runner's `health` command checks the age of its lease heartbeat file instead.
- OCI labels for version, revision, source and licence; `ARGUS_VERSION` baked in and reported by `/healthz`.
- Built for `linux/amd64` and `linux/arm64` from one lockfile; runtime trees produced by `pnpm deploy --prod` (pnpm 10 needs `injectWorkspacePackages: true` in `pnpm-workspace.yaml`).
- No package-manager cache, no build tools and no secret in any layer.

### 3.2 Build pipeline

- One Dockerfile with named targets (`deploy/docker/Dockerfile`) and a bake file (`deploy/docker/docker-bake.hcl`) that lists every target, platform and tag. `docker buildx bake` builds all images with a shared dependency and build cache. Appendix C has the sketch.
- Stages: `deps` (`pnpm fetch` against the lockfile), `build` (`turbo run build`), one `deploy-<app>` stage per app (`pnpm --filter @argus/<app> deploy --prod`), one runtime stage per image.
- Tags: `<registry>/argus/<image>:<semver>`, `:<major>.<minor>`, `:<major>`, `:sha-<short>`; `:edge` follows `main`. The registry defaults to GHCR because the repository lives on GitHub; `ARGUS_REGISTRY` overrides it everywhere.
- `deploy/images.lock` records the digest of every image of a release, third-party ones included. Compose files and the Helm chart resolve tags through it, and the air-gap bundle is `docker save` of exactly this list.
- Supply chain, in the release job: CycloneDX SBOM with `syft` attached as an OCI artifact; `cosign` signature (keyless for the registry, plus a key-based signature whose public key ships in the air-gap bundle for offline verification); `trivy` with `--severity CRITICAL --exit-code 1`; a size check against the budgets. Renovate keeps base-image digests current.

### 3.3 Configuration contract

- Precedence: environment variable, then the file named by the `_FILE` variant of the same key (Docker and Kubernetes secrets), then the default. Every secret key accepts `_FILE`.
- `packages/config` holds one TypeBox schema for all keys, tagged with the service that consumes each key. It is internal, so it does not conflict with the rule that public types live in `packages/contracts` only.
- `argus-admin config validate` reports missing and invalid keys by name and never prints a secret value. Every service runs the same validation at start and exits with code 78 (`EX_CONFIG`) and the key names on failure.
- Appendix A is the full key reference. Groups: instance, database, object store, keys, AI providers, runner, licence, billing, mail, observability, bootstrap, web and TLS.
- `install.sh` writes the `.env` from `deploy/env.template` and generates every secret it can (`ARGUS_MASTER_KEY`, `ARGUS_JWT_PRIVATE_KEY`, `ARGUS_SESSION_SECRET`, `ARGUS_EVIDENCE_SIGNING_KEY`, object store credentials). The only values a person types are the public URL, the admin e-mail, the licence path and the AI keys.

### 3.4 Compose family

| File | Purpose | Always-on services | Profiles |
| --- | --- | --- | --- |
| `compose.dev.yaml` (root) | Developer backing services; apps run on the host with `pnpm dev` | postgres, minio, minio-init, fixture-hmi, fake-jev, fake-llm | `full` adds api, brain, runner and web from a local build; `observability` adds an OpenTelemetry collector, Prometheus and Grafana |
| `compose.test.yaml` (root) | Tier C scenarios and CI-kit tests against built images | the on-prem stack plus fixture-hmi, fakes and a `scenario` job container | `live-ai` swaps the fakes for real endpoints |
| `deploy/compose.onprem.yaml` | Customer on-prem, full stack, one `.env` | migrate, bootstrap, api, brain, runner, web | `bundled-db` (postgres), `bundled-store` (minio), `tls` (caddy), `local-ai` (ollama or vllm), `observability` |
| `deploy/compose.hybrid-runner.yaml` | Customer host, managed AI | runner | none |
| `deploy/compose.hybrid-private-ai.yaml` | Customer host, private AI | runner, brain | `local-store` (minio), `local-ai` |

Rules shared by every file:

- All services join one internal network; only `web` (or `caddy`) publishes ports. Postgres and MinIO are never published on customer files; `compose.dev.yaml` publishes them on loopback only.
- Bundled Postgres and MinIO sit behind profiles, so an external database or S3 endpoint means removing a profile from `COMPOSE_PROFILES` and setting a URL. Nothing else changes.
- Services depend on health, not on start order: `depends_on` with `service_healthy` and `service_completed_successfully`, and `required: false` on the bundled services so an external database works with the same file.
- Every ARGUS service sets `read_only: true`, a tmpfs on `/tmp`, `cap_drop: [ALL]`, `no-new-privileges`, json-file log rotation and `restart: unless-stopped`. The runner adds `shm_size: 1g` and the Chromium seccomp profile.
- Images are pinned through `${ARGUS_VERSION}` in `.env`. A customer upgrades by changing one line and running `argus-admin upgrade`.

### 3.5 Service lifecycle

```text
postgres  (healthy) ─┐
minio     (healthy) ─┴─► migrate (exit 0) ─► bootstrap (exit 0) ─► api (healthy) ─┬─► web
                                                                    brain (healthy) ─┴─► runner
```

| Step | Behaviour |
| --- | --- |
| `migrate` | Runs the forward-only SQL migrations under a Postgres advisory lock, so replicas never race. Exit 0 when there is nothing to do. |
| `bootstrap` | Idempotent: bucket and lifecycle rules; first org and admin only when none exists; licence load on-prem; default project and environment. Prints a generated admin password once, then never again. |
| `api` | Validates its config, refuses to serve on a schema-version mismatch, verifies the licence, then listens. `/healthz` is process liveness; `/readyz` checks Postgres, the object store and, when configured, the brain. The scheduler runs in whichever api replica holds the advisory lock. |
| `brain` | `/readyz` checks provider configuration without a network call, so air-gapped installs pass. Run tokens are verified against the api's JWKS endpoint, cached, with a static public-key override. |
| `runner` | Runs `selftest` at start (Chromium launch, fonts, Tesseract, api and brain reachability, clock skew under 5 s), then registers and leases. `stop_grace_period: 45s` gives M11-G4 its 30 s. |
| `web` | Serves the console and is the single ingress: proxies `/api`, `/runner` and `/schemas` to `api`, and `/brain` to `brain`, with buffering off for server-sent events. |

### 3.6 Data, backup and upgrade

| Volume | Content | Notes |
| --- | --- | --- |
| `argus_pgdata` | Postgres | `bundled-db` profile only |
| `argus_objects` | MinIO | `bundled-store` profile only |
| `argus_spool` | Runner event and artifact spool | bounded by `ARGUS_RUNNER_SPOOL_MAX_MB` |
| `argus_backups` | Backup bundles | or an S3 prefix |

- `argus-admin backup [--to <dir or s3://…>]`: `pg_dump` in custom format, an object-store mirror, a manifest with SHA-256 per file, and the result of the ledger chain verification. Runs in the `api` image.
- `argus-admin restore <bundle>`: refuses a non-empty database without `--force`, restores, then verifies every run's hash chain and the credit balances (M17-G4).
- `argus-admin upgrade --to <version>`: preflight, backup, pull or load images, verify digests, migrate, rolling restart, smoke. `argus-admin rollback` restores the last backup and the previous `images.lock`.
- `argus-admin smoke`: readiness of every service, one registered runner with a green selftest, and a built-in zero-credit run of a two-step script against the console's own login page. The script uses explicit locators, so it needs no AI call and no customer target.
- Retention is a job inside `api` (M12-G10). Sizing guidance ships in `deploy/README.md`.

### 3.7 Network and security defaults

- Ingress: `web` on 8080 and 8443. TLS modes: `files` (mounted certificate, nginx terminates), `auto` (the `tls` profile starts Caddy with ACME; needs public DNS and ports 80 and 443), `off` behind a customer proxy with `ARGUS_TRUST_PROXY=true`.
- Runner: outbound only, no published port, proxies honoured through `HTTPS_PROXY` and `NO_PROXY`. The documented egress allow-list is the api URL, the brain URL and the target origins. Provider endpoints are reached by the brain only.
- Chromium runs as non-root with its sandbox on, through the seccomp profile in `deploy/seccomp/chromium.json` that allows user namespaces without `SYS_ADMIN`. `--disable-dev-shm-usage` is the default. Hosts that cannot load a seccomp profile set `ARGUS_CHROMIUM_SANDBOX=off`, and the run ledger records the mode.
- Cloud runners and the `http` action apply the SSRF guard of M18: resolve, then connect to the resolved address only; loopback, link-local, metadata and private ranges are blocked.
- Secrets reach containers through `_FILE` variables and Docker or Kubernetes secrets. The on-prem master key is generated by `install.sh` and stored with mode 600.

### 3.8 Installer and air-gap bundle

`install.sh` is POSIX shell plus Docker Compose v2, and runs identically from the network and from the bundle.

1. Flags: `--edition onprem|hybrid-runner|hybrid-private-ai`, `--version`, `--airgap <dir>`, `--dir /opt/argus`, `--env-file` for non-interactive installs, `--dry-run`, `--no-systemd`.
2. Preflight, each failure with its own exit code and message (M17-G7): Docker 24 or later with Compose v2, CPU, RAM and disk per the sizing table, free ports, clock skew, DNS, reachability of the configured AI endpoints unless air-gapped, licence file present for on-prem, supported architecture.
3. Materialise `/opt/argus/{compose.yaml, .env, seccomp/, images.lock, VERSION}` from the templates; generate secrets; prompt only for the values listed in 3.3.
4. Pull, or `docker load` from the bundle, and verify every digest against `images.lock` (and the cosign signature when `cosign` is present).
5. `docker compose up -d`, wait for health with a 120 s budget, run `argus-admin smoke`.
6. Install `argus.service` (systemd, `docker compose up -d` on boot) and print the URL and the next steps.

The bundle `argus-<version>-<arch>.tar` holds `images.tar`, `SHA256SUMS` with a detached signature, `install.sh`, the Compose templates, the seccomp profile, offline documentation, a `licence/` folder and the `LocalNavigator` configuration. Model weights for the `local-ai` profile are a separate download because of their size. `pnpm bundle:airgap` builds the bundle in the release job.

Sizing minimums, one runner slot; add 2 vCPU and 4 GB per extra slot:

| Edition | vCPU | RAM | Disk |
| --- | --- | --- | --- |
| Hybrid runner | 2 | 4 GB | 20 GB |
| Hybrid private AI, without a local LLM | 4 | 8 GB | 40 GB |
| On-prem | 4 | 8 GB | 100 GB |
| On-prem with `local-ai` | 8, GPU optional | 32 GB | 200 GB |

### 3.9 Kubernetes

The Helm chart `deploy/helm/argus` is published as an OCI artifact.

- Deployments for `api` (with an HPA), `brain` and `web`; `migrate` as a pre-install and pre-upgrade hook Job; `bootstrap` as a post-install hook Job.
- Runner modes: `runner.mode=deployment` for a persistent self-hosted pool (replicas times slots); `runner.mode=job` for the cloud edition (one Job per run created by `api`, scaled by KEDA on queue depth, M20).
- External Postgres and S3 by default (`postgres.externalUrl`, `s3.*`). `dev.bundled=true` deploys single-replica Postgres and MinIO StatefulSets for kind and demos only.
- Pod security `restricted`: non-root, read-only root file system, all capabilities dropped. Runner pods default to Chromium without its own sandbox inside the restricted pod (the pod is the boundary; `runtimeClassName` for gVisor is optional). Clusters that ship the seccomp profile set `runner.chromium.sandbox=seccomp`.
- NetworkPolicies: runner egress to api, brain, DNS and the internet minus private and metadata ranges; nothing may reach runner pods; api and brain reach only their dependencies.
- Values mirror the `.env` keys one to one under `config.*` and take an `existingSecret`. Gates: `helm lint`, kubeconform, and a kind install passing S1 (M17-G6).

### 3.10 Deployment recipes

| Environment | Steps | Notes |
| --- | --- | --- |
| Laptop, code on the host | `pnpm install`, `docker compose -f compose.dev.yaml up -d`, `pnpm dev` | apps reload on change; backing services on loopback |
| Laptop, everything in containers | `docker compose -f compose.dev.yaml --profile full up --build` | parity check before a merge request |
| VM, connected | download `install.sh` from the release page, then `sh install.sh --edition onprem` | inspect the script first if policy requires |
| VM, air-gapped | `tar xf argus-<version>-amd64.tar && ./install.sh --edition onprem --airgap .` | zero egress (M17-G3) |
| Kubernetes | `helm install argus oci://<registry>/charts/argus --version <version> -f values.yaml` | external Postgres and S3 |
| Hybrid runner host | `docker compose -f compose.hybrid-runner.yaml up -d` with `ARGUS_API_URL` and `ARGUS_RUNNER_TOKEN_FILE` set | outbound only (M17-G2) |
| Hybrid private AI host | `docker compose -f compose.hybrid-private-ai.yaml --profile local-store up -d` | brain and artifacts stay on site |
| GitLab job, cloud or hybrid runner | `image: <registry>/argus/cli:1`, then `argus run …` | CI component in `ci/gitlab` |
| GitLab job, ephemeral runner | `image: <registry>/argus/runner:1`, then `argus run --ephemeral …` | the runner image includes the CLI, so no Docker socket and no service container |
| Podman, rootless | the same Compose files with `podman compose` | best effort, tested once per release |

## 4. Repository, toolchain and CI

### 4.1 Layout

The layout of the implementation spec applies, with these additions:

| Path | Purpose |
| --- | --- |
| `packages/config` | The configuration schema and loader shared by api, brain, runner and cli |
| `deploy/docker/` | `Dockerfile` with named targets, `docker-bake.hcl` |
| `deploy/seccomp/chromium.json` | Runner seccomp profile |
| `deploy/systemd/argus.service` | Boot unit installed by `install.sh` |
| `deploy/env.template` | Documented `.env` template |
| `deploy/images.lock` | Digests of a release |
| `deploy/bundle/` | Air-gap bundle builder |
| `.github/workflows/` | Active pipeline; `.gitlab-ci.yml` stays as the reference from the spec, and both call `pnpm gate` |
| `docs/plan/`, `docs/spec/` | This plan; the three specification documents |

### 4.2 Toolchain

pnpm workspaces and Turborepo as specified, with `packageManager` pinned in the root `package.json`. Turbo tasks: `build`, `typecheck`, `lint`, `test`, `test:gate-*`, `depcruise`, `docker:build`. The `argus/toolchain` image is both the CI image and the dev container, so M00-G1 ("in a fresh container") and every Tier A job run in the same environment.

### 4.3 CI pipeline

| Job | Trigger | Runs | Publishes |
| --- | --- | --- | --- |
| `gate-guard` | every merge request | protected-path check (M00-G5), conventional-commit check | nothing |
| `tier-a` | every commit | `pnpm gate all --tier A` in `argus/toolchain` with postgres, minio and fixture-hmi as services; network guard on | evidence files as artifacts |
| `build-images` | every commit (amd64); `main` and tags (amd64 and arm64) | `docker buildx bake` | `:sha-*` and `:edge` tags |
| `tier-c` | `main`, tags, nightly | `compose.test.yaml` from the built images: scenarios S1 to S12 with fake AI; `install.sh` on a clean container host; image hygiene (non-root, read-only, size, Trivy); Helm on kind | evidence for M02-G5, M11-G6, M15-G3, M15-G6, M17-G1 to G7, S1 to S12 |
| `tier-b` | nightly and on demand; needs `TYPESAFE_API_KEY` and an LLM key | `tools/eval`, live scenarios | results committed to `eval/results/` through a bot merge request |
| `release` | tag `v*` | multi-arch build, SBOM, signatures, `images.lock`, bundle, Helm package, upgrade test from N-1, GitHub release with checksums | images, chart, bundle |

Tier C needs a Docker daemon on the CI runner: GitHub-hosted runners have one; a GitLab runner uses the Docker executor with Docker-in-Docker or a shell executor. Branch protection requires `tier-a`, `gate-guard` and `build-images`. `CODEOWNERS` routes `gates/**`, `**/__golden__/**`, `thresholds/**`, `prompts/**` and `packages/navigator/src/questions.ts` to a human approver, which is the GitHub form of the protected-paths rule. The merge-request template carries the evidence attachment, the ADR link and the one-line entry per new dependency.

## 5. Phased delivery plan

Four milestones from the specification, with the Docker deliverables threaded through them. Days are agent working days including the gates merge request and excluding human review latency (see section 7). Tracks are P (perception), I (intelligence), F (platform) and D (delivery), defined in section 6.

### Phase 0: kick-off (week 0)

| Deliverable | Owner |
| --- | --- |
| The ADRs of section 11 marked "Phase 0" decided | Product owner and architect |
| Accounts and keys: TypeSafe (with the embedding and resale question asked), LLM provider, GHCR, Stripe test mode, a GitLab test project or the fake | Ops |
| The reference CI runner defined (vCPU, RAM), because M05-G6, M10-G9 and M12-G11 are timed against it | Ops |
| Repository settings: branch protection, CODEOWNERS, secrets for Tier B | Ops |
| `CLAUDE.md` with the working loop; the TypeSafe agent skill installed for the M06 session | Architect |

Exit: no open question blocks M00.

### Phase 1: MS1 walking skeleton (weeks 1 to 3)

| Module | Track | Key deliverables | Docker and deploy deliverable | Days |
| --- | --- | --- | --- | --- |
| M00 | D | workspace, gate runner, network guard, `gate-guard`, `compose.dev.yaml`, ADR template | `argus/toolchain` image; `compose.dev.yaml` with postgres and minio; CI jobs `gate-guard`, `tier-a`, `build-images` | 3 |
| M01 | I | contracts, canonicalisation, lint, goldens | none | 4 |
| M02 | P | fixture HMI, 14 faults, datasets | `argus/fixture-hmi` image in `compose.dev.yaml`; M02-G5 in `tier-c` | 5 |
| M03 | I | fake Jev, fake LLM, cassettes, port fakes | `argus/fakes` image serving both fakes in `compose.dev.yaml` | 3 |
| M04 thin | P | navigate, click, fill, screenshot, DOM candidates | first `argus/runner` image build: Chromium, Tesseract, fonts, size check | 2 |
| M10 thin | P | OBSERVE, GROUND, ACT, VERIFY, DECIDE with `dom` expectations; ledger builder | `run-local` command: run a script file against a URL with `FakeNavigator` and write the ledger to a directory | 2 |
| D1 | D | root `Dockerfile` with targets, `docker-bake.hcl`, `packages/config`, `env.template`, first cut of `deploy/README.md` | all of the above built on every commit | 2 |

Order: M00 first and alone. After M00, M01 alone, because everything imports it. After M01, three sessions run in parallel: P (M02, then M04 thin and M10 thin), I (M03) and D (D1).

Exit criteria: the specification's (a hand-written three-step script runs green on the fixture with `FakeNavigator` and leaves a chain-valid ledger), plus `pnpm gate all --tier A` passes inside `argus/toolchain`, and `docker compose -f compose.dev.yaml up -d` reaches healthy for postgres, minio, fixture-hmi and the fakes. Human checkpoint 1 reviews the harness, the contracts and the fixture.

### Phase 2: MS2 two brains (weeks 4 to 7)

| Module | Track | Key deliverables | Docker and deploy deliverable | Days |
| --- | --- | --- | --- | --- |
| M04 full | P | observer, context labels, redaction, budgets, ring buffer, burst, settle, origin allow-list | runner image gains the seccomp profile and the read-only root file system (M11-G6 preparation) | 3 |
| M05 | P | diff, dHash, blink, colour, OCR, set-of-marks | Tesseract language packs verified in the runner image | 3 |
| M06 | I | question catalogue (human-reviewed line by line), pre-filter, `groundGate`, Jev, local and fake adapters, thresholds | none | 4 |
| M19 first pass | I | `tools/eval`; G1, G2, G4 and G5 live | `tier-b` job live | 2 |
| Go or no-go | human | decision recorded as an ADR | | |
| M07 | I | LLM port, both adapters, decision matrix, validator, prompts | none | 4 |
| M08 | I | compiler pipeline, risk assignment, id stability | none | 3 |
| M09 | I | brain service, token auth, redaction re-check, usage blocks | `argus/brain` image; `compose.dev.yaml --profile full` gets `brain`; M09-G5 with two replicas in Compose | 3 |
| M10 full | P | full state machine, evaluators, escalation loop, locator memory, read-only guard, 12 golden ledgers | `run-local` can point at a brain URL; the go/no-go demo runs from containers | 5 |

Go or no-go protocol: the M06 session stops at M06-G8; the M19 harness records G1, G2, G4 and G5 with model, question and threshold versions; the product owner decides within two working days. On a no-go, the options in order of cost are: rework the question catalogue (one week, human-drafted); rework the pre-filter and the context labels (one week); replace the adapter behind the `Navigator` port with `LocalNavigator` or Analyst grounding as the primary path (two weeks and a pricing change). Two rework loops are budgeted. The platform track is unaffected either way.

Exit criteria: the specification's (the conveyor C12 test compiles from plain language, runs on live Jev, breaks on an injected fault and receives a valid Analyst decision), plus `argus/brain` runs in Compose with fake and live providers, and the twelve golden-ledger scenarios pass from `run-local` inside the runner container. Human checkpoint 2 is the go or no-go; human checkpoint 3 reviews the break loop on ten recorded runs.

### Phase 3: MS3 platform (weeks 3 to 11, overlapping Phase 2)

M12 and M13 depend on M01 only, so the platform track starts in week 3, in parallel with Phase 2.

| Module | Track | Key deliverables | Docker and deploy deliverable | Days |
| --- | --- | --- | --- | --- |
| M12 | F | migrations, RLS, routes, OpenAPI, queue, ingest, SSE, secrets, webhooks, retention, scheduler, audit | `argus/api` image with the `migrate` and `bootstrap` commands; `compose.dev.yaml --profile full` gets `api` | 8 |
| M13 | F | credit ledger, estimator, settlement, Stripe adapter, licence verification, vouchers, entitlements | licence public key baked into `api`; `argus-admin licence load` and `licence status` | 5 |
| M11 | P | protocol client, spool, slots, ephemeral mode, selftest, SIGTERM | `argus/runner` final: `runner`, `selftest`, `health`; M11-G6 in `tier-c` | 4 |
| M14 | F | console, every screen, run detail, decision inspector | `argus/web` image with the nginx template; single ingress | 8 |
| M15 | F | CLI, exit codes, JUnit, GitLab component, tests as code | `argus/cli` image; the CLI inside `argus/runner`; `ci/gitlab` component; M15-G3 and M15-G6 in `tier-c` | 4 |
| M16 | F | HTML and PDF reports, evidence pack, notifications, issues | PDF rendering is a `render` job leased by any runner, which already owns Chromium, so `api` stays under 400 MB | 4 |
| D2 | D | `deploy/compose.onprem.yaml` v1, `compose.test.yaml`, `pnpm scenario`, `argus-admin` (`migrate`, `bootstrap`, `config validate`, `smoke`, `backup`, `restore`) | the full six-container stack boots from built images; scenarios S1 to S5, S8, S9 and S11 run with fake AI in `tier-c` | 3 |

Integration, weeks 9 to 11: M11 against the real api, the console against real runs, the CLI against the Compose stack, S6 against the fake GitLab, S7 in a network with no inbound route.

Exit criteria: the specification's (a GitLab job starts a suite through the CLI, a hybrid runner executes it, the console shows it, credits settle), plus `docker compose -f deploy/compose.onprem.yaml up` from `:edge` images passes S1 with fake AI on `main`. Human checkpoint 4: prices, tax settings and refund policy before Stripe leaves test mode.

### Phase 4: MS4 ship (weeks 11 to 14, contingency to week 16)

| Module | Track | Key deliverables | Docker and deploy deliverable | Days |
| --- | --- | --- | --- | --- |
| M17 | D | `install.sh` with preflight, air-gap bundle, Helm chart, `argus-admin upgrade` and `rollback`, SBOM, signatures, Trivy, size gates | everything in section 3 closed; M17-G1 to G7 in `tier-c` and `release` | 6 |
| M18 | I and F | injection corpus, SSRF guard, authorization fuzzer, headers and CSP, rate limits, repository hygiene | the `argus/web` nginx template carries the headers; cloud SSRF ranges in the runner | 5 |
| M19 full | I | G3 to G10 live; calibration proposals as `gate-change` requests | `tier-b` nightly with results in `eval/results/` | 4 |
| M20 | D | Terraform, KEDA, network policies, dashboards, SLOs, target ownership | `deploy/cloud`; runner as a Job per run | 5 |
| Release | all | S1 to S12 with fake and live AI, upgrade N-1 to N, evidence of every module, release notes | `v1.0.0` images, chart and bundle | 2 |

M20 serves the cloud edition only. If the first design partners are on-prem and hybrid, M20 trails the first release by one iteration without blocking it. Exit criteria: section 1. Human checkpoint 5: security gates, the evidence file of every module and the open ADRs before the release.

## 6. Tracks and roles

| Track | Modules | Agent session | Human counterpart |
| --- | --- | --- | --- |
| P, perception | M02, M04, M05, M10, M11 | one | reviewer for goldens and datasets |
| I, intelligence | M01, M03, M06, M07, M08, M09, M18 (corpus), M19 | one | question and prompt reviewer, line by line for M06 and M07 |
| F, platform | M12, M13, M14, M15, M16, M18 (fuzzer, headers) | one | reviewer; product owner for billing |
| D, delivery | M00, D1, D2, M17, M20 | one, part-time until Phase 4 | ops |

Working agreement, from the specification's protocol: one module per merge-request pair (gates, then implementation); a human approves every gates merge request within one working day; a failed Tier B gate or a wrong-looking gate stops the track and opens a `gate-change` request; every open choice becomes an ADR before the implementation merge request. A weekly integration checkpoint merges the tracks on the Compose stack.

## 7. Timeline estimate

| Phase | Serial, one agent | Parallel, four tracks | Main drivers |
| --- | --- | --- | --- |
| 0 | 1 week | 1 week | decisions and accounts |
| 1 | 3 weeks | 3 weeks | M02 datasets, M01 goldens |
| 2 | 5.5 weeks | 4 weeks plus the go/no-go | M10 golden ledgers, human question review |
| 3 | 7 weeks | overlaps Phase 2; 3 weeks of integration after it | M12, M14 |
| 4 | 4.5 weeks | 3.5 weeks | M17 on real hosts, Tier B nights |
| Total | about 21 weeks | about 14 weeks; 16 with one rework loop | |

Assumptions: about 105 agent working days across the modules (Appendix E); gates merge requests approved within a day; a reference CI runner available from week 1; TypeSafe and LLM keys available from week 3; the go or no-go decided within two days. Human review latency is the largest lever. A second rework loop or a change of Navigator adapter adds two weeks.

## 8. Verification end to end

| Tier | Where | When | Fakes |
| --- | --- | --- | --- |
| A | `argus/toolchain` container, on a host or in CI | every commit | in-process, from `packages/testkit` |
| C | Docker daemon on the CI runner: `compose.test.yaml`, kind, a clean container host for `install.sh` | `main`, tags, nightly | `argus/fakes` as services; the real adapters talk to them |
| B | same as C with `--profile live-ai`, plus `tools/eval` | nightly and before a release | none; cassettes recorded |

Scenario availability by phase: S1 with fake AI at the end of week 9; S2, S3, S4, S5, S8, S9 and S11 in weeks 9 to 11; S6 and S7 in week 11; S10 with M16; S12 with M17. Every scenario writes `gates/evidence/Sxx.json`, and the release job refuses to tag without all twelve. Dogfood (M19-G10) runs five ARGUS tests against the ARGUS console on the Compose stack, nightly from week 12.

## 9. Release process

1. Semantic versioning; `main` is always releasable; a release is a tag `vX.Y.Z` on `main`.
2. The `release` job builds multi-arch images, writes `deploy/images.lock`, generates SBOMs, signs, scans, packages the Helm chart, builds the air-gap bundle, and runs the upgrade test from the previous release on a clean host (M17-G4).
3. The human release review checks the evidence of every module, the Tier B results of the last three nights, the open ADRs and the security gates.
4. Publication: images and chart to the registry, bundle and checksums to the release page, release notes generated from conventional commits, offline documentation rebuilt.
5. Support policy for on-prem: an LTS every six months with twelve months of patch releases. Patches never change `v1` contracts (M01-G4, M12-G7).

## 10. Risks

| Risk | Trigger | Mitigation in this plan |
| --- | --- | --- |
| Grounding accuracy below M19-G1 | first M19 pass | two rework loops budgeted; the `Navigator` port allows an adapter swap; the platform track continues |
| Runner image over 1.6 GB, or the Chromium sandbox failing on a customer kernel | first runner build; M11-G6 | slim base with Chromium only; seccomp profile shipped; `ARGUS_CHROMIUM_SANDBOX=off` fallback recorded in the ledger |
| Compose and Helm drift | any deploy change | both follow the same service matrix (Appendix B) and both run in `tier-c` |
| Human review becomes the bottleneck | gates merge requests waiting more than a day | one-day approval agreement; gate reviews batched per track |
| MinIO licence (AGPL) unwelcome at some customers | procurement | any S3 endpoint works; the bundled store is a profile, not a dependency |
| Timing gates flaky on shared CI | M05-G6, M10-G9, M12-G11 | dedicated reference runner defined in Phase 0 |
| Air-gap local LLM quality below M19-G8 | Tier B | default to Analyst grounding with the documented limitation; the model choice is an ADR |
| GitHub-hosted repository versus the GitLab-first CI kit | Phase 0 | CI-agnostic gate harness; fake GitLab for M15 and S6; a real GitLab test project before the release |

## 11. Decisions to make (ADR backlog)

| ADR | Decision | Recommended default | Needed by |
| --- | --- | --- | --- |
| 0001 | Repository CI platform | GitHub Actions active, `.gitlab-ci.yml` kept as the reference, both call `pnpm gate` | Phase 0 |
| 0002 | Registry and image names | GHCR, `ghcr.io/<org>/argus/<image>`, overridable by `ARGUS_REGISTRY` | Phase 0 |
| 0003 | Base images | `node:22-bookworm-slim`, `nginx-unprivileged`, `postgres:16-bookworm`, MinIO; all digest pinned, Renovate | Phase 0 |
| 0004 | Ephemeral CI runner packaging | the CLI ships inside `argus/runner`; no Docker socket, no service container | Phase 0 |
| 0005 | Operational commands | `argus-admin` inside `argus/api`; `migrate` and `bootstrap` are one-shot Compose services of the same image | Phase 0 |
| 0006 | Configuration | single `.env`, `_FILE` secrets, `packages/config` schema | Phase 0 |
| 0007 | Chromium sandboxing | seccomp profile on Docker, pod boundary on Kubernetes, `sandbox=off` fallback recorded | Phase 1 |
| 0008 | Network guard allow-list in Tier A | loopback plus the Compose service names | Phase 1 |
| 0009 | PDF rendering location | a `render` job leased by runners | Phase 3 |
| 0010 | TLS at the edge | nginx with files, a Caddy profile for ACME, or the customer proxy | Phase 3 |
| 0011 | Local LLM and local Navigator models for the air-gap kit | candidates chosen in Phase 0, evaluated in M19-G8 | Phase 4 |
| 0012 | LTS cadence for on-prem | six months, twelve months of patches | Phase 4 |
| 0013 | Product name | ARGUS remains the working name; rename before the release only if legal requires it | Phase 4 |

## Appendix A: `.env` reference

Every secret key also accepts a `_FILE` variant. Defaults apply when the key is absent.

| Key | Used by | Default | Notes |
| --- | --- | --- | --- |
| `ARGUS_EDITION` | all | `onprem` | `onprem`, `hybrid-runner`, `hybrid-private-ai`, `cloud` |
| `ARGUS_PUBLIC_URL` | api, web, runner | none, required | the URL users and runners reach |
| `ARGUS_VERSION` | compose | release tag | image tag for every ARGUS image |
| `ARGUS_REGISTRY` | compose | `ghcr.io/<org>/argus` | any registry, including a local mirror |
| `COMPOSE_PROFILES` | compose | `bundled-db,bundled-store` | remove a profile to use an external service |
| `ARGUS_LOG_LEVEL`, `ARGUS_LOG_FORMAT` | all | `info`, `json` | `pretty` for development |
| `ARGUS_TRUST_PROXY` | api, web | `false` | honour `X-Forwarded-*` behind a customer proxy |
| `ARGUS_AIR_GAPPED` | api, brain, runner | `false` | disables every non-configured egress |
| `ARGUS_DATABASE_URL` | api | bundled Postgres | any PostgreSQL 16 |
| `ARGUS_DATABASE_POOL` | api | `10` | connections per replica |
| `POSTGRES_PASSWORD` | bundled postgres | generated | secret |
| `ARGUS_S3_ENDPOINT`, `ARGUS_S3_PUBLIC_ENDPOINT` | api | bundled MinIO | the public endpoint is what pre-signed URLs point at, as seen from runners |
| `ARGUS_S3_BUCKET`, `ARGUS_S3_REGION` | api | `argus`, `us-east-1` | |
| `ARGUS_S3_ACCESS_KEY`, `ARGUS_S3_SECRET_KEY` | api | generated | secret |
| `ARGUS_S3_FORCE_PATH_STYLE` | api | `true` | `false` for AWS virtual-hosted buckets |
| `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD` | bundled minio | generated | secret |
| `ARGUS_MASTER_KEY` | api | generated | 32 bytes base64; envelope encryption of secrets |
| `ARGUS_JWT_PRIVATE_KEY` | api | generated | Ed25519 PEM; runner session and run tokens |
| `ARGUS_JWT_PUBLIC_KEY` | brain | fetched from api JWKS | static override for split deployments |
| `ARGUS_SESSION_SECRET` | api | generated | console sessions |
| `ARGUS_EVIDENCE_SIGNING_KEY` | api | generated | Ed25519; evidence packs and report export |
| `ARGUS_NAVIGATOR` | brain | `jev` | `jev`, `local`, `fake` |
| `TYPESAFE_API_KEY`, `TYPESAFE_BASE_URL` | brain | none, official URL | secret; the base URL points at the fake in tests |
| `ARGUS_NAVIGATOR_MODEL` | brain | `jev-1.13.0` | pinned; thresholds are per model |
| `ARGUS_LOCAL_NAVIGATOR_URL`, `ARGUS_LOCAL_NAVIGATOR_MODEL` | brain | none | OpenAI-compatible endpoint with log-probabilities |
| `ARGUS_LLM_PROVIDER` | brain | `anthropic` | `anthropic`, `openai-compatible`, `fake` |
| `ARGUS_LLM_API_KEY`, `ARGUS_LLM_BASE_URL` | brain | none | secret; base URL for Azure, vLLM, Ollama, Mistral or the fake |
| `ARGUS_LLM_MODEL`, `ARGUS_LLM_PREMIUM_MODEL` | brain | per ADR-0011 | the premium tier multiplies LLM operations by 2.5 |
| `ARGUS_AI_MODE` | api | `byo` on-prem, `managed` cloud | instance default for the rate card; projects may override |
| `ARGUS_API_URL`, `ARGUS_BRAIN_URL` | runner, brain | internal service URLs | public URLs in hybrid editions |
| `ARGUS_RUNNER_TOKEN` | runner | none, required | secret; issued by `POST /runners` |
| `ARGUS_RUNNER_SLOTS`, `ARGUS_RUNNER_LABELS` | runner | `1`, none | |
| `ARGUS_RUNNER_MODE` | runner | `persistent` | `ephemeral` drains one suite and exits |
| `ARGUS_RUNNER_SPOOL_DIR`, `ARGUS_RUNNER_SPOOL_MAX_MB` | runner | `/var/lib/argus/spool`, `2048` | |
| `ARGUS_CHROMIUM_SANDBOX` | runner | `seccomp` | `off` recorded in the ledger |
| `HTTPS_PROXY`, `NO_PROXY` | runner, brain | none | honoured as is |
| `ARGUS_LICENSE_FILE` | api | `/run/secrets/licence.json` | required on-prem |
| `ARGUS_BILLING` | api | `licence` on-prem, `stripe` cloud | `none` for development |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | api | none | secret; cloud only |
| `ARGUS_SMTP_URL`, `ARGUS_MAIL_FROM` | api | none | notifications; `smtp://` or `smtps://` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | all | none | traces and metrics; `/metrics` is always on |
| `ARGUS_BOOTSTRAP_ADMIN_EMAIL` | bootstrap | none, required | first admin |
| `ARGUS_BOOTSTRAP_ADMIN_PASSWORD` | bootstrap | generated once | printed once when generated |
| `ARGUS_BOOTSTRAP_ORG_NAME` | bootstrap | `Default` | |
| `ARGUS_WEB_HTTP_PORT`, `ARGUS_WEB_HTTPS_PORT` | compose | `8080`, `8443` | host ports |
| `ARGUS_WEB_TLS` | web | `off` | `off`, `files`, `auto` |
| `ARGUS_TLS_CERT_FILE`, `ARGUS_TLS_KEY_FILE`, `ARGUS_ACME_EMAIL` | web, caddy | none | for `files` and `auto` |

## Appendix B: service matrix by edition

| Service | Dev | On-prem | Hybrid runner | Hybrid private AI | Cloud (Helm) | CI ephemeral |
| --- | --- | --- | --- | --- | --- | --- |
| postgres | bundled | bundled or external | no | no | managed, external | no |
| minio or S3 | bundled | bundled or external | no | `local-store` profile | external S3 | no |
| migrate, bootstrap | yes | yes | no | no | Helm hooks | no |
| api | host or `full` | yes | no | no | Deployment | no |
| web | host or `full` | yes | no | no | Deployment | no |
| brain | host or `full` | yes | no | yes | Deployment | no |
| runner | host or `full` | yes, N slots | yes | yes | Job per run | inside the job |
| fixture-hmi | yes | no | no | no | no | no |
| fakes | yes | no | no | no | no | no |
| caddy | no | `tls` profile | no | no | ingress instead | no |
| local LLM | optional | `local-ai` profile | no | `local-ai` profile | no | no |

## Appendix C: Dockerfile and bake sketch

`deploy/docker/Dockerfile`, abridged to the `api` and `runner` targets:

```dockerfile
# syntax=docker/dockerfile:1.7
ARG NODE_IMAGE=node:22-bookworm-slim@sha256:<digest>

FROM ${NODE_IMAGE} AS base
RUN corepack enable
WORKDIR /src

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store pnpm fetch

FROM deps AS build
COPY . .
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --offline && pnpm turbo run build

FROM build AS deploy-api
RUN pnpm --filter @argus/api deploy --prod /out

FROM build AS deploy-runner
RUN pnpm --filter @argus/runner deploy --prod /out \
 && pnpm --filter @argus/cli deploy --prod /out/cli

FROM ${NODE_IMAGE} AS api
RUN apt-get update && apt-get install -y --no-install-recommends tini ca-certificates \
      postgresql-client-16 \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd -g 10001 argus && useradd -u 10001 -g argus -M argus
COPY --from=deploy-api --chown=10001:10001 /out /app
WORKDIR /app
USER 10001:10001
ENV NODE_ENV=production
EXPOSE 3000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=6 CMD ["node", "dist/health.js"]
ENTRYPOINT ["tini", "--", "node", "dist/main.js"]
CMD ["api"]

FROM ${NODE_IMAGE} AS runner
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers NODE_ENV=production
COPY --from=deploy-runner --chown=10001:10001 /out /app
RUN apt-get update && apt-get install -y --no-install-recommends tini ca-certificates \
      tesseract-ocr tesseract-ocr-eng tesseract-ocr-fra \
      fonts-liberation fonts-noto-core fonts-noto-color-emoji \
 && cd /app && npx playwright install --with-deps chromium \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd -g 10001 argus && useradd -u 10001 -g argus -M argus \
 && mkdir -p /var/lib/argus/spool && chown 10001:10001 /var/lib/argus/spool \
 && ln -s /app/cli/dist/main.js /usr/local/bin/argus
WORKDIR /app
USER 10001:10001
VOLUME /var/lib/argus/spool
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD ["node", "dist/main.js", "health"]
ENTRYPOINT ["tini", "--", "node", "dist/main.js"]
CMD ["runner"]
```

The PostgreSQL 16 client comes from the PGDG repository because Debian bookworm ships version 15. Chromium is installed as root before the user switch, into a path readable by uid 10001.

`deploy/docker/docker-bake.hcl`:

```hcl
variable "REGISTRY" { default = "ghcr.io/<org>/argus" }
variable "VERSION"  { default = "edge" }

group "default" {
  targets = ["api", "web", "brain", "runner", "cli", "fixture-hmi", "fakes"]
}

target "_common" {
  context    = "."
  dockerfile = "deploy/docker/Dockerfile"
  platforms  = ["linux/amd64", "linux/arm64"]
  labels     = { "org.opencontainers.image.version" = VERSION }
}

target "api"    { inherits = ["_common"], target = "api",    tags = ["${REGISTRY}/api:${VERSION}"] }
target "runner" { inherits = ["_common"], target = "runner", tags = ["${REGISTRY}/runner:${VERSION}"] }
# web, brain, cli, fixture-hmi and fakes follow the same pattern
```

## Appendix D: `compose.onprem.yaml` sketch

```yaml
name: argus

x-argus: &argus
  restart: unless-stopped
  env_file: .env
  networks: [internal]
  read_only: true
  tmpfs: [/tmp]
  cap_drop: [ALL]
  security_opt: ["no-new-privileges:true"]
  logging: { driver: json-file, options: { max-size: "50m", max-file: "5" } }

services:
  postgres:
    image: postgres:16-bookworm@sha256:<digest>
    profiles: [bundled-db]
    restart: unless-stopped
    environment:
      POSTGRES_DB: argus
      POSTGRES_USER: argus
      POSTGRES_PASSWORD_FILE: /run/secrets/postgres_password
    secrets: [postgres_password]
    volumes: [argus_pgdata:/var/lib/postgresql/data]
    networks: [internal]
    healthcheck: { test: ["CMD-SHELL", "pg_isready -U argus -d argus"], interval: 5s, timeout: 3s, retries: 20 }

  minio:
    image: minio/minio:<release>@sha256:<digest>
    profiles: [bundled-store]
    restart: unless-stopped
    command: ["server", "/data"]
    environment:
      MINIO_ROOT_USER_FILE: /run/secrets/minio_root_user
      MINIO_ROOT_PASSWORD_FILE: /run/secrets/minio_root_password
    secrets: [minio_root_user, minio_root_password]
    volumes: [argus_objects:/data]
    networks: [internal]
    healthcheck: { test: ["CMD", "mc", "ready", "local"], interval: 5s, timeout: 3s, retries: 20 }

  migrate:
    <<: *argus
    image: ${ARGUS_REGISTRY}/api:${ARGUS_VERSION}
    command: ["migrate"]
    restart: "no"
    depends_on:
      postgres: { condition: service_healthy, required: false }

  bootstrap:
    <<: *argus
    image: ${ARGUS_REGISTRY}/api:${ARGUS_VERSION}
    command: ["bootstrap"]
    restart: "no"
    secrets: [licence]
    depends_on:
      migrate: { condition: service_completed_successfully }
      minio: { condition: service_healthy, required: false }

  api:
    <<: *argus
    image: ${ARGUS_REGISTRY}/api:${ARGUS_VERSION}
    secrets: [licence]
    depends_on:
      bootstrap: { condition: service_completed_successfully }
    deploy: { resources: { limits: { memory: 1g } } }

  brain:
    <<: *argus
    image: ${ARGUS_REGISTRY}/brain:${ARGUS_VERSION}
    depends_on:
      api: { condition: service_healthy }
    deploy: { resources: { limits: { memory: 1g } } }

  runner:
    <<: *argus
    image: ${ARGUS_REGISTRY}/runner:${ARGUS_VERSION}
    security_opt: ["no-new-privileges:true", "seccomp=./seccomp/chromium.json"]
    shm_size: 1g
    volumes: [argus_spool:/var/lib/argus/spool]
    stop_grace_period: 45s
    depends_on:
      api: { condition: service_healthy }
      brain: { condition: service_healthy }
    deploy: { resources: { limits: { memory: 4g } } }

  web:
    <<: *argus
    image: ${ARGUS_REGISTRY}/web:${ARGUS_VERSION}
    ports: ["${ARGUS_WEB_HTTP_PORT:-8080}:8080"]
    depends_on:
      api: { condition: service_healthy }

  caddy:
    image: caddy:2@sha256:<digest>
    profiles: [tls]
    restart: unless-stopped
    ports: ["80:80", "443:443"]
    volumes: [./caddy/Caddyfile:/etc/caddy/Caddyfile:ro, argus_caddy:/data]
    networks: [internal]

volumes:
  argus_pgdata: {}
  argus_objects: {}
  argus_spool: {}
  argus_backups: {}
  argus_caddy: {}

networks:
  internal: {}

secrets:
  postgres_password: { file: ./secrets/postgres_password }
  minio_root_user: { file: ./secrets/minio_root_user }
  minio_root_password: { file: ./secrets/minio_root_password }
  licence: { file: ./licence/licence.json }
```

The healthchecks of the ARGUS images come from the Dockerfile, so the Compose file does not repeat them. `install.sh` fills `<digest>` from `images.lock` and writes the `secrets/` files with mode 600.

## Appendix E: module map

| Work item | Track | Phase | Week, parallel plan | Days |
| --- | --- | --- | --- | --- |
| M00 Foundation and gate harness | D | 1 | 1 | 3 |
| M01 Contracts | I | 1 | 1 to 2 | 4 |
| M02 Fixture HMI | P | 1 | 2 to 3 | 5 |
| M03 AI fakes and cassettes | I | 1 | 2 to 3 | 3 |
| M04 thin slice | P | 1 | 3 | 2 |
| M10 thin slice, `run-local` | P | 1 | 3 | 2 |
| D1 Docker skeleton, config package | D | 1 | 2 to 3 | 2 |
| M04 Browser driver and observer, full | P | 2 | 4 | 3 |
| M05 Vision toolkit | P | 2 | 4 to 5 | 3 |
| M06 Navigator | I | 2 | 4 | 4 |
| M19 first pass, go or no-go | I | 2 | 5 | 2 |
| M07 Analyst | I | 2 | 5 to 6 | 4 |
| M08 Compiler | I | 2 | 6 | 3 |
| M09 Brain service | I | 2 | 7 | 3 |
| M10 Run engine, full | P | 2 | 5 to 6 | 5 |
| M12 Control plane API | F | 3 | 3 to 4 | 8 |
| M13 Metering, billing and licensing | F | 3 | 5 | 5 |
| M11 Runner agent | P | 3 | 7 | 4 |
| M14 Web console | F | 3 | 6 to 7 | 8 |
| M15 CLI and CI kit | F | 3 | 8 | 4 |
| M16 Reports, notifications and issues | F | 3 | 8 to 9 | 4 |
| D2 On-prem Compose v1, scenarios, `argus-admin` | D | 3 | 8 | 3 |
| Integration and scenarios S1 to S9, S11 | all | 3 | 9 to 11 | in the module days |
| M17 Packaging and deployment | D | 4 | 11 to 12 | 6 |
| M18 Security hardening | I and F | 4 | 11 to 12 | 5 |
| M19 Live evaluation, full | I | 4 | 12 | 4 |
| M20 Cloud operations | D | 4 | 13 | 5 |
| Release candidate and release | all | 4 | 14 | 2 |
| Total | | | | 106 |
