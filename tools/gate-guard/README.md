# @argus/gate-guard

Protected paths never change together with implementation code (CLAUDE.md section 2,
ADR-0015). Protected: `gates/*.yaml`, `**/__golden__/**`, `thresholds/**`, `prompts/**`,
`packages/navigator/src/questions.ts`. Neutral, allowed on either side:
`gates/evidence/**` and `docs/gate-changes/**`. Tests (`apps/*/test/**`,
`packages/*/test/**`, `tools/*/test/**`, `**/*.test.*`, `**/*.spec.*`) go with
implementation freely, but with protected paths only in a gates-first commit
`test(<MOD>): …` or a gate change `chore(<MOD>): gate-change <n>`; a `fix(M06)` commit that
edits `gates/M06.yaml` and its gate test fails. Where no subject is known (`--files`
without `--subject`, `--diff`, a range without `--per-commit`) tests count as neutral.
Everything else, including a `test/` folder under `src/`, is implementation. Protected
wins over neutral and tests.

```sh
pnpm gate-guard --files tools/gate-guard/test/fixtures/g5/gates-and-src.txt  # exit 1
pnpm gate-guard --files tools/gate-guard/test/fixtures/g5/gates-only.txt     # exit 0
git diff --name-only HEAD~1 | pnpm gate-guard --files -                      # a list on stdin
git diff --name-only HEAD~1 | pnpm gate-guard --files - --subject "$(git log -1 --format=%s)"
pnpm gate-guard --range origin/main..HEAD --per-commit --conventional        # each commit (ADR-0015)
pnpm gate-guard --diff origin/main HEAD                                      # merge-request mode
```

`--diff <base> <head>` checks the combined diff `base...head`. `--range <base>..<head>`
checks the whole range as one change, or each commit with `--per-commit`; merge commits
are skipped because their commits are checked one by one. `--conventional` also requires
conventional subjects such as `feat(M06): …`. `--repo <dir>` selects the repository.
Exit codes: 0 clean, 1 violation, 2 usage or git error.
