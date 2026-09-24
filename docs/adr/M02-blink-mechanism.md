# ADR-M02-2: The alarm blink is CSS, gated by clock mode

- Status: accepted
- Date: 2026-09-24
- Module: M02

## Context

The spec asks for two things that look like they conflict: every page renders
byte-identically under a frozen clock (M02-G1), and the alarm blink is a true 1 Hz square
wave driven by real time in real-time mode (M02-G4). A JS `setInterval` loop would work
for the second but makes DOM snapshots and screenshots time-dependent even when the
server's own clock is frozen, because the browser's wall clock keeps moving regardless of
what `/sim/clock` says.

## Decision

- In **frozen** clock mode, an unacknowledged alarm row gets a fixed inline
  `background-color`, computed once from `blinkOn(nowMs)` (a pure function, 500 ms
  half-period) — no animation, no client script. Two renders of the same `nowMs` are
  byte-identical.
- In **real** clock mode, the row instead gets `class="blinking-row"`, and a CSS
  `@keyframes` animation (`animation: argus-blink 1s steps(2, jump-none) infinite`)
  handles the 1 Hz alternation entirely on the compositor thread, driven by the actual
  page's wall clock. No client-side timer code is needed.
- `no-blink` forces the frozen-style fixed colour and skips the class in both clock
  modes: the row is static.
- `steps(2, jump-none)` was chosen (not `steps(1, jump-none)`, an early draft) because a
  step count of 1 combined with `jump-none` is not a valid step function per the CSS
  Easing spec (jump-none needs at least two steps since it omits both endpoints);
  Chromium silently drops the whole `animation` declaration when it sees the invalid
  value, so the row never blinks. `pnpm --filter @argus/fixture-hmi test:gate-g4` is what
  caught this.

## Consequences

The server's `Clock` is the single source of truth for whether the alarm blink is
observed as an animation or a snapshot; `page.evaluate` polling `getComputedStyle` for 5 s
(M02-G4) reads a real, browser-timed square wave with no help from the server process.
