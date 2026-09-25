# Human checkpoints

The spec requires five human decisions. This build ran autonomously (ADR-0015), so each checkpoint is listed here with the evidence to review. None is signed off yet.

| # | When | Decision | Evidence to review | Status |
| --- | --- | --- | --- | --- |
| 1 | After MS1 | Approve the gate harness, the contracts and the fixture HMI | `gates/evidence/M00.json` to `M03.json`, `packages/contracts`, `apps/fixture-hmi` | pending |
| 2 | After the first M19 pass | Grounding go or no-go | `eval/results/`, M19-G1 and M19-G2 | pending, needs `TYPESAFE_API_KEY` |
| 3 | After MS2 | Review the break loop on ten recorded runs | M10 golden ledgers, M07 and M09 evidence | pending |
| 4 | Before Stripe leaves test mode | Prices, tax settings, refund policy | M13 evidence, rate cards | pending |
| 5 | Before a release | Security gates, every module's evidence, open ADRs | `gates/evidence/`, M18 evidence, `docs/adr/` | pending |

## Items raised during the build

Gate changes, Tier B results and questions that need a human are appended below by module.

### M07 prompt review

The implementation plan asks a human to review the Analyst prompts line by line. The
templates are `prompts/t-1.md` (break triage), `prompts/r-1.md` (run report) and
`prompts/v-1.md` (visual grounding and vision assertions); ADR M07-prompts explains the
format and the untrusted data blocks. Status: pending. Also pending: M07-G7 (live triage
quality, run as M19-G6) needs `ARGUS_LLM_API_KEY` and the labelled breaks dataset
(ADR M07-live-quality), and the model defaults of ADR M07-models are to be confirmed there.
