FROM postgres:16-bookworm@sha256:da788743d2060767375896de4d646f7576f5911461444b372616f19ea61db2ec AS pg16-client

FROM node:22-bookworm-slim@sha256:53ada149d435c38b14476cb57e4a7da73c15595aba79bd6971b547ceb6d018bf AS deps
WORKDIR /app
COPY package.json ./package.json
COPY package-lock.json ./package-lock.json
COPY prisma ./prisma
RUN set -eu; \
  apt-get -o Acquire::Retries=5 -o Acquire::http::Timeout=30 update; \
  for attempt in 1 2 3; do \
    if apt-get -o Acquire::Retries=5 -o Acquire::http::Timeout=30 install -y --no-install-recommends openssl; then \
      rm -rf /var/lib/apt/lists/*; \
      break; \
    fi; \
    if [ "$attempt" -eq 3 ]; then \
      exit 1; \
    fi; \
    sleep 2; \
  done
RUN PRISMA_CLI_BINARY_TARGETS=debian-openssl-3.0.x npm ci
RUN npx prisma generate --schema=prisma/schema.prisma
RUN test -s /app/node_modules/@prisma/engines/schema-engine-debian-openssl-3.0.x
RUN test -s /app/node_modules/@prisma/engines/libquery_engine-debian-openssl-3.0.x.so.node
RUN test -s /app/node_modules/.prisma/client/default.js
RUN test -s /app/node_modules/.prisma/client/libquery_engine-debian-openssl-3.0.x.so.node

FROM deps AS build
ARG BUILD_COMMIT_SHA
ARG BUILD_SOURCE_CLEAN
ARG BUILD_SOURCE_TREE_SHA256
RUN set -eu; \
  apt-get -o Acquire::Retries=5 -o Acquire::http::Timeout=30 update; \
  for attempt in 1 2 3; do \
    if apt-get -o Acquire::Retries=5 -o Acquire::http::Timeout=30 install -y --no-install-recommends git; then \
      rm -rf /var/lib/apt/lists/*; \
      break; \
    fi; \
    if [ "$attempt" -eq 3 ]; then \
      exit 1; \
    fi; \
    sleep 2; \
  done
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
RUN npx tsx scripts/generate-build-identity.ts --commit=${BUILD_COMMIT_SHA} --clean-provenance=${BUILD_SOURCE_CLEAN} --source-tree-sha256=${BUILD_SOURCE_TREE_SHA256}

FROM node:22-bookworm-slim@sha256:53ada149d435c38b14476cb57e4a7da73c15595aba79bd6971b547ceb6d018bf AS runtime
ARG BUILD_COMMIT_SHA
ARG BUILD_SOURCE_TREE_SHA256
LABEL org.opencontainers.image.title="Job Finder" \
  org.opencontainers.image.revision="${BUILD_COMMIT_SHA}" \
  io.jobfinder.source-tree-sha256="${BUILD_SOURCE_TREE_SHA256}"
WORKDIR /app
ENV NODE_ENV=production
ENV HOME=/tmp
ENV XDG_CONFIG_HOME=/tmp/.config
ENV XDG_CACHE_HOME=/tmp/.cache
RUN set -eu; \
  apt-get -o Acquire::Retries=5 -o Acquire::http::Timeout=30 update; \
  for attempt in 1 2 3; do \
    if apt-get -o Acquire::Retries=5 -o Acquire::http::Timeout=30 install -y --no-install-recommends ca-certificates chromium libpq5 libreadline8 util-linux; then \
      rm -rf /var/lib/apt/lists/*; \
      break; \
    fi; \
    if [ "$attempt" -eq 3 ]; then \
      exit 1; \
    fi; \
    sleep 2; \
  done
COPY --from=pg16-client /usr/lib/postgresql/16/bin/pg_dump /usr/local/bin/pg_dump
COPY --from=pg16-client /usr/lib/postgresql/16/bin/pg_restore /usr/local/bin/pg_restore
COPY --from=pg16-client /usr/lib/postgresql/16/bin/psql /usr/local/bin/psql
RUN test "$(command -v pg_dump)" = "/usr/local/bin/pg_dump" \
  && test "$(command -v pg_restore)" = "/usr/local/bin/pg_restore" \
  && test "$(command -v psql)" = "/usr/local/bin/psql" \
  && sh -lc 'test "$(command -v pg_dump)" = "/usr/local/bin/pg_dump" && test "$(command -v pg_restore)" = "/usr/local/bin/pg_restore" && test "$(command -v psql)" = "/usr/local/bin/psql"' \
  && test "$(command -v flock)" = "/usr/bin/flock" \
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
COPY package.json ./package.json
COPY package-lock.json ./package-lock.json
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/ops ./ops
# CSL's leaf certificate names this intermediate at http://cacerts.geotrust.com/GeoTrustTLSRSACAG1.crt.
ENV NODE_EXTRA_CA_CERTS=/app/ops/certificates/geotrust-tls-rsa-ca-g1.pem
RUN set -eu; \
  certificate_sha256="$(openssl x509 -in /app/ops/certificates/geotrust-tls-rsa-ca-g1.pem -outform DER | sha256sum | cut -d ' ' -f 1)"; \
  test "$certificate_sha256" = "c06e307f7cfc1d32fa72a4c033c87b90019af216f0775d64978a2eca6c8a230e"
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/src ./src
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=build /app/index.html /app/index.html
COPY --from=build /app/vite.config.ts /app/vite.config.ts
COPY --from=build /app/build-identity.json /app/build-identity.json
COPY --from=build /app/Dockerfile /app/Dockerfile
COPY --from=build /app/.dockerignore /app/.dockerignore

RUN mkdir -p /app/outputs && chmod 0700 /app/outputs && chown -R node:node /app
USER node

EXPOSE 3000

CMD ["npm", "run", "start"]
