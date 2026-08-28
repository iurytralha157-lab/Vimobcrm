# Read-only UI walkthrough proxy

This harness places two fail-closed loopback proxies between a local Vimob UI
and explicitly selected HTTPS upstreams. It is intended for manual QA where a
reviewer needs production-like **read paths** without exposing broad mutation
endpoints.

> [!WARNING]
> This is not a staging environment and must not be used as a substitute for
> staging, release tests, backups, or database isolation. A `GET` endpoint can
> still be incorrectly implemented with side effects upstream. Prefer staging;
> use this harness only for a deliberate, supervised walkthrough.

The harness never runs SQL, migrations, workers, cron jobs, or the Go API. It
does not contain or request API keys. Any browser credentials pass through in
memory to the configured HTTPS origin and are never written to its audit log.

## Policy

| Proxy | Allowed | Blocked |
| --- | --- | --- |
| Vimob API | `GET`, `HEAD`, `OPTIONS` on any path | Every other method; WebSocket upgrades |
| Supabase | `GET`, `HEAD`, `OPTIONS` on any path | Every other method and WebSocket upgrades, except the auth exchange below |
| Supabase Auth exception | `POST /auth/v1/token?grant_type=password` and `POST /auth/v1/token?grant_type=refresh_token` | Other paths, grants, duplicate grants, or extra query parameters |

The narrow Auth exception is required for password sign-in and session refresh.
It is **not literally read-only**: Supabase may create/rotate a session and
update authentication metadata such as the last sign-in time. Do not log in
unless that limited effect is explicitly acceptable. Supabase documents the
password and refresh exchanges in its [Auth HTTP reference](https://supabase.com/docs/reference/self-hosting-auth/refreshes-a-users-refresh-token).

Additional fences:

- both listeners bind only to `127.0.0.1`;
- browser `Origin` values must exactly match a configured HTTP loopback origin;
- upstream targets must be credential-free HTTPS origins without a path/query;
- cross-origin upstream redirects and every WebSocket upgrade are blocked;
- the Auth request body is capped at 64 KiB;
- startup requires an explicit `--acknowledge-upstream-read-risk` flag;
- CORS responses expose only the local origin that made the request.

## Start

Use placeholders or environment-specific domains. Never paste a service-role
key, JWT, password, access token, refresh token, or database URL into this
command.

```powershell
node .\scripts\qa\read-only-proxy.mjs `
  --api-target https://api.example.invalid `
  --supabase-target https://project-ref.supabase.co `
  --web-origin http://localhost:3000 `
  --api-port 8081 `
  --supabase-port 8082 `
  --log-file "$env:TEMP\vimob-read-only-proxy.ndjson" `
  --acknowledge-upstream-read-risk
```

Keep it in the foreground so the active safety boundary is visible. A safe
startup emits one NDJSON event per listener with only the proxy name and local
port. It intentionally does not print upstream URLs.

In a second terminal, point only the local web process at the loopback proxies:

```powershell
$env:NEXT_PUBLIC_VIMOB_API_URL = "http://127.0.0.1:8081"
$env:VIMOB_API_URL = "http://127.0.0.1:8081"
$env:NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:8082"
npm run dev
```

Use only a publishable/anonymous Supabase key from the normal local QA
environment. Never expose a Supabase secret or `service_role` key to the Next.js
client. Do not start the local Go API, background workers, reconcilers, or cron
processes for this walkthrough.

Repeat `--web-origin` when the browser may use another loopback spelling or
port, for example `http://127.0.0.1:3000`. Run `node
scripts/qa/read-only-proxy.mjs --help` to list all options; help mode does not
open listeners.

## Stop

1. Stop the Next.js process in its terminal with `Ctrl+C`.
2. Stop the proxy harness with `Ctrl+C` in the harness terminal.
3. Confirm that the chosen local ports are no longer listening before starting
   another QA session.
4. Delete the temporary NDJSON log when the review evidence is no longer
   needed. The log has no credentials, but normal QA retention rules still
   apply.

Do not kill processes by a broad name such as `node`; other local work may be
using Node.js. Stop the exact foreground processes you started.

## Audit log contract

Only blocked requests and safe lifecycle failures are logged. A blocked request
has exactly these fields:

```json
{"timestamp":"...","event":"blocked_request","proxy":"supabase","method":"POST","route":"redacted","reason":"auth_token_path_mismatch"}
```

The schema never includes raw paths, query strings, headers, cookies, request or
response bodies, e-mail addresses, API keys, access tokens, or refresh tokens.
The one safe route label, `supabase_auth_token`, identifies the fixed endpoint
without recording its query.

## Verify without contacting an upstream

The unit tests import only the pure policy and audit helpers. They do not call
`startHarness`, bind a port, or make a network request.

```powershell
node --test .\scripts\qa\read-only-proxy.test.mjs
npx eslint .\scripts\qa\read-only-proxy.mjs .\scripts\qa\read-only-proxy.test.mjs
```

The tests cover method and path allowlists, the two exact Supabase Auth grants,
origin validation, WebSocket denial, explicit startup acknowledgement, and the
absence of query/header/body/token values in serialized audit events.

## Release smoke without credentials

`release-readonly-smoke.mjs` checks the public Web/API contracts and the
anonymous authentication boundary of every protected route listed in the
canonical CRM inventory. It sends only `GET`, never follows redirects and never
sends cookies, authorization headers or request bodies. A remote origin is
rejected unless the operator explicitly acknowledges the upstream read risk.

Use `--summary` in CI or handoffs so successful request details are omitted:

```powershell
node .\scripts\qa\release-readonly-smoke.mjs `
  --web-origin https://app.example.invalid `
  --api-origin https://api.example.invalid `
  --acknowledge-upstream-read-risk `
  --summary
```

After publishing an immutable release candidate, bind both artifacts to the
same full commit SHA. The smoke then requires that SHA in the Web response
header and in the API health/readiness payloads:

```powershell
node .\scripts\qa\release-readonly-smoke.mjs `
  --web-origin https://staging-app.example.invalid `
  --api-origin https://staging-api.example.invalid `
  --expected-release-sha 0123456789abcdef0123456789abcdef01234567 `
  --acknowledge-upstream-read-risk `
  --summary
```

This smoke proves route existence, basic anonymous access boundaries and
artifact identity. It does not prove page rendering, authorization by persona,
forms, overlays or integrations.

```powershell
node --test .\scripts\qa\release-readonly-smoke.test.mjs
npx eslint .\scripts\qa\release-readonly-smoke.mjs .\scripts\qa\release-readonly-smoke.test.mjs
```

## Maintenance note

Supabase changes over time. Before changing the Auth exception, review the
[Supabase changelog](https://supabase.com/changelog?types=breaking-change) and
current [Auth documentation](https://supabase.com/docs/guides/auth). Do not
broaden the POST allowlist merely to make a UI flow pass; add staging coverage or
redesign the walkthrough instead.

---

# QA persona cleanup executor

`qa-persona-cleanup.mjs` is the destructive, server-only counterpart to the
persona release harness documented in
`docs/audits/qa-persona-release-harness.md`. Do **not** run it merely to inspect
the UI. It is only for an already-approved disposable tenant whose ledger has
one `VIMOB-QA-...` organization and exactly the `admin`, `leader`, and `user`
identities created for that run.

The executor has three independent operator fences:

- exact `--confirm-run-label`;
- exact `--confirm-organization-id`;
- `--acknowledge-permanent-auth-deletion`.

API and Supabase origins are required explicitly. The superadmin token and
Supabase server secret are accepted only through
`QA_SUPERADMIN_ACCESS_TOKEN` and `QA_SUPABASE_SECRET_KEY`; there are no secret
CLI flags and no `.env` loader. The ledger should be stored outside the
repository. Audit events omit URLs, UUIDs, labels, e-mails, request/response
bodies, headers, tokens, secrets, and passwords.

It first validates superadmin authority, requires exactly the three ledger
users in the tenant, and binds all targets in both systems.
It then calls the official organization DELETE with `confirmation_name`,
requires `deleted_users: 0` and no cleanup warnings, proves the organization is
absent, deletes only the three ledger UUIDs through Auth Admin, and proves the
three Auth and CRM records are absent. Any divergence fails closed.

`--resume-cleanup` is an extra acknowledgement for a prior partial run; without
it, an initially missing tenant or Auth identity aborts. It does not relax UUID
or e-mail binding for any identity that still exists.

The local tests replace `fetch` with an in-memory HTTP mock. Running them opens
no listener and contacts no upstream:

```powershell
node --test .\scripts\qa\qa-persona-cleanup.test.mjs
npx eslint .\scripts\qa\qa-persona-cleanup.mjs .\scripts\qa\qa-persona-cleanup.test.mjs
```
