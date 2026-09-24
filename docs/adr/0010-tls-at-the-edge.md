# ADR-0010: TLS at the edge

- Status: accepted
- Date: 2026-09-24
- Module: program

## Decision

`ARGUS_WEB_TLS=off|files|auto`. `files`: nginx in `argus/web` terminates with mounted certificate files. `auto`: the `tls` Compose profile starts Caddy with ACME in front of `web`. `off`: a customer proxy terminates, with `ARGUS_TRUST_PROXY=true`.
