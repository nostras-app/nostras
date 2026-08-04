# Builds both server binaries (relay + DVM) from this one Go module.
# fly.toml's [processes] picks which binary each Fly process group runs
# from this same image — see fly.toml for why they're one image, two
# processes rather than two separate Fly apps.

FROM golang:1.26-alpine AS build
WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 go build -o /out/relay .
RUN CGO_ENABLED=0 go build -o /out/dvm ./cmd/dvm

FROM alpine:3.20
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=build /out/relay /app/relay
COPY --from=build /out/dvm /app/dvm

# No default CMD/ENTRYPOINT — fly.toml's [processes] supplies the actual
# command per process group (web -> /app/relay, dvm -> /app/dvm).
