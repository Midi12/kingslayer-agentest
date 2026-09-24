# ADR-M02-1: How the fourteen faults are implemented

- Status: accepted
- Date: 2026-09-24
- Module: M02

## Context

The spec names the fourteen faults and a one-line description each but leaves the exact
mechanism open. Faults must compose, must be visibly testable (M02-G2), and must not
break determinism (M02-G1) or the dataset's `data-testid` contract (M02-G3).

## Decision

- `rename-start` / `move-start` are global toggles over the conveyors table renderer:
  the first swaps the Start button's label to "Run" and its `data-testid` from
  `start-cXX` to `run-cXX`; the second moves the Start button from the Actions cell into
  the Status cell, keeping `start-cXX`. They are mutually distinguishable so a healing
  locator strategy can be told apart from a moved one.
- `dup-labels` renames only C13's displayed name to "Conveyor C12" (id and every testid
  stay correct), producing exactly two rows a text-only reader would call "C12".
- `wrong-state` is scoped to C12 only: `FixtureSimulator`'s status resolver forces C12 to
  stay `Stopped` regardless of a pending start, everywhere the state is read (table, SVG,
  canvas). `no-effect` is a separate, global toggle: `startConveyor`/`stopConveyor`
  record the call but skip every state change, for every conveyor.
- The Start delay (800 ms of simulator time) is represented as `pendingRunAtMs` on the
  conveyor; nothing sets a real timer. Status and indicator colour are pure functions of
  `(conveyor, faults, nowMs)`, resolved at read time. This is also where the amber
  indicator comes from: amber means "pending, not yet Running".
- `blocking-modal` and `error-toast` render fixed elements (`blocking-modal-overlay`,
  `toast-error`) only on `/conveyors`, matching the spec's own wording for the overlay.
- `shadow-dom` wraps the conveyors table fragment in a declarative shadow root
  (`<template shadowrootmode="open">`); Playwright's locator engine pierces it, so
  `data-testid` locators need no special handling from a consumer.
- `iframe` swaps the table fragment for a same-origin `<iframe src="/conveyors/table-frame">`,
  a protected route that renders the same fragment (composable with `shadow-dom`). A
  locator without a `frame` hint will not find the table; one with `target.frame` set
  will, which is the intended lesson for the Navigator.
- `session-expiry` makes `FixtureSimulator.validateSession` return `undefined`
  unconditionally while the fault is active, so the very next protected request redirects
  to `/login`, whatever cookie it carries.
- `locale-fr` swaps the whole i18n dictionary (`src/core/i18n.ts`); `data-testid` values
  never depend on locale.
- `injection` inserts the literal marker `ARGUS-INJECT:` (never a real instruction a
  fixture consumer would want obeyed) into six kinds of text: a visible paragraph, a
  visually-hidden element, an `aria-label`, an image `alt`, a toast, and canvas-drawn
  text, via `src/core/injection.ts`'s single source of the string.
- Faults compose because each is read independently off the same `Set<FaultName>`; no
  fault's code path checks for another fault's presence except `wrong-state` (scoped to
  C12) and `no-effect` (a short-circuit before any other fault's effect would apply).

## Consequences

Every fault is a pure function of state, not a timer or a stateful side channel, so
M02-G1's determinism holds automatically once a fault is behind the same `(state, faults,
nowMs)` inputs. Adding a fifteenth fault later means adding one branch to the render or
simulator layer, not a new subsystem.
