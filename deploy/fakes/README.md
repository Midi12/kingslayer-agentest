# Fixtures for the fakes in compose.dev.yaml

The services `fake-jev` and `fake-llm` of the profile `fakes` mount this directory (or the
one named by `FAKE_FIXTURES_DIR`) read-only at `/fixtures`. Put script, target and cassette
files here and name them by their path inside the container, for example:

```sh
FAKE_JEV_MODE=oracle FAKE_JEV_ORACLE_TARGETS=/fixtures/targets.json \
  docker compose -f compose.dev.yaml --profile fakes up -d --wait fake-jev
```

A missing or invalid file makes the container exit with 78; it is restarted at most three
times. The keys are listed in `apps/fakes/README.md`.
