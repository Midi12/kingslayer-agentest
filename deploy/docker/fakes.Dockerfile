# syntax=docker/dockerfile:1.7
#
# argus/fakes: the dev-only fake Jev, fake LLM and cassette proxy (apps/fakes, plan 3.1).
# Build stage on node:22-bookworm-slim, runtime on Ubuntu 24.04 with Node copied from the
# official image (ADR-0003); uid 10001, tini, read-only root file system with a tmpfs
# /tmp, a Node health check. D1 folds this file into deploy/docker/Dockerfile.
#
#   docker build --network host --build-arg DOCKERHUB_MIRROR=mirror.gcr.io \
#     [--secret id=extra-ca,src=$NODE_EXTRA_CA_CERTS] \
#     -f deploy/docker/fakes.Dockerfile -t argus/fakes:dev .
#   docker run --read-only --tmpfs /tmp -p 127.0.0.1:4100:4100 argus/fakes:dev fake-jev

ARG DOCKERHUB_MIRROR=docker.io

FROM ${DOCKERHUB_MIRROR}/library/node:22-bookworm-slim AS node

FROM node AS build
ARG PNPM_VERSION=10.33.0
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    TURBO_TELEMETRY_DISABLED=1 \
    DO_NOT_TRACK=1 \
    CI=true
WORKDIR /src
COPY . .
# A network that re-terminates TLS passes its CA as the optional build secret `extra-ca`;
# it is used for this step only and is not stored in any layer.
RUN --mount=type=secret,id=extra-ca,required=false \
    --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    if [ -s /run/secrets/extra-ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra-ca; fi \
 && corepack enable pnpm \
 && corepack prepare "pnpm@${PNPM_VERSION}" --activate \
 && pnpm install --frozen-lockfile \
 && pnpm --filter "@argus/fakes..." run build \
 && pnpm --filter @argus/fakes deploy --prod /out \
 && rm -rf /out/src /out/test

FROM ${DOCKERHUB_MIRROR}/library/ubuntu:24.04 AS fakes
ARG ARGUS_VERSION=dev
ARG ARGUS_REVISION=unknown
LABEL org.opencontainers.image.title="argus/fakes" \
      org.opencontainers.image.description="ARGUS dev-only fakes: Jev API, LLM (Anthropic and OpenAI shapes), cassette proxy" \
      org.opencontainers.image.version="${ARGUS_VERSION}" \
      org.opencontainers.image.revision="${ARGUS_REVISION}" \
      org.opencontainers.image.source="https://github.com/Midi12/kingslayer-agentest" \
      org.opencontainers.image.licenses="UNLICENSED"
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd -g 10001 argus \
 && useradd -u 10001 -g argus -M -d /nonexistent -s /usr/sbin/nologin argus
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=build /out /app
WORKDIR /app
USER 10001:10001
ENV NODE_ENV=production \
    ARGUS_VERSION=${ARGUS_VERSION} \
    FAKE_HOST=0.0.0.0 \
    FAKE_STATUS_FILE=/tmp/argus-fakes.json
EXPOSE 4100 4200 4300
HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=6 CMD ["node", "dist/health.js"]
ENTRYPOINT ["/usr/bin/tini", "--", "node", "dist/main.js"]
CMD ["all"]
