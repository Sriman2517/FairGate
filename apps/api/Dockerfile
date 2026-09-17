# Build from the repository root: docker build -f apps/api/Dockerfile .
FROM node:22-bookworm-slim AS dependencies
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN npm ci --workspace @fairgate/api --include-workspace-root=false

FROM dependencies AS build
COPY apps/api/tsconfig.json apps/api/prisma.config.ts ./apps/api/
COPY apps/api/prisma ./apps/api/prisma
COPY apps/api/src ./apps/api/src
# Prisma config needs a URL while generating. This is a non-secret placeholder;
# building does not connect to it or apply migrations.
RUN DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build npm run build --workspace @fairgate/api

# Explicit, one-off administration image. Never the public service's start command.
FROM build AS tools
ENV NODE_ENV=production
WORKDIR /app/apps/api
USER node
CMD ["npm", "run", "db:deploy"]

FROM build AS production-dependencies
RUN npm prune --omit=dev --omit=optional --workspace @fairgate/api --include-workspace-root=false \
    && mkdir -p /app/apps/api/node_modules

FROM node:22-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4000
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=production-dependencies /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
COPY --from=build /app/apps/api/dist ./apps/api/dist
WORKDIR /app/apps/api
USER node
EXPOSE 4000
# Direct Node process receives SIGTERM and drains requests + the release worker.
CMD ["node", "dist/server.js"]
