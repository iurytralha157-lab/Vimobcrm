FROM alpine/git:2.49.1@sha256:c0280cf9572316299b08544065d3bf35db65043d5e3963982ec50647d2746e26 AS source

ARG EVOLUTION_GO_COMMIT=80d7c72c0727e091425d10f5654b7ccf07e01abe

RUN git init /src \
    && cd /src \
    && git remote add origin https://github.com/evolution-foundation/evolution-go.git \
    && git fetch --depth 1 origin "${EVOLUTION_GO_COMMIT}" \
    && git checkout --detach FETCH_HEAD \
    && test "$(git rev-parse HEAD)" = "${EVOLUTION_GO_COMMIT}"

COPY deploy/evolution-go-hardened/0.7.2-vimob-media-hardening.patch /tmp/media-hardening.patch
COPY deploy/evolution-go-hardened/0.7.2-vimob-media-bounds.patch /tmp/media-bounds.patch
COPY deploy/evolution-go-hardened/0.7.3-vimob-startup-gate.patch /tmp/startup-gate.patch
COPY deploy/evolution-go-hardened/0.7.3-vimob-handshake-version.patch /tmp/handshake-version.patch
RUN cd /src \
    && git apply --check /tmp/media-hardening.patch \
    && git apply /tmp/media-hardening.patch \
    && git apply --check /tmp/media-bounds.patch \
    && git apply /tmp/media-bounds.patch \
    && git apply --check /tmp/startup-gate.patch \
    && git apply /tmp/startup-gate.patch \
    && git apply --check /tmp/handshake-version.patch \
    && git apply /tmp/handshake-version.patch

FROM golang:1.26.10-alpine@sha256:87c65a688975c0b1d4585d204874c45ca78354670e3a5f11368c5a492303d696 AS build

RUN apk add --no-cache build-base git libjpeg-turbo-dev libwebp-dev

WORKDIR /build
COPY --from=source /src/go.mod /src/go.sum ./
RUN go mod download
COPY --from=source /src/ ./

ARG VERSION=0.7.3-vimob.1
RUN CGO_ENABLED=1 go test ./pkg/config ./pkg/user/service ./pkg/message/service ./pkg/message/handler ./pkg/whatsmeow/service ./pkg/instance/repository ./pkg/instance/service \
    && CGO_ENABLED=1 go vet ./pkg/whatsmeow/service ./pkg/instance/repository ./pkg/instance/service \
    && go mod verify \
    && CGO_ENABLED=1 go build -mod=readonly -ldflags "-X main.version=${VERSION}" -o server ./cmd/evolution-go \
    && go version -m server | grep -F 'v0.0.0-20261102152715-54038813c47f' \
    && go tool nm server | grep -F 'go.mau.fi/whatsmeow.(*Client).handleUnencryptedMessage'

FROM alpine:3.22.1@sha256:4bcff63911fcb4448bd4fdacec207030997caf25e9bea4045fa6c8c44de311d1 AS final

RUN apk add --no-cache tzdata ffmpeg libjpeg-turbo libwebp poppler-utils

WORKDIR /app
COPY --from=build /build/server .
COPY --from=build /build/manager/dist ./manager/dist
COPY --from=build /build/VERSION ./VERSION

ARG EVOLUTION_GO_COMMIT=80d7c72c0727e091425d10f5654b7ccf07e01abe
ARG VERSION=0.7.3-vimob.1
LABEL org.opencontainers.image.title="Vimob Evolution Go" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${EVOLUTION_GO_COMMIT}" \
      org.opencontainers.image.source="https://github.com/evolution-foundation/evolution-go"

ENV TZ=America/Sao_Paulo

ENTRYPOINT ["/app/server"]
