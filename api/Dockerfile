FROM node:26.4.0-bookworm-slim AS build

WORKDIR /workspace

RUN npm install --global pnpm@11.9.0

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY api/package.json api/package.json
RUN pnpm install --frozen-lockfile --filter @shareslices/api...

COPY tsconfig.base.json ./
COPY api/ api/
RUN pnpm --dir api exec tsc --outDir dist --rootDir . \
    && pnpm --filter @shareslices/api deploy --legacy --prod /production/api

FROM node:26.4.0-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app/api

COPY --from=build --chown=node:node /production/api/node_modules ./node_modules
COPY --from=build --chown=node:node /production/api/package.json ./package.json
COPY --from=build --chown=node:node /workspace/api/dist ./dist
COPY --chown=node:node db/migrations ./db/migrations

USER node
EXPOSE 7456

CMD ["node", "dist/src/main.js"]
