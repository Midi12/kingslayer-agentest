# @argus/gate-guard

Protected paths never change together with implementation code (CLAUDE.md section 2,
ADR-0015). Protected: `gates/*.yaml`, `**/__golden__/**`, `thresholds/**`, `prompts/**`,
`packages/navigator/src/questions.ts`. Neutral, allowed on either side:
`gates/evidence/**`, `docs/gate-changes/**` and tests (`**/test/**`, `**/*.test.*`,
`**/*.spec.*`). Everything else is implementation. Protected wins over neutral.

```sh
pnpm gate-guard --files tools/gate-guard/test/fixtures/g5/gates-and-src.txt  # exit 1
pnpm gate-guard --files tools/gate-guard/test/fixtures/g5/gates-only.txt     # exit 0
git diff --name-only HEAD~1 | pnpm gate-guard --files -                      # a list on stdin
pnpm gate-guard --range origin/main..HEAD --per-commit --conventional        # each commit (ADR-0015)
pnpm gate-guard --diff origin/main HEAD                                      # merge-request mode
```

`--diff <base> <head>` checks the combined diff `base...head`. `--range <base>..<head>`
checks the whole range as one change, or each commit with `--per-commit`; merge commits
are skipped because their commits are checked one by one. `--conventional` also requires
conventional subjects such as `feat(M06): …`. `--repo <dir>` selects the repository.
Exit codes: 0 clean, 1 violation, 2 usage or git error.
