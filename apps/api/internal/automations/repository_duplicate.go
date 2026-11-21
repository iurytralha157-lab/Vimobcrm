package automations

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func (repo Repository) Duplicate(ctx context.Context, tenantContext tenant.Context, automationID string) (Automation, error) {
	if !canManageAutomations(tenantContext) {
		return Automation{}, tenant.ErrOrganizationAccessDenied
	}

	source, err := repo.Get(ctx, tenantContext, automationID)
	if err != nil {
		return Automation{}, err
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return Automation{}, err
	}
	defer tx.Rollback(ctx)

	copyName := source.Name + " (copia)"
	created, err := scanAutomation(tx.QueryRow(ctx, `
		insert into public.automations (
			organization_id,
			name,
			description,
			trigger_type,
			trigger_config,
			flow_definition,
			created_by,
			is_active
		)
		values ($1::uuid, $2, $3, $4, $5::jsonb, $6::jsonb, $7::uuid, false)
		returning `+automationSelectFields()+`
	`, tenantContext.OrganizationID, copyName, source.Description, source.TriggerType, string(source.TriggerConfig), string(source.FlowDefinition), tenantContext.UserID))
	if err != nil {
		return Automation{}, err
	}

	idMap := map[string]string{}
	for _, node := range source.Nodes {
		var newID string
		if err := tx.QueryRow(ctx, `
			insert into public.automation_nodes (
				automation_id,
				node_type,
				action_type,
				node_config,
				position_x,
				position_y
			)
			values ($1::uuid, $2, $3, $4::jsonb, $5, $6)
			returning id::text
		`, created.ID, node.NodeType, node.ActionType, string(node.Config), node.PositionX, node.PositionY).Scan(&newID); err != nil {
			return Automation{}, err
		}
		idMap[node.ID] = newID
	}

	for _, connection := range source.Connections {
		sourceID := idMap[connection.SourceNodeID]
		targetID := idMap[connection.TargetNodeID]
		if sourceID == "" || targetID == "" {
			continue
		}
		if _, err := tx.Exec(ctx, `
			insert into public.automation_connections (
				automation_id,
				source_node_id,
				target_node_id,
				source_handle,
				condition_branch
			)
			values ($1::uuid, $2::uuid, $3::uuid, $4, coalesce($5, 'default'))
		`, created.ID, sourceID, targetID, connection.SourceHandle, connection.ConditionBranch); err != nil {
			return Automation{}, err
		}
	}

	var copiedVersionID string
	err = tx.QueryRow(ctx, `
		insert into public.automation_flow_versions (
			automation_id,
			organization_id,
			version,
			trigger_type,
			trigger_config,
			graph,
			graph_checksum,
			first_node_key,
			created_by,
			published_at
		)
		select
			$1::uuid,
			$2::uuid,
			1,
			fv.trigger_type,
			fv.trigger_config,
			fv.graph,
			fv.graph_checksum,
			fv.first_node_key,
			$3::uuid,
			now()
		from public.automations a
		join public.automation_flow_versions fv on fv.id = a.active_flow_version_id
		where a.id = $4::uuid
		  and a.organization_id = $2::uuid
		returning id::text
	`, created.ID, tenantContext.OrganizationID, tenantContext.UserID, source.ID).Scan(&copiedVersionID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return Automation{}, err
	}
	if copiedVersionID != "" {
		if _, err := tx.Exec(ctx, `
			update public.automations
			set active_flow_version_id = $3::uuid,
			    updated_at = now()
			where organization_id = $1::uuid and id = $2::uuid
		`, tenantContext.OrganizationID, created.ID, copiedVersionID); err != nil {
			return Automation{}, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return Automation{}, err
	}

	return created, nil
}
