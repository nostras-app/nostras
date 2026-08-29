# Builds both server binaries (relay + DVM) from this one Go module.
# fly.toml's [processes] picks which binary each Fly process group runs
# from this same image — see fly.toml for why they're one image, two
# processes rather than two separate Fly apps.

# DB-IP's free "Lite" country database (CC BY 4.0, no signup/API key
# required) — baked into the image at build time so country-lookup for
# the connection analytics dashboard never depends on a live third-party
# API at runtime (see analytics.go's own comment on the real ipapi.co
# rate-limiting this replaced). A separate stage purely so curl/gzip/
# coreutils never end up in the final runtime image. The filename is
# dated by release month; falls back to last month's file if this
# month's hasn't been published yet (e.g. very early in a new month)
# rather than failing the whole build — coreutils' GNU-compatible `date`
# is needed for the `-d` relative-date fallback, since busybox's own
# `date` doesn't support it.
FROM alpine:3.20 AS geoip
RUN apk add --no-cache curl gzip coreutils
RUN (curl -fsSL -o /tmp/geoip.mmdb.gz "https://download.db-ip.com/free/dbip-country-lite-$(date +%Y-%m).mmdb.gz" \
      || curl -fsSL -o /tmp/geoip.mmdb.gz "https://download.db-ip.com/free/dbip-country-lite-$(date -d '-1 month' +%Y-%m).mmdb.gz") \
    && gunzip -c /tmp/geoip.mmdb.gz > /geoip-country-lite.mmdb

FROM golang:1.26-alpine AS build
WORKDIR /src

# go.mod has a local `replace` directive pointing at internal/khatrufork/
# (see server/internal/khatrufork — a local fork of khatru with a
# broadcast-path performance fix), which needs that directory physically
# present before `go mod download` can resolve it. So the full source has
# to be copied first — this gives up the usual go.mod/go.sum-only caching
# optimization for the dependency-download layer, but this is a small
# project with a fast CI build anyway, and correctness matters more here.
COPY . .
RUN go mod download
RUN CGO_ENABLED=0 go build -o /out/relay .
RUN CGO_ENABLED=0 go build -o /out/dvm ./cmd/dvm

FROM alpine:3.20
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=build /out/relay /app/relay
COPY --from=build /out/dvm /app/dvm
COPY --from=geoip /geoip-country-lite.mmdb /app/geoip-country-lite.mmdb

# Read at runtime via os.Getenv (relay.Info.Version in main.go, and the
# /dashboard/health endpoint) — "dev" by default so a plain `docker build`
# with no --build-arg still works. Declared here (the final runtime
# stage), not the build stage above, since it's only ever read at
# runtime, and Docker ARGs don't cross a FROM boundary anyway.
ARG NOSTRAS_VERSION=dev
ENV NOSTRAS_VERSION=$NOSTRAS_VERSION

# No default CMD/ENTRYPOINT — fly.toml's [processes] supplies the actual
# command per process group (web -> /app/relay, dvm -> /app/dvm).
