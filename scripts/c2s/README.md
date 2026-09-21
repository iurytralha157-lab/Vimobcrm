# C2S historical import dry-run

`build-import-manifest.mjs` converts a sealed C2S extraction bundle into a
deterministic, offline import manifest. It does not connect to Supabase, call
the Vimob API, or write outside the new output directory passed to it.

The builder deliberately separates a complete audit manifest from apply
readiness:

- C2S leads whose owner mapping is `UNRESOLVED` are excluded.
- `EXACT`, `EXACT_NORMALIZED`, and the four reviewed `PROPOSED_ALIAS` mappings
  are included.
- Identity is UUIDv5 over `organization_id + ":" + external_key`; phone is
  never an identity key in this manifest.
- Every payload carries `historical_import=true` and
  `notification_policy="suppress_all"`.
- A source status without both an explicit target stage and deal status makes
  the report `HOLD`. No stage is inferred.
- Batches are dry-run-only and require `dry-run-report.json` to be `READY`
  before an independent guarded loader may consume them.

Example:

```powershell
node scripts/c2s/build-import-manifest.mjs `
  --input 'C:\Users\andre\Documents\Vimob\staging\estancia-ouro-verde-c2s-20260921' `
  --output 'outputs\<thread-id>\c2s-import-dry-run' `
  --archived-stage-id '25352e78-0a63-4301-836e-ec37312e6840' `
  --expect-selected 4452 `
  --expect-excluded 485 `
  --expect-events 99134 `
  --expect-chat 6648 `
  --apply-approved-data-quality-policy `
  --validate-estancia-temporal-evidence
```

The approved data-quality policy is opt-in. It keeps a one-character source
name unchanged, assigns `Sem nome (C2S <source_lead_id>)` only when the source
name is empty, and writes an invalid phone as `null`. Every raw value and the
resolution reason remain in payload metadata with `data_quality_warning=true`.
It does not infer a person name or repair a phone number.

Two source chat rows have neither text nor media. They remain part of the
6,648-row history and are represented as `[Mensagem sem conteúdo no C2S]`,
with an empty raw value and `data_quality_warning=true` in metadata. The
builder never silently discards them.

Lifecycle timestamps use a fail-closed evidence hierarchy:

- the latest explicit C2S event matching the authoritative current UI status;
- for won leads, the latest explicit `marcou como negócio fechado` event;
- a primary XLSX row only when its status still matches the current UI status;
- otherwise `null` for stage/outcome timestamps.

The current UI status always wins over a stale XLSX status. Every lead carries
`metadata.timestamp_provenance` for `created_at`, `updated_at`,
`stage_entered_at`, `assigned_at`, `won_at`, and `lost_at`, including raw
source, source field, confidence, inference flag, parse method, and rule.
`updated_at` is the latest factual timestamp observed; it does not manufacture
a closing or archive time.

The output also contains `canary/manifest.json`: one deterministic eligible
lead with a unique normalized phone, preferring `Novo`/`Em negociação` and the
smallest history among candidates that have at least one event and one chat,
plus all of that lead's events and chat records. The canary
report contains technical identifiers, counts, and checksums only.

Use `--snapshot <file>` to reconcile a rerun. The snapshot may be a JSON
array, `{ "records": [...] }`, or NDJSON. Each row requires
`entity_type`, `external_key`, `id` (or `target_id`), and `payload_sha256`
(or `payload`, from which the canonical hash is calculated). Results are:

- `CREATE`: identity is absent.
- `NOOP`: deterministic id and canonical payload hash match.
- `DRIFT`: identity matches but the canonical payload changed.
- `CONFLICT`: identity is ambiguous or bound to a different id.

The CLI emits one summary line containing only counts, blocker codes, paths,
and hashes. Lead fields and historical messages exist only inside the
controlled batch artifacts. The canonical payload hash is SHA-256 over UTF-8
JSON with recursively sorted object keys and no insignificant whitespace.

Focused validation:

```powershell
node --test scripts/c2s/build-import-manifest.test.mjs scripts/c2s/apply-import.test.mjs
```

## Guarded REST apply runner

`apply-import.mjs` is the separate live-write boundary. Building or verifying
the manifest never calls Supabase. The runner refuses to start unless all of
these gates pass:

- the main/canary manifests, reports, batch files, canonical record hashes,
  payload hashes, deterministic UUIDv5 values, and every `READY` marker are
  valid;
- the confirmation is exactly
  `APPLY C2S org=<organization UUID> manifest_sha256=<manifest SHA-256>`;
- the read-only `preflight_historical_lead_import` RPC is ready, its proof hash
  is valid, and every database-contract check is true;
- the first run sees exactly the declared non-C2S baseline. Its technical IDs
  are stored in the PII-free journal; later checks allow append-only growth but
  never removal or collision with deterministic C2S IDs;
- the deterministic canary runs in `lead -> event -> chat` order and is read
  back before any full batch;
- every apply response has matching batch/record hashes and a 33-sink
  `effect_proof` with suppression active, durable marker enforced, and zero
  deltas;
- events and chats are read back from `activities` with the expected rendered
  type/kind, parent lead, and payload hash.

The runner loads `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (or
`SUPABASE_SECRET_KEY`) from `.env.realdb.local`. Secrets and response bodies are
never logged. Network failures, HTTP 429, and HTTP 5xx use bounded exponential
backoff; contract/auth HTTP 4xx responses are never retried. Each attempt has a
timeout. An uncertain RPC attempt may be replayed because deterministic IDs and
the import ledger make it idempotent.

The journal is atomically replaced under an exclusive lock and contains only
technical IDs, counts, hashes, and timestamps. It never stores `external_key`,
names, phones, emails, messages, or other lead fields.

The exact effect proof includes `outbox_messages` and `audit_logs` among its 33
sinks. `ai_outbox_messages` is deliberately excluded because it has no
lead-level correlation key and no producer participates in this import cohort.

The current sealed local candidate is:

- directory:
  `outputs/01a0c36c-c3b3-7a72-9fe7-377ce40ba775/c2s-import-dry-run-final-v4`;
- main manifest SHA-256:
  `96fae2f7fb2efb2aef1b927f3d3c2f135807ccfaa61fd945a5b359a15263cebc`;
- canary manifest SHA-256:
  `d9db23e32fb452e2906535288074e8504b51c6f2e5edc5d23a0282dca2776775`.

Do not run these templates until the reviewed migration is applied and the
operator deliberately supplies an active actor UUID and exact confirmation.
First, apply only the canary:

```powershell
node scripts/c2s/apply-import.mjs --apply `
  --manifest-dir 'outputs\01a0c36c-c3b3-7a72-9fe7-377ce40ba775\c2s-import-dry-run-final-v4' `
  --actor-user-id '<active-user-with-lead_import>' `
  --expect-existing-leads 1 `
  --confirm 'APPLY C2S org=002c6b70-239d-4d32-a270-0dec3fbb6b17 manifest_sha256=96fae2f7fb2efb2aef1b927f3d3c2f135807ccfaa61fd945a5b359a15263cebc' `
  --canary-only
```

After independent canary review, rerun the same command without
`--canary-only`. The same journal resumes idempotently and revalidates every
previously completed batch by readback.
