# ADR-0008: Tier A network allow-list

- Status: accepted
- Date: 2026-09-24
- Module: program

## Decision

The Tier A guard allows loopback addresses (127.0.0.0/8, ::1) and Unix sockets only. Shared dev services are reached on loopback ports, so Tier A needs no other exception. Tier C runs inside Compose networks and does not load the guard.
