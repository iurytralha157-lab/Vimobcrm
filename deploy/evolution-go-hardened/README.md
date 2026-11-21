# Evolution Go 0.7.3/Vimob

This image pins official Evolution Go [0.7.3](https://github.com/evolution-foundation/evolution-go/releases/tag/0.7.3) at commit `80d7c72c0727e091425d10f5654b7ccf07e01abe`.
The build keeps Vimob's instance startup, handshake discovery, and download bounds patches.

The upstream release pins Whatsmeow to
[`54038813c47f`](https://github.com/tulir/whatsmeow/commit/54038813c47f).
Its Status handler acknowledges incoming WhatsApp Status packets at the protocol
layer. The upstream authentication store reuses the main database pool and bounds
auth schema upgrades with a 60-second deadline. Its schema upgrades from v14 in
the previous Vimob image to v16. Verify the upgrade and rollback on a separate
authentication database before rollout.

The upstream blocklist endpoints return `Items` with `LID`, `PN`, and `Active`
plus `AddressingMode`. The `DHash` field remains available. Verify any clients
using `/user/block`, `/user/unblock`, or `/user/blocklist`.

The handshake-version patch discovers the current version through the pinned
Whatsmeow library's `GetLatestVersion` request to `https://web.whatsapp.com`,
with a 10-second HTTP timeout and the caller's cancellation context. The existing
process-wide initialization mutex applies `store.SetWAVersion` before any
WhatsApp client connects. This updates the actual handshake app version and
build hash, in addition to the device-registration properties. Explicit
`WHATSAPP_VERSION_MAJOR`, `WHATSAPP_VERSION_MINOR`, and
`WHATSAPP_VERSION_PATCH` configuration remains supported. Discovery failures abort
initialization without committing the obsolete library default, so a later
explicit start can retry. The patch includes synthetic regression tests for
the handshake version, automatic discovery, initialization reuse, cancellation,
and recovery after a failed discovery.

The startup patch makes `CONNECT_ON_STARTUP=false` a process-level, fail-closed
barrier instead of only skipping the bulk-start call in `main.go`:

- a fresh process authorizes zero instances;
- lazy message, chat, group, label, and similar operations cannot start a
  WhatsApp client;
- `StartInstance`, `ReconnectClient`, and the final `StartClient` websocket path
  all enforce the same gate;
- each explicit lifecycle request receives a new per-instance authorization
  epoch; a newer request supersedes the older one, and exact cancellation from
  an older request cannot revoke the newer attempt;
- reconnects belonging to the current runtime reuse only that runtime's epoch;
  they cannot grant authorization to a blocked instance;
- setup, websocket connect, and readiness waits are bounded and cancelable;
  readiness is published only after the connected state is persisted;
- runtime publication/removal is generation-safe, while disconnect, logout,
  and delete take a terminal lease that excludes concurrent starts;
- runtime settings are immutable snapshots, so live updates cannot race event
  handlers;
- logout and delete remove the Whatsmeow auth device even when no runtime is
  currently registered;
- proxy changes may reconnect an already authorized instance but never grant a
  blocked one; and
- disconnect, logout, QR timeout, and delete revoke that instance authorization.

Failed starts remove only the client, handler, kill channel, and cache entries
that still belong to that failed generation. A newer runtime is never deleted,
and a disconnected stale pointer cannot suppress a later explicit recovery.

The boot log must contain the startup-gate message when the flag is false. No
session is permitted to start before an explicit lifecycle operation.

The media patches make recovery fail closed:

- it never starts or reconnects an instance while downloading;
- it accepts only an already connected and logged-in client;
- it rejects missing, zero, and declared files above 25 MiB;
- it streams ciphertext through a bounded temporary file, so an incorrect
  declaration cannot force an unbounded in-memory download;
- it caps the request JSON body at 2 MiB and accepts exactly one media payload;
- it normalizes invalid or empty MIME values to `application/octet-stream`;
- it propagates the caller context and enforces a 90-second deadline;
- it reports disconnected clients as HTTP 409 and rejected sizes as HTTP 413.

The 90-second context covers Whatsmeow network requests and retries. The pinned
Whatsmeow dependency uses a non-context-aware mutex while refreshing its media
connection; with `WEBHOOK_FILES=false` and the Vimob single-worker queue there
is no expected competing automatic downloader, but this is not a mathematical
hard deadline if another caller is already holding that mutex.

Keep `WEBHOOK_FILES=false`. Incoming webhooks retain the encrypted media
metadata, while the Vimob API queue decides which files may be recovered.

Builds must run the config, message, instance, user, and Whatsmeow tests plus the
startup-path vet checks. Production must pin the resulting image by immutable
SHA/digest, not `latest`.

All build stages are pinned by digest. The runtime uses Alpine 3.22.1 (matching
the Go builder generation) instead of the upstream 3.19.1 runtime, which is
end-of-life.

The production Swarm service currently replaces its single task stop-first. A
task replacement closes the existing WhatsApp sockets. With
`CONNECT_ON_STARTUP=false`, the new process requires explicit lifecycle
operations for sessions selected for recovery. Capture the connected cohort and
validate reconnection and message delivery with a test account before any
production change. Keep the previous image digest available for rollback.