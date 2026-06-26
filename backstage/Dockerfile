# Multi-stage build for this Backstage app.
#
# Unlike the host-build Dockerfile in packages/backend/Dockerfile (which expects
# `yarn install && yarn tsc && yarn build:backend` to have run first), this one
# builds everything INSIDE Docker, so CI only needs `docker build` against this
# directory — no host pre-build step. The build context is this folder (the
# Backstage monorepo root).
#
# Stage 1 installs deps + builds the backend bundle; stage 2 is a slim runtime
# image that installs only production deps and runs the bundle.

# Base image is pulled from ECR Public (AWS's mirror of Docker Hub official
# images) instead of docker.io, so CI builds don't hit Docker Hub's anonymous
# pull rate limit (HTTP 429). Same node:22-bookworm-slim image, different (un-
# rate-limited) registry.

# ---------- Stage 1: build ----------
FROM public.ecr.aws/docker/library/node:22-bookworm-slim AS build

# Build deps: python3/g++ for native modules (isolated-vm via scaffolder,
# better-sqlite3), plus build-essential.
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && \
    apt-get install -y --no-install-recommends python3 g++ build-essential libsqlite3-dev ca-certificates

USER node
WORKDIR /app
ENV NODE_OPTIONS="--no-node-snapshot"

# Yarn 4 lives in .yarn/releases and is selected by .yarnrc.yml.
COPY --chown=node:node .yarn ./.yarn
COPY --chown=node:node .yarnrc.yml backstage.json package.json yarn.lock tsconfig.json ./

# Workspace package.json files (so the dependency graph resolves) + sources.
COPY --chown=node:node packages packages
COPY --chown=node:node plugins plugins

RUN --mount=type=cache,target=/home/node/.cache/yarn,sharing=locked,uid=1000,gid=1000 \
    yarn install --immutable --network-timeout 600000

# Type-check, then build + bundle the backend (produces skeleton.tar.gz +
# bundle.tar.gz under packages/backend/dist).
RUN yarn tsc
RUN yarn build:backend

# ---------- Stage 2: runtime ----------
FROM public.ecr.aws/docker/library/node:22-bookworm-slim

ENV PYTHON=/usr/bin/python3

# Runtime native-module build deps (scaffolder isolated-vm, better-sqlite3) +
# python/venv for the TechDocs local generator (mkdocs).
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && \
    apt-get install -y --no-install-recommends \
      python3 python3-pip python3-venv g++ build-essential libsqlite3-dev ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# TechDocs (builder: local) generates docs with mkdocs at runtime.
ENV VIRTUAL_ENV=/opt/venv
RUN python3 -m venv "$VIRTUAL_ENV"
ENV PATH="$VIRTUAL_ENV/bin:$PATH"
RUN pip3 install --no-cache-dir 'mkdocs-techdocs-core==1.4.2'

USER node
WORKDIR /app
ENV NODE_ENV=production
ENV NODE_OPTIONS="--no-node-snapshot"

# Install production deps from the repo skeleton (package.json files only) so
# this layer is cached unless dependencies change.
COPY --from=build --chown=node:node /app/.yarn ./.yarn
COPY --from=build --chown=node:node /app/.yarnrc.yml /app/backstage.json /app/yarn.lock /app/package.json /app/packages/backend/dist/skeleton.tar.gz ./
RUN tar xzf skeleton.tar.gz && rm skeleton.tar.gz

RUN --mount=type=cache,target=/home/node/.cache/yarn,sharing=locked,uid=1000,gid=1000 \
    yarn workspaces focus --all --production && rm -rf "$(yarn cache clean)"

# App config + example catalog data + scaffolder templates the app references.
# These come straight from the build context (they aren't build outputs).
COPY --chown=node:node app-config.yaml app-config.production.yaml ./
COPY --chown=node:node examples ./examples
COPY --chown=node:node templates ./templates

# The built backend bundle.
COPY --from=build --chown=node:node /app/packages/backend/dist/bundle.tar.gz ./
RUN tar xzf bundle.tar.gz && rm bundle.tar.gz

CMD ["node", "packages/backend", "--config", "app-config.yaml", "--config", "app-config.production.yaml"]
