# syntax=docker/dockerfile:1.7
#
# argus/toolchain: the CI image and dev container (plan 4.2). Ubuntu 24.04 with Node 22
# copied from the official image (ADR-0003), pnpm through corepack, git, Tesseract with
# eng and fra, the PostgreSQL 16 client, fonts, and the Chromium runtime libraries that
# Playwright 1.56.1 needs on noble (ADR-0017). Browsers are not in the image: mount them
# at /opt/pw-browsers, which PLAYWRIGHT_BROWSERS_PATH points at.
#
#   docker build --network host --build-arg DOCKERHUB_MIRROR=mirror.gcr.io \
#     [--secret id=extra-ca,src=$NODE_EXTRA_CA_CERTS] \
#     -f deploy/docker/toolchain.Dockerfile -t argus/toolchain:dev deploy/docker

ARG DOCKERHUB_MIRROR=docker.io

FROM ${DOCKERHUB_MIRROR}/library/node:22-bookworm-slim AS node

FROM ${DOCKERHUB_MIRROR}/library/ubuntu:24.04

ARG PNPM_VERSION=10.33.0

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    COREPACK_HOME=/opt/corepack \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
    TURBO_TELEMETRY_DISABLED=1 \
    DO_NOT_TRACK=1

# Chromium runtime libraries: the Ubuntu 24.04 list of Playwright 1.56.1 (nativeDeps),
# installed by package name because `playwright install-deps` needs the Playwright CDN.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      bash ca-certificates curl git openssh-client xz-utils \
      tesseract-ocr tesseract-ocr-eng tesseract-ocr-fra \
      postgresql-client-16 \
      libasound2t64 libatk-bridge2.0-0t64 libatk1.0-0t64 libatspi2.0-0t64 libcairo2 \
      libcups2t64 libdbus-1-3 libdrm2 libgbm1 libglib2.0-0t64 libnspr4 libnss3 \
      libpango-1.0-0 libx11-6 libxcb1 libxcomposite1 libxdamage1 libxext6 libxfixes3 \
      libxkbcommon0 libxrandr2 libfontconfig1 libfreetype6 \
      fonts-liberation fonts-noto-core fonts-noto-color-emoji fonts-freefont-ttf \
      fonts-ipafont-gothic fonts-wqy-zenhei fonts-tlwg-loma-otf fonts-unifont \
 && rm -rf /var/lib/apt/lists/*

COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
# A network that re-terminates TLS passes its CA as the optional build secret `extra-ca`
# (docker build --secret id=extra-ca,src=<pem>); it is used for this step only and is not
# stored in the image.
RUN --mount=type=secret,id=extra-ca,required=false \
    if [ -s /run/secrets/extra-ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/extra-ca; fi \
 && ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
 && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
 && ln -s ../lib/node_modules/corepack/dist/corepack.js /usr/local/bin/corepack \
 && corepack enable pnpm \
 && corepack prepare "pnpm@${PNPM_VERSION}" --activate \
 && chmod -R a+rX "${COREPACK_HOME}" \
 && mkdir -p "${PLAYWRIGHT_BROWSERS_PATH}" \
 && node --version && pnpm --version && tesseract --version | head -n 1 && psql --version

WORKDIR /work
CMD ["bash"]
