# syntax=docker/dockerfile:1.7
#
# M02 Fixture HMI image, argus/fixture-hmi (ADR-0003, ADR M02-docker).
#
# Build stages come from the official Node image (pnpm through corepack, no apt); the
# runtime stage is ubuntu:24.04 with only the node binary copied in, as a non-root user.
# D1 folds this into the shared multi-target Dockerfile; until then it builds and runs on
# its own:
#
#   docker build --network host --build-arg DOCKERHUB_MIRROR=mirror.gcr.io \
#     [--secret id=extra-ca,src=$NODE_EXTRA_CA_CERTS] \
#     -f deploy/docker/fixture-hmi.Dockerfile -t argus/fixture-hmi:dev .

ARG DOCKERHUB_MIRROR=docker.io

FROM ${DOCKERHUB_MIRROR}/library/node:22-bookworm-slim AS build
WORKDIR /repo
COPY . .
# A network that re-terminates TLS passes its CA as the optional build secret `extra-ca`
# (toolchain.Dockerfile precedent); used for these steps only, never stored in the image.
RUN --mount=type=secret,id=extra-ca,required=false \
    if [ -s /run/secrets/extra-ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra-ca; fi \
 && corepack enable \
 && corepack prepare pnpm@10.33.0 --activate \
 && pnpm install --frozen-lockfile
RUN pnpm exec turbo run build --filter=@argus/fixture-hmi
RUN pnpm --filter @argus/fixture-hmi deploy --prod /app/deploy

FROM ${DOCKERHUB_MIRROR}/library/ubuntu:24.04 AS runtime
COPY --from=build /usr/local/bin/node /usr/local/bin/node
RUN groupadd --gid 10001 argus \
 && useradd --uid 10001 --gid argus --no-create-home --shell /usr/sbin/nologin argus
WORKDIR /app
COPY --from=build --chown=10001:10001 /app/deploy /app
COPY --from=build --chown=10001:10001 /repo/apps/fixture-hmi/datasets /app/datasets
USER 10001:10001
ENV NODE_ENV=production \
    FIXTURE_HOST=0.0.0.0 \
    FIXTURE_PORT=4000
EXPOSE 4000
HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4000/healthz').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
ENTRYPOINT ["node", "dist/main.js"]
