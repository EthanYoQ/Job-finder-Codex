FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

FROM deps AS build
ARG BUILD_COMMIT_SHA
ARG BUILD_SOURCE_CLEAN
ARG BUILD_SOURCE_TREE_SHA256
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*
COPY . .
RUN npm run build
RUN npx tsx scripts/generate-build-identity.ts --commit=${BUILD_COMMIT_SHA} --clean-provenance=${BUILD_SOURCE_CLEAN} --source-tree-sha256=${BUILD_SOURCE_TREE_SHA256}

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends postgresql-client chromium \
  && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/ops ./ops
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/src ./src
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=build /app/build-identity.json /app/build-identity.json
COPY --from=build /app/Dockerfile /app/Dockerfile
COPY --from=build /app/.dockerignore /app/.dockerignore

RUN mkdir -p /app/outputs && chmod 0700 /app/outputs && chown -R node:node /app
USER node

EXPOSE 3000

CMD ["npm", "run", "start"]
