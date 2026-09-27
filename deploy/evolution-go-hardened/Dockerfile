FROM alpine/git:2.49.1@sha256:c0280cf9572316299b08544065d3bf35db65043d5e3963982ec50647d2746e26 AS source

ARG EVOLUTION_GO_COMMIT=9337afc47e10b86cc896a6f432240e40fee95dd1

RUN git init /src \
    && cd /src \
    && git remote add origin https://github.com/evolution-foundation/evolution-go.git \
    && git fetch --depth 1 origin "${EVOLUTION_GO_COMMIT}" \
    && git checkout --detach FETCH_HEAD \
    && test "$(git rev-parse HEAD)" = "${EVOLUTION_GO_COMMIT}"

COPY deploy/evolution-go-hardened/0.7.2-vimob-auth-poolfix.patch /tmp/auth-poolfix.patch
COPY deploy/evolution-go-hardened/0.7.2-vimob-media-hardening.patch /tmp/media-hardening.patch
COPY deploy/evolution-go-hardened/0.7.2-vimob-media-bounds.patch /tmp/media-bounds.patch
COPY deploy/evolution-go-hardened/0.7.2-vimob-startup-gate.patch /tmp/startup-gate.patch
COPY deploy/evolution-go-hardened/0.7.2-vimob-calls-contacts.patch /tmp/calls-contacts.patch
COPY deploy/evolution-go-hardened/0.7.2-vimob-canary-license.patch /tmp/canary-license.patch
RUN cd /src \
    && git apply --check /tmp/auth-poolfix.patch \
    && git apply /tmp/auth-poolfix.patch \
    && git apply --check /tmp/media-hardening.patch \
    && git apply /tmp/media-hardening.patch \
    && git apply --check /tmp/media-bounds.patch \
    && git apply /tmp/media-bounds.patch \
    && git apply --check /tmp/startup-gate.patch \
    && git apply /tmp/startup-gate.patch \
    && git apply --check /tmp/calls-contacts.patch \
    && git apply /tmp/calls-contacts.patch \
    && git apply --check /tmp/canary-license.patch \
    && git apply /tmp/canary-license.patch

FROM golang:1.25.0-alpine@sha256:f18a072054848d87a8077455f0ac8a25886f2397f88bfdd222d6fafbb5bba440 AS build

RUN apk add --no-cache build-base git libjpeg-turbo-dev libwebp-dev

WORKDIR /build
COPY --from=source /src/go.mod /src/go.sum ./
COPY --from=source /src/third_party/meowcaller ./third_party/meowcaller
RUN go mod download
COPY --from=source /src/ ./

ARG VERSION=0.7.2-vimob-calls-contacts.2
RUN CGO_ENABLED=1 go test github.com/purpshell/meowcaller/... ./pkg/config ./pkg/middleware ./pkg/message/service ./pkg/message/handler ./pkg/whatsmeow/service ./pkg/instance/repository ./pkg/instance/service ./pkg/call/... ./pkg/contact/... ./pkg/routes ./cmd/evolution-go \
    && CGO_ENABLED=1 go vet ./pkg/whatsmeow/service ./pkg/instance/repository ./pkg/instance/service ./pkg/call/... ./pkg/contact/... \
    && CGO_ENABLED=1 go build -ldflags "-X main.version=${VERSION}" -o server ./cmd/evolution-go

FROM alpine:3.22.1@sha256:4bcff63911fcb4448bd4fdacec207030997caf25e9bea4045fa6c8c44de311d1 AS final

RUN apk add --no-cache tzdata ffmpeg libjpeg-turbo libwebp poppler-utils

WORKDIR /app
COPY --from=build /build/server .
COPY --from=build /build/manager/dist ./manager/dist
COPY --from=build /build/VERSION ./VERSION

ARG EVOLUTION_GO_COMMIT=9337afc47e10b86cc896a6f432240e40fee95dd1
ARG VERSION=0.7.2-vimob-calls-contacts.2
LABEL org.opencontainers.image.title="Vimob Evolution Go" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${EVOLUTION_GO_COMMIT}" \
      org.opencontainers.image.source="https://github.com/evolution-foundation/evolution-go" \
      com.vimob.evolution.auth-poolfix.source="f85ea1445373ea142bb12ba0c01dfc85879be212" \
      com.vimob.evolution.calls.source="ee9c9ab9113625a4904fdde8627cb13f614d1b2c" \
      com.vimob.evolution.canary-license.source="43d0084aef8c28ac8533e7884cf42cfd2afe9b81"

ENV TZ=America/Sao_Paulo

ENTRYPOINT ["/app/server"]
