# ADR-0014: Bundled object store

- Status: accepted
- Date: 2026-09-24
- Module: program

## Context

The spec names MinIO. MinIO no longer publishes community images or binaries, its licence is AGPL, and its images cannot be pulled from this environment. The product only needs the S3 API: buckets, objects, pre-signed PUT and GET, list and delete.

## Decision

The bundled object store is VersityGW (Apache 2.0) with its POSIX backend, image `ghcr.io/versity/versitygw`, pinned by digest. It passed pre-signed PUT and GET, tamper rejection, list and delete with the AWS SDK v3, at about 10 MB of memory. Any S3 endpoint still works through `ARGUS_S3_*`, and the Compose profile keeps the name `bundled-store`. Retention never relies on bucket lifecycle rules: the api's retention job deletes objects (M12-G10).

## Consequences

Wherever the spec says MinIO, read "the bundled S3 store". Customers who prefer MinIO, SeaweedFS, Ceph or a cloud bucket set the endpoint and drop the profile.
