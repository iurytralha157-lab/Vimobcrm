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
        when lower(coalesce(to_jsonb(ai_agents) ->> 'is_active', 'false')) in ('true', 't', '1') then 'active'
        else 'draft'
      end,
      description = coalesce(description, 'Agente migrado do formato anterior.'),
      config = case
        when config is null or config = '{}'::jsonb then jsonb_build_object(
          'type', 'triage',
          'prompt', coalesce(to_jsonb(ai_agents) ->> 'system_prompt', ''),
          'model', 'gpt-4.1-mini',
          'temperature', 0.3,
          'allowedTools', jsonb_build_array('lead_context', 'property_search', 'handoff'),
          'handoffTargets', jsonb_build_array('mcmv', 'high_value', 'launch'),
          'routingKeywords', coalesce(to_jsonb(ai_agents) -> 'handoff_keywords', '[]'::jsonb),
          'isDefault', true
        )
        else config
      end,
      updated_at = now();

    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'ai_agents'
        and column_name = 'ai_provider'
    ) then
      execute $sql$
        update public.ai_agents
        set ai_provider = coalesce(ai_provider, 'openai')
      $sql$;
    end if;

    create index if not exists idx_ai_agents_org_status
      on public.ai_agents (organization_id, status);
  end if;
end $$;
