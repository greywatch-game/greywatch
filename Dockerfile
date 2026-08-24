# syntax=docker/dockerfile:1
#
# Dockerfile — the static game, and the match server it can be played against.
#
# TWO runtime targets out of one build stage:
#
#   web     nginx + dist/. The whole single-player game, and the client half of
#           multiplayer. Carries no Node, no source and no node_modules.
#   server  Node + dist-server/. The authoritative simulation: bots, flags,
#           tickets and damage. See server/README.md.
#
# The game was static-only until multiplayer; single-player still is, and the
# `web` target on its own remains a complete deployment of it.
#
#   docker build --target web    -t hollowmere .
#   docker build --target server -t hollowmere-server .
#   docker run --rm -p 8080:80 hollowmere
#
# Or both together, wired up, with `docker compose up`.

# ---------------------------------------------------------------------------
# Build stage
# ---------------------------------------------------------------------------
FROM node:22-alpine AS build

WORKDIR /app

# Dependencies first, so an edit to src/ doesn't re-run the install layer.
# `npm ci` (not `install`) so the build is pinned to package-lock.json.
COPY package.json package-lock.json ./
RUN npm ci

# Only what the build actually reads. models/ is deliberately absent: the
# rigged GLB is unreferenced since the first-person conversion (see CLAUDE.md),
# so it is neither typechecked against nor bundled, and copying 7 MB of it in
# would only slow the build.
COPY tsconfig.json vite.config.ts vite.server.config.ts index.html main.ts ./
COPY src ./src
COPY server ./server
COPY scripts ./scripts
# textures/ and shots/ are BUNDLED, not served: both are imported with Vite's
# `?url` (`WaterSystem`, `ui/mapShots.ts`), so rollup resolves them out of the
# build context and a directory missing here fails the bundle rather than the
# COPY — with an error that names the importing module and not this file. Any
# future `?url` import from outside src/ owes a line beside these two.
COPY textures ./textures
COPY shots ./shots
# public/ is copied to dist/ verbatim: the web app manifest and the install
# icons, which must keep the exact URLs the manifest and index.html name.
COPY public ./public

# `npm run build` checks the collision bake is current, typechecks BOTH
# tsconfigs and then bundles. The typecheck is the only automated gate this repo
# has, so a type error fails the image build too — and the bake check means a
# layout edit that was never re-baked cannot ship a server whose walls stand
# somewhere else from its clients'.
RUN npm run build
RUN npm run build:server

# ---------------------------------------------------------------------------
# Runtime stage: the match server
# ---------------------------------------------------------------------------
FROM node:22-alpine AS server

WORKDIR /app

# `ws` is the only runtime dependency — everything else, Babylon included, is
# bundled into dist-server by the SSR build.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=build /app/dist-server ./dist-server

ENV PORT=8080
EXPOSE 8080

# Not root: this process listens on a socket and parses whatever arrives on it.
USER node

CMD ["node", "dist-server/index.js"]

# ---------------------------------------------------------------------------
# Runtime stage: the static game
# ---------------------------------------------------------------------------
FROM nginx:1.27-alpine AS web

# A TEMPLATE under /etc/nginx/templates, not a conf under /etc/nginx/conf.d:
# the image's entrypoint substitutes the environment into it and writes the
# result to conf.d before nginx starts. That is what makes MATCH_SERVER a deploy
# -time setting. The .envsh beside it publishes this container's own DNS servers
# for the `resolver` the templated upstream needs; it is sourced, so it must be
# executable, and the chmod is explicit rather than trusted to the checkout.
COPY docker/default.conf.template /etc/nginx/templates/default.conf.template
COPY docker/14-resolvers.envsh /docker-entrypoint.d/14-resolvers.envsh
RUN chmod +x /docker-entrypoint.d/14-resolvers.envsh

COPY --from=build /app/dist /usr/share/nginx/html

# Where the match server is, as host:port. The default is the compose service
# name, so `docker compose up` needs no configuration at all; a deployment that
# runs the two containers some other way sets this to whatever it named the
# server. Nothing is resolved until a request arrives on /ws or /matches, so a
# wrong value here — or no server at all — costs those two paths and not the
# game.
ENV MATCH_SERVER=match-server:8080

EXPOSE 80

# nginx:alpine's own entrypoint/CMD already daemon-off's in the foreground.
