# Builds the Vite SPA, then serves the static output via nginx. Separate
# Fly app from the relay/DVM (server/Dockerfile + server/fly.toml) since
# this has nothing in common build- or runtime-wise — a static site, not
# a Go service with persistent WebSocket connections.

FROM node:24-alpine AS build
WORKDIR /src

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
# Baked in at build time — Vite inlines import.meta.env.VITE_* into the
# bundle, it's not a runtime-configurable value. Defaults to the deployed
# relay so a plain `docker build` with no --build-arg still points
# somewhere real rather than localhost.
ARG VITE_RELAY_URL=wss://nostras.app
ENV VITE_RELAY_URL=$VITE_RELAY_URL
# Public VAPID key for Web Push (server/push_notify.go holds the matching
# private key as a Fly secret on the relay app) — not secret itself, safe
# to bake in as a build default the same way VITE_RELAY_URL is.
ARG VITE_VAPID_PUBLIC_KEY=BHRo4BwtsKdfnbQlUdQdW2hoJkSVqlsmS7ea_ALUPGqBfFZ4XDZY-9TfF9cyCZbr5Sb9yL2tzPbWvQq3o1H_p3U
ENV VITE_VAPID_PUBLIC_KEY=$VITE_VAPID_PUBLIC_KEY
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=build /src/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
