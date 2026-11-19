# Build context is the repository root: the worker needs the shared package.
FROM node:26.13.1-trixie-slim AS deps
RUN npm install -g pnpm@10.33.2
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY shared/package.json shared/
COPY webapp/package.json webapp/
COPY worker/package.json worker/
RUN pnpm install --frozen-lockfile --prod --filter worker...

FROM node:26.13.1-trixie-slim
ENV NODE_ENV=production
# A pinned, statically linked ffmpeg; nothing else needs installing.
COPY --from=mwader/static-ffmpeg:8.1.2 /ffmpeg /ffprobe /usr/local/bin/
WORKDIR /app
COPY --from=deps /app ./
COPY shared shared
COPY worker worker
USER node
WORKDIR /app/worker
# Node runs the TypeScript sources directly; there is no build step.
CMD ["node", "src/main.ts"]
