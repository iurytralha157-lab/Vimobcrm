-- Align legacy ai_agents rows with the backend-managed AI Agents contract.
alter table if exists public.ai_agents
  alter column organization_id drop not null;

alter table if exists public.ai_agents
  add column if not exists description text,
  add column if not exists status text not null default 'draft',
  add column if not exists config jsonb not null default '{}'::jsonb;

do $$
begin
  if to_regclass('public.ai_agents') is not null then
    update public.ai_agents
    set
      status = case
        when coalesce(is_active, false) then 'active'
        else 'draft'
      end,
      description = coalesce(description, 'Agente migrado do formato anterior.'),
      ai_provider = coalesce(ai_provider, 'openai'),
      config = case
        when config is null or config = '{}'::jsonb then jsonb_build_object(
          'type', 'triage',
          'prompt', coalesce(system_prompt, ''),
          'model', 'gpt-4.1-mini',
          'temperature', 0.3,
          'allowedTools', jsonb_build_array('lead_context', 'property_search', 'handoff'),
          'handoffTargets', jsonb_build_array('mcmv', 'high_value', 'launch'),
          'routingKeywords', to_jsonb(coalesce(handoff_keywords, array[]::text[])),
          'isDefault', true
        )
        else config
      end,
      updated_at = now();

    create index if not exists idx_ai_agents_org_status
      on public.ai_agents (organization_id, status);
  end if;
end $$;
