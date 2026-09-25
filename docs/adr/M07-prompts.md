# ADR M07-prompts: Template files and delimited data fields

- Status: accepted
- Date: 2026-09-25
- Module: M07

## Context

Prompts are versioned in `prompts/` as `t-N`, `r-N` and `v-N`, and page text enters only inside delimited data fields that the system text declares untrusted. The file format, the delimiter and how a hostile page is kept from closing it are open.

## Decision

- One Markdown file per version, `prompts/<id>.md`: a free header for reviewers, then sections introduced by `=== <name> ===`. Triage and report have `system`, `user` and `repair`; vision has `system:ground`, `user:ground`, `system:assert`, `user:assert` and `repair`. The loader checks the exact placeholder set of every section, so code and templates cannot drift apart.
- Placeholders: `{{menu}}` is the only trusted one and holds text code builds from closed vocabularies and configured origins; `{{data:<name>}}` holds a data block. System sections take no placeholder, must mention `<argus-data>` and "untrusted", and no section may contain a literal data element.
- A data block is `<argus-data name="…" format="json|ndjson">`, then JSON (two-space indented, so each field sits on its own line) or one JSON value per line, then `</argus-data>`. `<`, `>` and `&` are escaped as `<`, `>`, `&`; they can only occur inside JSON strings, so no data can close the element or open another, and the escape keeps the JSON equal. Everything page-derived is inside a block: the whole packet (script intents too), mark labels, the vision question, the ledger, a rejected answer and its validator errors; every image is introduced by a small `image` block.
- The expected answer of a vision assertion is not sent: the model answers the question and code compares.
- A template never changes once results were recorded with its id; a change is a new version, reviewed line by line by a human (checkpoint entry "M07 prompt review" in `docs/checkpoints.md`). `prompts/**` is a protected path.
- The Analyst uses the highest version of each kind unless the brain pins one (`promptVersions`, or `ReportInput.promptVersion`); `generatedBy.promptVersion` and the brain usage record the id used.

## Consequences

M07-G3 checks that planted instructions reach the provider only inside data blocks. Delimiting reduces, but cannot remove, a model's tendency to follow page text; containment rests on the closed menus and the validator, which do not depend on the model's cooperation.
