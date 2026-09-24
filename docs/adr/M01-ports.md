# ADR M01-ports: Port interfaces return Result

- Status: accepted
- Date: 2026-09-24
- Module: M01

## Context

The spec writes `ground(req): Promise<GroundResult>` and `triage(packet):
Promise<AnalystDecision>`, while the repository convention is that ports return
`Result` and exceptions are for bugs. The Analyst answer also has to carry the tokens
spent, which `AnalystDecision` has no field for.

## Decision

- `Result<T, E>` is `{ ok: true, value } | { ok: false, error }` with `ok`, `err`,
  `isOk`, `isErr`, `mapResult`, `unwrapOr`.
- `Navigator.ground` and `verify` return `Result<GroundResult | VerifyResult,
  NavigatorError>`; `GroundResult` and `VerifyResult` already carry model, usage and
  latency. `Analyst` methods return `Result<Billed<T>, AnalystError>` where `Billed<T> =
  { result, usage: BrainUsage }` is also the brain response body. `Compiler.compile`
  returns `Result<CompileResult, CompilerError>`; `CompileResult.usage` is a
  `BrainUsage`.
- One error union for AI ports: `unavailable` (maps to `NAVIGATOR_UNAVAILABLE` or
  `ANALYST_UNAVAILABLE`), `invalid_answer` after the repair attempt (`ANALYST_INVALID`),
  `invalid_request`, and `redaction_failed`.
- `Clock` is `now(): number` (epoch milliseconds) and `sleep(ms, signal?)`;
  `IdGenerator` is `next(prefix): string`.
- The platform ports (`Queue`, `EventBus`, `ObjectStore`, `Mailer`, `Payments`) are
  taken verbatim from the program's shared definition, with `Result` imported from this
  package.
- Ports are types only; the package has no adapters.

## Consequences

Adapters translate transport failures into these codes; the engine maps them to break
reasons without catching exceptions.
