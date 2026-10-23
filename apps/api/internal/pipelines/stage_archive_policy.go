package pipelines

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/jackc/pgx/v5"
)

type StageArchiveDependenciesError struct{ Categories []string }

func (err *StageArchiveDependenciesError) Error() string {
	labels := map[string]string{
		"meta_forms":         "formulários Meta",
		"meta_default":       "destino padrão do Meta",
		"portals":            "portais",
		"round_robin":        "filas de distribuição",
		"incoming_webhooks":  "webhooks de entrada",
		"whatsapp_rules":     "regras de entrada do WhatsApp",
		"public_api_default": "API pública com destino padrão",
	}
	active := []string{}
	for _, category := range err.Categories {
		if label, ok := labels[category]; ok {
			active = append(active, label)
		}
	}
	if len(active) == 0 {
		active = append(active, "integrações de entrada")
	}
	return "Não é possível arquivar: esta coluna recebe leads de " + strings.Join(active, ", ") + ". Altere o destino ou desative essas entradas antes de arquivar. O histórico foi preservado."
}

func (err *StageArchiveDependenciesError) Unwrap() error { return ErrHasDependencies }

type stageArchiveQueryer interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

type archiveRoutingSnapshot struct {
	Meta    []metaArchiveRoute   `json:"meta"`
	Portals []portalArchiveRoute `json:"portals"`
}

// The caller holds the pipeline and stage locks and has already verified that
// no lead references the stage. History and inactive configurations are not
// blockers. Only persisted active routes and their actual first-stage fallback
// are considered; arbitrary destinations in future API payloads are not stored.
func (repo Repository) ensureStageArchiveRoutingSafe(ctx context.Context, tx stageArchiveQueryer, organizationID, pipelineID, stageID string) error {
	var categories []string
	var metaJSON []byte
	if err := tx.QueryRow(ctx, stageArchiveRoutingSQL, organizationID, pipelineID, stageID).Scan(&categories, &metaJSON); err != nil {
		return err
	}
	var routes archiveRoutingSnapshot
	if err := json.Unmarshal(metaJSON, &routes); err != nil {
		return err
	}
	seen := make(map[string]bool)
	for _, category := range categories {
		seen[category] = true
	}
	for _, route := range routes.Meta {
		if destination, category := metaArchiveDestination(route); destination == stageID && !seen[category] {
			categories = append(categories, category)
			seen[category] = true
		}
	}
	for _, route := range routes.Portals {
		if portalArchiveDestination(route) == stageID && !seen["portals"] {
			categories = append(categories, "portals")
			seen["portals"] = true
		}
	}
	if len(categories) > 0 {
		return &StageArchiveDependenciesError{Categories: categories}
	}
	return repo.ensureStageAutomationReferencesSafe(ctx, tx, organizationID, pipelineID, stageID)
}

const stageArchiveRoutingSQL = `
	with target as (
		select p.id, coalesce((select fallback.id = p.id from public.pipelines fallback
		  where fallback.organization_id = $1::uuid and fallback.is_active = true
		  order by fallback.is_default desc, fallback.position, fallback.created_at, fallback.id limit 1), false) as is_default,
		  coalesce((select s.id = $3::uuid from public.stages s
		    where s.organization_id = $1::uuid and s.pipeline_id = p.id
		      and coalesce(s.is_active, true) = true
		    order by s.position, s.created_at, s.id limit 1), false) as is_first
		from public.pipelines p where p.organization_id = $1::uuid and p.id = $2::uuid
	), queue_targets as (
	  select r.id, r.organization_id, coalesce(r.target_pipeline_id, r.pipeline_id) as pipeline_id,
	    coalesce(r.target_stage_id, case when coalesce(r.rules->>'target_stage_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
	      then (r.rules->>'target_stage_id')::uuid end) as stage_id
	  from public.round_robins r where r.organization_id = $1::uuid and coalesce(r.is_active, true) = true
	), queue_routes as (
	  select q.id, case when q.stage_id is not null then s.pipeline_id else p.id end as pipeline_id,
	    case when q.stage_id is not null then s.id else first_stage.id end as stage_id
	  from queue_targets q
	  left join public.stages s on s.organization_id = q.organization_id and s.id = q.stage_id and coalesce(s.is_active, true) = true
	  left join public.pipelines p on p.organization_id = q.organization_id and p.id = q.pipeline_id and coalesce(p.is_active, true) = true
	  left join lateral (select candidate.id from public.stages candidate
	    where candidate.organization_id = q.organization_id and candidate.pipeline_id = p.id and coalesce(candidate.is_active, true) = true
	    order by candidate.position nulls last, candidate.created_at, candidate.id limit 1) first_stage on true
	), meta_default as (
	  select first_stage.id as stage_id from public.pipelines p
	  left join lateral (select s.id from public.stages s where s.organization_id = $1::uuid and s.pipeline_id = p.id and coalesce(s.is_active, true) = true
	    order by s.position nulls last, s.created_at, s.id limit 1) first_stage on true
	  where p.organization_id = $1::uuid and coalesce(p.is_active, true) = true
	  order by coalesce(p.is_default, false) desc, p.position nulls last, p.created_at, p.id limit 1
	), meta_routes as (
	  select jsonb_build_object(
	    'queue_required', f.round_robin_id is not null, 'queue_available', q.id is not null,
	    'form_stage', fs.id, 'queue_stage', q.stage_id, 'queue_pipeline', q.pipeline_id,
	    'form_pipeline', fp.id, 'form_pipeline_first_stage', fps.id,
	    'integration_stage', integration_stage.id, 'integration_pipeline', ip.id,
	    'integration_pipeline_first_stage', ips.id, 'default_stage', d.stage_id
	  ) as route
	  from public.meta_form_configs f
	  join public.meta_integrations i on i.organization_id = f.organization_id and i.id = f.integration_id and coalesce(i.is_connected, false) = true
	  left join queue_routes q on q.id = f.round_robin_id
	  left join public.stages fs on fs.organization_id = f.organization_id and fs.id = f.stage_id and coalesce(fs.is_active, true) = true
	  left join public.pipelines fp on fp.organization_id = f.organization_id and fp.id = f.pipeline_id and coalesce(fp.is_active, true) = true
	  left join lateral (select s.id from public.stages s where s.organization_id = f.organization_id and s.pipeline_id = fp.id and coalesce(s.is_active, true) = true
	    order by s.position nulls last, s.created_at, s.id limit 1) fps on true
	  left join public.stages integration_stage on integration_stage.organization_id = f.organization_id and integration_stage.id = i.stage_id and coalesce(integration_stage.is_active, true) = true
	  left join public.pipelines ip on ip.organization_id = f.organization_id and ip.id = i.pipeline_id and coalesce(ip.is_active, true) = true
	  left join lateral (select s.id from public.stages s where s.organization_id = f.organization_id and s.pipeline_id = ip.id and coalesce(s.is_active, true) = true
	    order by s.position nulls last, s.created_at, s.id limit 1) ips on true
	  left join meta_default d on true
	  where f.organization_id = $1::uuid and coalesce(f.is_active, true) = true
	), portal_default as (
	  select first_stage.id as stage_id from public.pipelines p
	  left join lateral (select s.id from public.stages s where s.organization_id = $1::uuid and s.pipeline_id = p.id and coalesce(s.is_active, true) = true
	    order by s.position, s.created_at, s.id limit 1) first_stage on true
	  where p.organization_id = $1::uuid and coalesce(p.is_active, true) = true
	  order by p.is_default desc, p.position, p.created_at, p.id limit 1
	), portal_routes as (
	  select jsonb_build_object(
	    'stage', case when stage_pipeline.id is not null then s.id end,
	    'pipeline', case when s.id is not null then stage_pipeline.id else chosen_pipeline.id end,
	    'first_stage', first_stage.id, 'default_stage', d.stage_id
	  ) as route
	  from public.portal_integrations i
	  left join public.round_robins q on q.organization_id = i.organization_id and q.id = i.default_round_robin_id and coalesce(q.is_active, true) = true
	  left join public.stages s on s.organization_id = i.organization_id and s.id = coalesce(i.default_stage_id, q.target_stage_id) and coalesce(s.is_active, true) = true
	  left join public.pipelines stage_pipeline on stage_pipeline.organization_id = i.organization_id and stage_pipeline.id = s.pipeline_id and coalesce(stage_pipeline.is_active, true) = true
	  left join public.pipelines chosen_pipeline on chosen_pipeline.organization_id = i.organization_id and chosen_pipeline.id = coalesce(i.default_pipeline_id, q.target_pipeline_id) and coalesce(chosen_pipeline.is_active, true) = true
	  left join lateral (select candidate.id from public.stages candidate where candidate.organization_id = i.organization_id and candidate.pipeline_id = chosen_pipeline.id and coalesce(candidate.is_active, true) = true
	    order by candidate.position, candidate.created_at, candidate.id limit 1) first_stage on true
	  left join portal_default d on true
	  where i.organization_id = $1::uuid and i.is_active = true
	)
	select array_remove(array[
	  case when exists (
	    select 1 from public.round_robins r cross join target t
	    where r.organization_id = $1::uuid and coalesce(r.is_active, true) = true
	      and (lower(coalesce(r.target_stage_id::text, nullif(r.rules->>'target_stage_id', ''))) = $3::text
	        or (coalesce(r.target_stage_id::text, nullif(r.rules->>'target_stage_id', '')) is null and t.is_first
	          and lower(coalesce(r.target_pipeline_id::text, r.pipeline_id::text, nullif(r.rules->>'target_pipeline_id', ''))) = t.id::text))
	  ) then 'round_robin' end,
	  case when exists (
	    select 1 from public.webhooks_integrations w cross join target t
	    where w.organization_id = $1::uuid and w.is_active = true and w.type = 'incoming'
	      and (w.target_stage_id = $3::uuid or (w.target_stage_id is null and t.is_first
	        and (w.target_pipeline_id = t.id or (w.target_pipeline_id is null and t.is_default))))
	  ) then 'incoming_webhooks' end,
	  case when exists (
	    select 1 from public.whatsapp_inbound_rules w cross join target t
	    where w.organization_id = $1::uuid and w.is_active = true
	      and (w.target_stage_id = $3::uuid or (w.target_stage_id is null and t.is_first
	        and (w.target_pipeline_id = t.id or (w.target_pipeline_id is null and t.is_default))))
	  ) then 'whatsapp_rules' end,
	  case when exists (
	    select 1 from public.organization_api_keys k cross join target t
	    where k.organization_id = $1::uuid and coalesce(k.is_active, false) = true
	      and (k.expires_at is null or k.expires_at > now()) and t.is_default and t.is_first
	      and exists (select 1 from public.organization_modules module
	        where module.organization_id = k.organization_id and lower(trim(module.module_name)) = 'api'
	          and coalesce(module.is_enabled, false) = true)
	  ) then 'public_api_default' end
	]::text[], null), jsonb_build_object('meta', coalesce((select jsonb_agg(route) from meta_routes), '[]'::jsonb), 'portals', coalesce((select jsonb_agg(route) from portal_routes), '[]'::jsonb))
`
