# Builds both server binaries (relay + DVM) from this one Go module.
# fly.toml's [processes] picks which binary each Fly process group runs
# from this same image — see fly.toml for why they're one image, two
# processes rather than two separate Fly apps.

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

# No default CMD/ENTRYPOINT — fly.toml's [processes] supplies the actual
# command per process group (web -> /app/relay, dvm -> /app/dvm).
