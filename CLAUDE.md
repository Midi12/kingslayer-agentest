# ARGUS: working agreement for coding agents

ARGUS is an AI-driven QA platform for web HMIs. The binding specification is in `docs/spec/` (product design, architecture and contracts, implementation spec). The delivery plan is `docs/plan/implementation-plan.md`. Program-level decisions are ADRs in `docs/adr/0*.md`; module decisions are `docs/adr/Mxx-<slug>.md`.

Read the module section of `docs/spec/03-implementation-spec.md`, every contract it names in `docs/spec/02-architecture-and-contracts.md`, and the program ADRs before writing code. When the spec and an ADR disagree, the ADR wins.

## 1. Environment facts (this build host and its CI)

| Fact | Consequence |
| --- | --- |
| Node 22, pnpm 10, Go 1.24, Docker 29 with buildx and Compose v2 | Use them as installed. Do not install another Node. |
| 4 CPUs, 15 GB RAM, other agents work in parallel | Never hard-code ports in tests: bind port 0 and pass URLs. Keep test parallelism modest (`--pool=forks --poolOptions.forks.maxForks=2` for heavy suites). |
| Docker Hub pulls are rate-limited | Images come from `mirror.gcr.io/library/...` in this environment. Dockerfiles and Compose files take `ARG/ENV DOCKERHUB_MIRROR` (default `docker.io`); this host sets `DOCKERHUB_MIRROR=mirror.gcr.io`. |
| Debian apt mirrors are blocked; the Ubuntu archive works | Runtime images are `ubuntu:24.04` with Node copied from the official Node image (ADR-0003). |
| The Playwright CDN is blocked | `playwright` and `@playwright/test` are pinned to exactly `1.56.1`, whose Chromium build 1194 is preinstalled at `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`. Never run `playwright install`. Image builds take it through the named build context `pw-browsers` (ADR-0017). |
| `docs.typesafe.ai` is blocked | The Jev API reference is the SDK itself: `node_modules/@typesafe-ai/sdk/dist/index.d.mts` (pinned `@typesafe-ai/sdk@0.6.0`, endpoint `POST /v1/systemone`, model list `GET /v1/models`) plus the contracts in the spec. |
| Tesseract 5.3 with `eng` and `fra` is installed at `/usr/bin/tesseract` | The vision toolkit shells out to the binary, as the spec says. |
| Shared dev services from `compose.dev.yaml` (project name `argus-dev`) | Postgres 16 on `127.0.0.1:5432` (user `argus`, password `argus`, db `argus`); S3 (VersityGW) on `127.0.0.1:9000` (key `argus`, secret `argus-dev-secret`). Tests create their own database or bucket prefix with a random suffix and drop it afterwards. Never stop or recreate these services. |
| Helm, kind, kubeconform, gitleaks, tflint, terraform and, when installed, cosign, syft, trivy are on `PATH` | Tier C gates may use them. Check with `command -v` and report `not_run` with a reason when a tool is missing. |
| No `TYPESAFE_API_KEY` or LLM key on this host | Tier B gates are implemented fully and report `not_run: missing credentials`. They are never faked into a pass (ADR-0016). |
| One shell command may run at most 10 minutes, and an agent cannot wait on a background job | Run longer commands with `/home/user/wt/bin/job-start <name> <dir> '<command>'` and poll with `/home/user/wt/bin/job-wait <name> 540` until it prints `DONE exit=<code>`; logs are in `/home/user/wt/jobs/`. |
| The shell profile exports `DOCKERHUB_MIRROR=mirror.gcr.io` | Gates, builds and Compose pick up the mirror without extra flags. |
| Only loopback is reachable from Tier A tests | The network guard in `packages/testkit` throws `NETWORK_DENIED` on any non-loopback socket. |

## 2. Working loop per module (autonomous form, ADR-0015)

No human is available during the build, so merge requests become commit sequences on a per-module branch and human checkpoints are recorded in `docs/checkpoints.md` as pending sign-offs. Everything else in the spec's protocol stands.

1. Work only in your module worktree, `/home/user/wt/<MOD>` on branch `mod/<MOD>`, created from the integration branch. Never edit `/home/user/kingslayer-agentest` directly unless you are the merge step.
2. Read the module section, the contracts it names, the ADRs, and the README and public exports of every package you depend on. List open questions; decide each one yourself and record it as an ADR (`docs/adr/<MOD>-<slug>.md`, at most one page).
3. Gates first. Commit `gates/<MOD>.yaml`, the gate tests (they may fail at this point) and golden files in one commit, `test(<MOD>): gates and failing tests`. This commit touches no implementation source.
4. Implement until `pnpm gate <MOD>` passes. Commit small: `feat(<MOD>): …`, `fix(<MOD>): …`. Implementation commits never touch protected paths.
5. A gate that is wrong or unreachable is never edited to pass. Write `docs/gate-changes/<MOD>-<n>.md` with the reasoning and the proposed change, commit it together with the gate change in a commit that touches only protected paths and that note, `chore(<MOD>): gate-change <n>`. A gate change may not lower a threshold, count or coverage figure the spec states; it may only fix a mechanism.
6. Run `pnpm gate <MOD>` on a clean install and commit `gates/evidence/<MOD>.json` alone, `chore(<MOD>): gate evidence`.
7. The package README shows how to run the module against the fakes in under ten lines.

Protected paths, which never change in the same commit as implementation code: `gates/*.yaml`, `**/__golden__/**`, `thresholds/**`, `prompts/**`, `packages/navigator/src/questions.ts`. `gates/evidence/**` is output, not protected.

## 3. Repository conventions

- pnpm workspace with Turborepo. Packages are `@argus/<name>` under `packages/`, applications under `apps/`, tools under `tools/`.
- ESM everywhere (`"type": "module"`), TypeScript strict with `noUncheckedIndexedAccess`, `moduleResolution: "NodeNext"`. No `any`, no non-null assertion in `core`.
- Each package has `src/ports`, `src/adapters`, `src/core` (only the folders it needs) and `src/index.ts` as its public surface. `core` is pure: time and ids come from the `Clock` and `IdGenerator` ports.
- Package exports use a source condition so tests and typechecks need no build: `"exports": { ".": { "@argus/source": "./src/index.ts", "types": "./dist/index.d.ts", "default": "./dist/index.js" } }`. Vitest and `tsconfig.base.json` enable the `@argus/source` condition; the production build uses `dist`.
- Public contract types and schemas live in `@argus/contracts` only. Other packages import them from there.
- Adapters are wired only in `apps/*/src/main.ts`; dependency-cruiser enforces it (`pnpm depcruise`).
- Errors: ports return `Result` types (`@argus/contracts` exports `Result`, `ok`, `err`); exceptions are for bugs.
- Logs: pino JSON with `runId` and `stepId` when known. Nothing logs page text at `info` level.
- Tests: Vitest (+ fast-check) under `test/`; Playwright Test for the console end to end. Line coverage at least 85% for packages and 70% for apps.
- Gate scripts are package scripts named `test:gate-g<N>`. A gate command writes a JSON metrics object to the file named by `$GATE_METRICS` when set; `gates/<MOD>.yaml` pass expressions read it.
- Forbidden in committed code: `TODO`, `FIXME`, `.skip`, `.only`, `xit`, placeholder implementations, fakes wired into production entry points, weakened assertions.
- Every new dependency: one line in the commit body with purpose, licence and size.
- Commits: conventional, scoped by module, e.g. `feat(M06): stage-two confirmation`. End every commit message with the two trailer lines given in section 5.

## 4. Gate file format

```yaml
module: M06
title: Navigator
gates:
  - id: M06-G1
    tier: A                     # A hermetic, B live AI, C deployment
    title: Requests conform to the TypeSafe API
    command: pnpm --filter @argus/navigator test:gate-g1
    timeoutSec: 900
    requires: []                # env var names or tools; missing -> not_run with reason
    pass: exitCode == 0 && metrics.tasks >= 120 && metrics.invalid == 0
```

`pnpm gate <MOD> [--tier A|B|C]` runs a module's gates and writes `gates/evidence/<MOD>.json`; `pnpm gate all --tier A` is the regression suite. Status per gate is `pass`, `fail` or `not_run`; a module passes a tier only when every gate of that tier passes.

## 5. Commit trailers

End every commit message with exactly these two lines:

```text
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01TnB6D6WodNqVyh1B1QQZQz
```

Git identity is configured in the repository. Never push: only the merge step pushes, and only the integration branch `claude/determined-darwin-e5wdgo`.

## 6. Commands

| Command | What it does |
| --- | --- |
| `pnpm install` | Install the workspace (pnpm 10.33.0 through corepack) |
| `DOCKERHUB_MIRROR=mirror.gcr.io docker compose -f compose.dev.yaml up -d --wait` | Start or check the shared Postgres and S3 services; never `down` them |
| `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm format` | Turborepo over every package |
| `pnpm depcruise [path...]` | Dependency rules on the real tree, or on the given paths |
| `pnpm gate <MOD\|all> [--tier A\|B\|C] [--strict]` | Run gates, write `gates/evidence/<MOD>.json`; `pnpm gate verify <file>` rechecks a hash |
| `pnpm g0 <package-dir...>` | Global gate G0; every module lists it as its `Mxx-G0` gate |
| `pnpm gate-guard --range <base>..<head> --per-commit` | Protected paths commit by commit (`--diff`, `--files` also exist) |
| `pnpm scenario` | Not available until D2 (exit 3) |

A package's `vitest.config.ts` calls `defineArgusVitestConfig` from `packages/testkit/src/vitest-preset.ts` (relative import), which installs the network guard. Gate tests call `recordGateMetrics` from `@argus/testkit`. Run `pnpm gate` with `DOCKERHUB_MIRROR=mirror.gcr.io` and `NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt` on this host, so M00-G1 can build its image and reach the npm registry from the container.
