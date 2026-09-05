# Evolution Go 0.7.2 - Vimob media and auth-pool hardening

This image is built from the immutable upstream Evolution Go `0.7.2` commit
`9337afc47e10b86cc896a6f432240e40fee95dd1` plus narrowly scoped patches for
the Whatsmeow auth store and `POST /message/downloadmedia`.

The auth-pool patch is the corrected upstream fix from
[`f85ea1445373ea142bb12ba0c01dfc85879be212`](https://github.com/evolution-foundation/evolution-go/commit/f85ea1445373ea142bb12ba0c01dfc85879be212)
(follow-up to
[`4cc635dd460f70c36ba83285ecbb34589790572f`](https://github.com/evolution-foundation/evolution-go/commit/4cc635dd460f70c36ba83285ecbb34589790572f)).
It reuses one sqlstore container, caps the Postgres pool at 20 open / 5 idle
connections, expires connections, closes failed initialization attempts, and
memoizes only a successful initialization.

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

Builds must run the message and Whatsmeow service tests and production must pin
the resulting image by immutable SHA/digest, not `latest`.

All build stages are pinned by digest. The runtime uses Alpine 3.22.1 (matching
the Go builder generation) instead of the upstream 3.19.1 runtime, which is
end-of-life.
