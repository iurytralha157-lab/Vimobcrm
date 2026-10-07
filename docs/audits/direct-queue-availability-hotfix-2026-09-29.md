# Direct queue availability hotfix — 2026-09-29

## Incident

Lead `057f4338-f6c8-46c8-9307-7938141cd3a7` entered queue
`DM - GUAIANAZES / ITAQUERA - FLP`
(`64db5bf5-0445-4708-b793-290c10af037c`) at 2026-09-30 00:15:54 UTC
(2026-09-29 21:15:54 America/Sao_Paulo) without an assignee. The queue had
four active direct user participants (`round_robin_members.team_id IS NULL`).
Each user also belonged to an unrelated team with Tuesday availability of
08:00–18:00. The live canonical picker wrongly consulted those team schedules
for direct queue participants and returned no candidate. The lead accumulated
`no_available_members` events and a durable initial-distribution retry job.

## Production change

Through the production Supabase SQL Editor, a guarded transaction updated only
`private.pick_round_robin_ticket_candidate` to admit a candidate when
`candidate.team_member_id IS NULL`, before evaluating team schedules. The
transaction asserted the original function hash
`4caeced904740770ae0e53b79feaab82`, made one unique text substitution in
the function definition, and rolled back on any failed assertion. The new
function hash is `cb06547b07f505ac5dabbf2456d45fdb`. Owner `postgres`,
existing execute grant, `SECURITY DEFINER`, volatility and search path were
preserved.

This is an emergency change to the live function, not an application of the
complete forward migration
`supabase/migrations/20260922120632_keep_direct_queue_members_outside_team_schedules.sql`.
That migration already contains the permanent direct-member rule and its
canonical SQL regression in `supabase/tests/distribution_canonical.test.sql`.
It remains to be reconciled when the database migration workflow is restored.
The production database has no `supabase_migrations` ledger; do not represent
this hotfix with `supabase db push` or `migration repair`.

## Readback

- A fresh SQL Editor tab read back the new function hash and direct-member
  predicate. The canonical picker, which had returned no candidate for ticket
  202 at Tuesday 21:15:54, returned a direct user with reason
  `no_team_schedule` after the change.
- A read-only picker probe for tickets 1–8 at Tuesday 21:15:54 returned the four
  direct users in configured order twice: Regina, Thiago, Fernanda, Gabriel,
  then Regina, Thiago, Fernanda, Gabriel. Every result had no team membership
  bound to the queue entry and reason `no_team_schedule`.
- The automatic retry assigned the incident lead at 2026-09-30 00:38:05 UTC,
  distribution ticket 235, to Fernanda Guimaraes Soares. Readback confirmed
  she was an active direct member of the same queue (`team_id IS NULL`).
- The original retry job stopped with `initial_distribution_completed`. The
  lead's `assigned_user_id` matched the `assigned` distribution event. No
  manual lead-owner update or replay was performed.

This readback verifies the observed production incident and the direct-user
picker path. It does not constitute a full pgTAP run or a survey of every
queue's historical distribution fairness.
