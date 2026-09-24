# ADR M00-ci: CI jobs

- Status: accepted
- Date: 2026-09-24
- Module: M00

## Context

ADR-0001 makes GitHub Actions the active pipeline with `.gitlab-ci.yml` as a reference.
Plan section 4.3 lists `gate-guard`, `tier-a` (in `argus/toolchain`, network guard on,
no egress) and `build-images`, plus a nightly Tier B.

## Decision

- `.github/workflows/ci.yml`, on pull requests, pushes to `main` and `master`, and manual
  dispatch:
  - `gate-guard`: `pnpm gate-guard --range <base>..<head> --per-commit --conventional`
    over the pull request range, the pushed range, or for a new branch the range from its
    merge base with the default branch.
  - `tier-a`: `docker compose -f compose.dev.yaml up -d --wait`, `pnpm install
    --frozen-lockfile`, then `pnpm gate all --tier A --strict` as a dedicated user whose outbound
    traffic iptables and ip6tables limit to loopback and the Docker bridge networks.
    Docker builds and the M00-G1 install container run in the daemon as root and keep
    registry access; M00-G1 runs `pnpm build` and `pnpm test` in a second host-network
    container as the invoking uid, so the rule covers them too. The host network stays,
    because Tier A tests of later modules reach the shared services on 127.0.0.1. The job runs on the
    runner rather than inside `argus/toolchain`, because that image is not published to a
    registry until the release pipeline exists; M00-G1 exercises the image on every run.
    `--strict` turns a Tier A gate that cannot run (Docker daemon unreachable, missing
    tool) into a failed job, since a module passes a tier only when every gate passes.
  - `build-images`: `docker buildx bake -f deploy/docker/docker-bake.hcl` when that file
    exists (D1), a message otherwise.
- `.github/workflows/tier-b.yml`: nightly and on demand, `TYPESAFE_API_KEY` and
  `ARGUS_LLM_API_KEY` from secrets, `pnpm gate all --tier B`, evidence as artifacts.
- `.gitlab-ci.yml` has the same jobs; `tier-a` uses Docker-in-Docker so that
  compose.dev.yaml and the toolchain image behave as on a developer host. Two deviations
  from the active job are accepted for this reference, which cannot be exercised here:
  the gates run with the dind namespace's full egress (only the in-process network guard
  applies, not the no-egress rule of spec M00), and `argus/toolchain` has no Docker CLI,
  so M00-G1 is always `not_run` there; the job therefore runs without `--strict`.
  Adopting GitLab as the active CI means adding an egress lockdown and a Docker CLI to
  that job, then `--strict`.
- `CODEOWNERS` routes the protected paths to a human; the pull request template asks for
  the evidence file, the ADR links and one line per new dependency.

## Consequences

When images are published, `tier-a` can move into `argus/toolchain` with the same
commands.
