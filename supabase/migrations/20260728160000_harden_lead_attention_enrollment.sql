-- Preserve the operational-attention contract introduced on 2026-07-21:
-- every new lead is enrolled and existing organizations remain protected by
-- the engine's shadow-mode rollout controls.
--
-- Browser roles can create leads through RLS, but the resulting cycle rows
-- are backend-owned. Run the AFTER trigger with its postgres owner's
-- privileges so a valid browser insert can materialize those internal rows.
-- The function body already schema-qualifies every relation; an empty,
-- immutable search_path keeps SECURITY DEFINER name resolution safe.

alter function private.capture_lead_cycles()
  security definer;

alter function private.capture_lead_cycles()
  set search_path = '';

revoke all on function private.capture_lead_cycles()
  from public, anon, authenticated;
