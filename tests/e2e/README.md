# Vimob E2E

These tests seed a local Supabase project with one test organization and three users:

- `admin.e2e@vimob.test` as organization admin
- `lider.e2e@vimob.test` as a team leader
- `usuario.e2e@vimob.test` as a base user with a temporary permission override that is restored in the same test

Before running:

1. Start local Supabase.
2. Copy the E2E values from `supabase status -o env` into `.env.e2e.local`.
   Include `E2E_SUPABASE_JWT_SECRET` when your local Supabase uses HS256 tokens.
3. Run `npm run test:e2e`.

The seed refuses to run against a non-local Supabase URL unless `E2E_ALLOW_REMOTE=true` is set explicitly for an isolated staging project.
