# syntax=docker/dockerfile:1.7

FROM postgres:16-bookworm@sha256:da788743d2060767375896de4d646f7576f5911461444b372616f19ea61db2ec AS pg16-client

FROM node:22-trixie-slim@sha256:f4c1b09232a0ae8f765093968ec82107a1be65cb0bfb36fc831195794f139568 AS deps
WORKDIR /app
COPY ops/install-apt-packages.sh /usr/local/bin/install-apt-packages.sh
COPY package.json ./package.json
COPY package-lock.json ./package-lock.json
COPY prisma ./prisma
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    sh /usr/local/bin/install-apt-packages.sh openssl
RUN PRISMA_CLI_BINARY_TARGETS=debian-openssl-3.0.x npm ci
RUN npx prisma generate --schema=prisma/schema.prisma
RUN test -s /app/node_modules/@prisma/engines/schema-engine-debian-openssl-3.0.x
RUN test -s /app/node_modules/@prisma/engines/libquery_engine-debian-openssl-3.0.x.so.node
RUN test -s /app/node_modules/.prisma/client/default.js
RUN test -s /app/node_modules/.prisma/client/libquery_engine-debian-openssl-3.0.x.so.node

FROM deps AS build
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    sh /usr/local/bin/install-apt-packages.sh git
ARG BUILD_COMMIT_SHA
ARG BUILD_SOURCE_CLEAN
ARG BUILD_SOURCE_TREE_SHA256
COPY package.json ./package.json
COPY package-lock.json ./package-lock.json
COPY tsconfig.json ./tsconfig.json
COPY Dockerfile ./Dockerfile
COPY .dockerignore ./.dockerignore
COPY index.html ./index.html
COPY vite.config.ts ./vite.config.ts
COPY .docker-build-provenance.bundle ./.docker-build-provenance.bundle
COPY src ./src
COPY scripts ./scripts
COPY prisma ./prisma
COPY ops ./ops
RUN npm run build

FROM node:22-trixie-slim@sha256:f4c1b09232a0ae8f765093968ec82107a1be65cb0bfb36fc831195794f139568 AS production-deps
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./package.json
COPY package-lock.json ./package-lock.json
COPY prisma ./prisma
RUN npm ci --omit=dev --ignore-scripts \
  && npm cache clean --force
COPY --from=deps /app/node_modules/.prisma ./node_modules/.prisma

FROM build AS identity
ARG BUILD_COMMIT_SHA
ARG BUILD_SOURCE_CLEAN
ARG BUILD_SOURCE_TREE_SHA256
RUN rm -rf /app/node_modules
COPY --from=production-deps /app/node_modules ./node_modules
RUN npx tsx scripts/generate-build-identity.ts --commit=${BUILD_COMMIT_SHA} --clean-provenance=${BUILD_SOURCE_CLEAN} --source-tree-sha256=${BUILD_SOURCE_TREE_SHA256}

FROM node:22-trixie-slim@sha256:f4c1b09232a0ae8f765093968ec82107a1be65cb0bfb36fc831195794f139568 AS runtime
WORKDIR /app
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV NODE_OPTIONS=--enable-source-maps
ENV HOME=/tmp
ENV XDG_CONFIG_HOME=/tmp/.config
ENV XDG_CACHE_HOME=/tmp/.cache
COPY ops/install-apt-packages.sh /usr/local/bin/install-apt-packages.sh
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    sh /usr/local/bin/install-apt-packages.sh ca-certificates libpq5 libreadline8t64 util-linux
ADD --checksum=sha256:9739e5aaee4303eb4199c038b04a75d7bc7ac08314af9f763011e211dea62999 \
    https://github.com/brave/brave-browser/releases/download/v1.93.136/brave-browser_1.93.136_amd64.deb \
    /tmp/brave-browser.deb
ADD --checksum=sha256:9ea8725ad4241e4d30bc31b0d5213c7ce24b1dcd5247875b2de1bcba8c4e9b00 \
    https://brave-browser-apt-release.s3.brave.com/pool/main/b/brave-keyring/brave-keyring_1.20-1.deb \
    /tmp/brave-keyring.deb
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    sh /usr/local/bin/install-apt-packages.sh /tmp/brave-keyring.deb /tmp/brave-browser.deb \
    && ln -s /usr/bin/brave-browser-stable /usr/bin/chromium \
    # The immutable runtime deliberately strips the keyring package's APT update channel. \
    && rm -f /tmp/brave-browser.deb /tmp/brave-keyring.deb \
      /etc/apt/sources.list.d/brave-browser-release.list /usr/share/keyrings/brave-browser-archive-keyring.gpg \
    && apt-get purge -y wget \
    && apt-get check \
    && test ! -e /etc/apt/sources.list.d/brave-browser-release.list \
    && test ! -e /usr/share/keyrings/brave-browser-archive-keyring.gpg \
    && ! dpkg-query -W wget >/dev/null 2>&1 \
    && ! command -v wget
COPY --from=pg16-client /usr/lib/postgresql/16/bin/pg_dump /usr/local/bin/pg_dump
COPY --from=pg16-client /usr/lib/postgresql/16/bin/pg_restore /usr/local/bin/pg_restore
COPY --from=pg16-client /usr/lib/postgresql/16/bin/psql /usr/local/bin/psql
RUN test "$(command -v pg_dump)" = "/usr/local/bin/pg_dump" \
  && test "$(command -v pg_restore)" = "/usr/local/bin/pg_restore" \
  && test "$(command -v psql)" = "/usr/local/bin/psql" \
  && sh -lc 'test "$(command -v pg_dump)" = "/usr/local/bin/pg_dump" && test "$(command -v pg_restore)" = "/usr/local/bin/pg_restore" && test "$(command -v psql)" = "/usr/local/bin/psql"' \
  && test "$(command -v flock)" = "/usr/bin/flock" \
  && test "$(dpkg-query -W -f='${Version}' brave-browser)" = "1.93.136" \
  && test "$(dpkg-query -W -f='${Version}' brave-keyring)" = "1.20" \
  && dpkg-query -W -f='brave-browser=${Version}\n' brave-browser \
  && test "$(readlink -f /usr/bin/chromium)" = "/opt/brave.com/brave/brave-browser" \
  && pg_dump --version | grep -E '^pg_dump \(PostgreSQL\) 16\.14([ .]|$)' \
  && pg_restore --version | grep -E '^pg_restore \(PostgreSQL\) 16\.14([ .]|$)' \
  && psql --version | grep -E '^psql \(PostgreSQL\) 16\.14([ .]|$)' \
  && flock --version | grep -E '^flock from util-linux [0-9]' \
  && flock -n /tmp/flock-build-probe true \
  && ldd -r /usr/local/bin/pg_dump > /tmp/pg_dump.ldd 2>&1 \
  && ldd -r /usr/local/bin/pg_restore > /tmp/pg_restore.ldd 2>&1 \
  && ldd -r /usr/local/bin/psql > /tmp/psql.ldd 2>&1 \
  && ! grep -E 'not found|undefined symbol' /tmp/pg_dump.ldd /tmp/pg_restore.ldd /tmp/psql.ldd \
  && rm -f /tmp/flock-build-probe /tmp/pg_dump.ldd /tmp/pg_restore.ldd /tmp/psql.ldd
ARG BUILD_COMMIT_SHA
ARG BUILD_SOURCE_TREE_SHA256
LABEL org.opencontainers.image.title="Job Finder" \
  org.opencontainers.image.revision="${BUILD_COMMIT_SHA}" \
  io.jobfinder.source-tree-sha256="${BUILD_SOURCE_TREE_SHA256}"
COPY --chown=node:node --from=identity /app/package.json ./package.json
COPY --chown=node:node --from=identity /app/node_modules ./node_modules
COPY --chown=node:node --from=identity /app/dist ./dist
COPY --chown=node:node --from=identity /app/ops ./ops
# CSL's leaf certificate names this intermediate at http://cacerts.geotrust.com/GeoTrustTLSRSACAG1.crt.
ENV NODE_EXTRA_CA_CERTS=/app/ops/certificates/geotrust-tls-rsa-ca-g1.pem
RUN set -eu; \
  certificate_sha256="$(openssl x509 -in /app/ops/certificates/geotrust-tls-rsa-ca-g1.pem -outform DER | sha256sum | cut -d ' ' -f 1)"; \
  test "$certificate_sha256" = "c06e307f7cfc1d32fa72a4c033c87b90019af216f0775d64978a2eca6c8a230e"
COPY --chown=node:node --from=identity /app/scripts ./scripts
COPY --chown=node:node --from=identity /app/src ./src
COPY --chown=node:node --from=identity /app/prisma ./prisma
COPY --chown=node:node --from=identity /app/tsconfig.json ./tsconfig.json
COPY --chown=node:node --from=identity /app/index.html /app/index.html
COPY --chown=node:node --from=identity /app/vite.config.ts /app/vite.config.ts
COPY --chown=node:node --from=identity /app/build-identity.json /app/build-identity.json
COPY --chown=node:node --from=identity /app/Dockerfile /app/Dockerfile
COPY --chown=node:node --from=identity /app/.dockerignore /app/.dockerignore

RUN install -d -m 0700 -o node -g node /app/outputs
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/livez').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "node_modules/tsx/dist/cli.mjs", "src/server/httpServer.ts"]
