# Vimob E2E

These tests seed a local Supabase project with one test organization and three users:

- `admin.e2e@vimob.test` as organization admin
- `lider.e2e@vimob.test` as a team leader
- `usuario.e2e@vimob.test` as a base user with a temporary permission override that is restored in the same test

Before running locally:

1. Start local Supabase.
2. Run `npm run test:e2e`.

The harness reads the current local Supabase status at runtime, refreshes the
local anon/service credentials in memory, and starts dedicated servers on
`127.0.0.1:3100` and `127.0.0.1:8181`. It never reuses an existing listener on
those ports. Supabase and PostgreSQL are both validated as loopback targets
before any Auth or SQL mutation.

Use `.env.e2e.local` only to override ports or to configure an explicitly
isolated staging environment. Local credentials do not need to be copied into
the file.

The seed refuses to run against a non-local Supabase URL unless both
`E2E_ALLOW_REMOTE=true` and
`E2E_REMOTE_CONFIRMATION=isolated-staging-only` are set explicitly for an
isolated staging project. The parsed database and Supabase hosts must also
exactly match `E2E_REMOTE_DATABASE_HOST` and `E2E_REMOTE_SUPABASE_HOST`. Known
production Web, API, Supabase and PostgreSQL hosts are rejected even when all
opt-ins are present. Never configure these variables in production.

Release-critical coverage includes:

- dedicated team create/edit pages, atomic seven-day schedules, role boundaries
  and mobile overflow;
- the property list, quick view, history dialog and dedicated 360 workspace on
  admin, leader and user profiles;
- the notification center on all three profiles and a cadence lifecycle
  assertion proving that moving/completing cadence work creates no cadence
  notification;
- the existing permission, navigation, lead, automation, attention, cadence and
  property-form lifecycle suites.

Test discovery without a live environment can use clearly fake remote targets
and skip the servers; global setup is not executed by `--list`:

```powershell
$env:E2E_ALLOW_REMOTE = 'true'
$env:E2E_REMOTE_CONFIRMATION = 'isolated-staging-only'
$env:E2E_BASE_URL = 'https://app.qa.invalid'
$env:E2E_VIMOB_API_URL = 'https://api.qa.invalid'
$env:E2E_SUPABASE_URL = 'https://supabase.qa.invalid'
$env:E2E_DATABASE_URL = 'postgresql://qa:qa@db.qa.invalid/postgres'
$env:E2E_REMOTE_SUPABASE_HOST = 'supabase.qa.invalid'
$env:E2E_REMOTE_DATABASE_HOST = 'db.qa.invalid'
$env:E2E_SUPABASE_ANON_KEY = 'discovery-only'
$env:E2E_SUPABASE_SERVICE_ROLE_KEY = 'discovery-only'
$env:E2E_SKIP_WEB_SERVER = 'true'
npx playwright test --list
```
