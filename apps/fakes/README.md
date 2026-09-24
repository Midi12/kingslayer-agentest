# @argus/fakes

Dev-only servers of the image `argus/fakes`: the fake Jev API, the fake LLM and the cassette
proxy from `@argus/testkit`, configured by environment (ADR M03-packaging). Never shipped to
customers.

```sh
pnpm --filter @argus/fakes build && FAKE_LLM_FAULT=refusal node apps/fakes/dist/main.js all
export TYPESAFE_BASE_URL=http://127.0.0.1:4100 TYPESAFE_API_KEY=fake-typesafe-key
export ARGUS_LLM_BASE_URL=http://127.0.0.1:4200 ARGUS_LLM_API_KEY=fake-llm-key
curl -s -X PUT localhost:4200/_fake/script -d '{"response":{"text":"hello"}}'
# or in Docker: docker compose -f compose.dev.yaml --profile fakes up -d --wait fake-jev fake-llm
```

Commands: `fake-jev`, `fake-llm`, `cassette-proxy`, `all` (the default: both fakes). Each
server answers `GET /healthz`; the fakes also serve `GET /_fake/requests`, `POST /_fake/reset`,
`POST /_fake/outcomes` and `PUT /_fake/script`.

| Key | Default | Meaning |
| --- | --- | --- |
| `FAKE_HOST` | `127.0.0.1` (`0.0.0.0` in the image) | listen address |
| `FAKE_JEV_PORT`, `FAKE_LLM_PORT`, `FAKE_PROXY_PORT` | 4100, 4200, 4300 | ports |
| `FAKE_JEV_MODE` | `scripted` | `scripted`, `cassette` or `oracle` |
| `FAKE_JEV_SCRIPT` | uniform answers | JSON Jev script (answers, rules, outcomes) |
| `FAKE_JEV_CASSETTE_DIR` | required in cassette mode | directory of recorded cassettes |
| `FAKE_JEV_ORACLE_TARGETS`, `FAKE_JEV_ORACLE_SEED`, `FAKE_JEV_ORACLE_NOISE` | required, 0, 0 | JSON map description → candidate id (a list of ids when ambiguous, null when absent), seed, noise amplitude |
| `FAKE_JEV_API_KEY`, `FAKE_LLM_API_KEY` | `fake-typesafe-key`, `fake-llm-key` | accepted keys, comma separated |
| `FAKE_LLM_SCRIPT`, `FAKE_LLM_FAULT` | none | JSON LLM script; a fault applied to every call |
| `FAKE_PROXY_UPSTREAM`, `FAKE_PROXY_CASSETTE_DIR`, `FAKE_PROXY_MODE` | required, required, `strict` | cassette proxy |
| `ARGUS_VERSION`, `LOG_LEVEL` | `dev`, `info` | reported by `/healthz`; pino level |

Invalid configuration exits with 78 and names each key. The image is built from
`deploy/docker/fakes.Dockerfile`; gate M03-G6 builds and checks it.
