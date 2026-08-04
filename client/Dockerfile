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
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=build /src/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
