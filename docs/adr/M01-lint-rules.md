# ADR M01-lint-rules: Exact checks of lint rules L1 to L8

- Status: accepted
- Date: 2026-09-24
- Module: M01

## Context

The Lint rules table states each rule in one line. A deterministic linter needs exact
checks. `lintScript(script, {criticalVerbs, allowedOrigins, allowedHttpHosts,
runTimeoutMs, previous?})` returns findings `{code, stepId, path, message, severity}`,
all with severity `error`, ordered by rule then position.

## Decision

- L1: every target of an action (both targets of `drag`) has at least three words and
  none of the pronouns it, its, itself, this, these, those, they, them, their, theirs,
  themselves, he, him, his, she, her, hers. "that" stays allowed as a relative pronoun.
- L2: step Noul statements and Noul handler conditions are not questions (final `?` or
  an interrogative first word) nor instructions (check, verify, ensure, ...); make one
  claim (no and, or, but, also, as well as, `;`, single sentence); contain no numeric
  comparison (more or less than, at least or most, symbols, above or below a number),
  count (number words, "number of", a number before a plural noun or `%`) or date or time
  (month and day names, today, ISO and numeric dates, clock times). A number that is an
  identifier ("conveyor 12 is running", "C12") is allowed.
- L3: every `${secret.NAME}` is declared and appears only in a fill value or an http
  header or body; a fill whose target names a password, passcode, passphrase, PIN or pwd
  takes exactly `${secret.NAME}`; literal credentials are flagged anywhere (API keys,
  GitHub and AWS keys, JWTs, literal Bearer or Basic credentials, private keys, user
  info in URLs), as are literal values of sensitive headers and of sensitive members in
  `json` bodies and `variables`.
- L4: `navigate` URLs are relative, start with `${env.NAME}` (environment-controlled,
  enforced again at run time), or have an origin in `allowedOrigins`; `http` URLs are
  absolute or `${env.NAME}`-based and their host (with its port, or bare for default
  ports) is in `allowedHttpHosts`; a host built from a template, a non-HTTP scheme or an
  unparsable URL is rejected; `baseUrl` is `${env.NAME}` or an allowed origin. URLs are
  judged as the WHATWG parser (browsers, Playwright) reads them: after its whitespace
  preprocessing, and resolved both on their own and against a sentinel base per page
  scheme (the base URL's scheme when it is literal, else `https` and `http`). A URL is
  relative only when every resolution stays on the sentinel; otherwise every origin it
  reaches must be allowed. So `\\evil.com`, `/\evil.com`, ` //evil.com`, a tab before
  `//` and `https:evil.com` are findings, not relative paths.
- L5: an acting step whose intent contains a critical verb or its inflection (stops,
  stopped, stopping, purging, ...) has `risk: critical`.
- L6: `within` is at most 120 s; the sum of the main steps' windows (declared or the
  10 s default) must not exceed `runTimeoutMs`; the finding names the first step past it.
- L7: baseline names are unique in the script; a mask description is not blank and a
  mask rectangle has a positive width and height. L7 also covers the other expectation
  parameter the schema cannot relate: a `blink` range needs `minHz <= maxHz`.
- L8: step ids, handler ids and handler step ids are unique together; with `previous`,
  a step whose normalised intent (NFKC, case, spacing, final punctuation) is unchanged
  keeps its previous id, matched occurrence by occurrence; a fragment reference without
  an intent is matched by `use`.

## Consequences

The lint is conservative: a critical verb used as a noun, or "and" inside a name, is
flagged, and the author rewords or raises the risk.
