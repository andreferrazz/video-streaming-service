# Build context is the repository root: the web app needs the shared package.
FROM node:26.13.1-trixie-slim AS base
RUN npm install -g pnpm@10.33.2
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY shared/package.json shared/
COPY webapp/package.json webapp/
COPY worker/package.json worker/

# Everything, including dev dependencies, to run the build.
FROM base AS build
RUN pnpm install --frozen-lockfile --filter webapp...
COPY shared shared
COPY webapp webapp
# The build checks that every variable in src/env.ts is set. These placeholders
# satisfy that check and nothing more: values are read when the server starts,
# so none of them end up in the built files. They are set on this one command,
# not with ENV, so they are not recorded in any image layer either.
RUN DATABASE_URL=postgres://placeholder \
	S3_ENDPOINT=http://placeholder \
	S3_REGION=placeholder \
	S3_BUCKET=placeholder \
	S3_ACCESS_KEY_ID=placeholder \
	S3_SECRET_ACCESS_KEY=placeholder \
	ADMIN_PASSWORD=placeholder \
	SESSION_SECRET=placeholder-placeholder-placeholder \
	pnpm --filter webapp build

# Only what the built server needs at runtime.
FROM base AS deps
RUN pnpm install --frozen-lockfile --prod --filter webapp...

FROM node:26.13.1-trixie-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app ./
COPY --from=build /app/webapp/build webapp/build
USER node
WORKDIR /app/webapp
EXPOSE 3000
CMD ["node", "build"]
