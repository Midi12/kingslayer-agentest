# Prompt templates

Versioned prompts of the Analyst (`@argus/analyst`, ADR M07-prompts): `t-N` triage,
`r-N` report, `v-N` vision. The Compiler's `c-N` prompts join this folder with M08.

- A file is `<id>.md`: a header for reviewers, then sections that start with a line
  `=== <name> ===`. The loader checks every section and placeholder.
- `{{name}}` takes text that code builds from closed vocabularies (the decision menu);
  `{{data:name}}` takes a delimited data block. System sections take no placeholder.
- Page-derived text reaches a prompt only inside `<argus-data>` elements, which every
  system section declares untrusted.
- A template never changes once a result was recorded with its id: a change is a new
  version (`t-2`), reviewed line by line by a human (docs/checkpoints.md), and this
  folder is a protected path.
