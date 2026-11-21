package automations

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func (repo Repository) Create(ctx context.Context, tenantContext tenant.Context, input CreateInput) (Automation, error) {
	if !canManageAutomations(tenantContext) {
		return Automation{}, tenant.ErrOrganizationAccessDenied
	}
	if input.ParsedFlow != nil {
		if err := repo.validateFlowMediaObjects(ctx, tenantContext.OrganizationID, *input.ParsedFlow); err != nil {
			return Automation{}, err
		}
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return Automation{}, err
	}
	defer tx.Rollback(ctx)
	if input.ParsedFlow != nil {
		if err := lockFlowMediaPaths(ctx, tx, tenantContext.OrganizationID, *input.ParsedFlow); err != nil {
			return Automation{}, err
		}
		if err := repo.validateFlowMediaObjects(ctx, tenantContext.OrganizationID, *input.ParsedFlow); err != nil {
			return Automation{}, err
		}
		if err := validateFlowReferences(ctx, tx, tenantContext, *input.ParsedFlow); err != nil {
			return Automation{}, err
		}
	}

	automation, err := scanAutomation(tx.QueryRow(ctx, `
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
	`, tenantContext.OrganizationID, input.Name, input.Description, input.TriggerType, string(input.TriggerConfig), string(input.FlowDefinition), tenantContext.UserID))
	if err != nil {
		return Automation{}, err
	}

	if input.ParsedFlow == nil {
		_, err = tx.Exec(ctx, `
			insert into public.automation_nodes (
				automation_id,
				node_type,
				node_config,
				position_x,
				position_y
			)
			values ($1::uuid, 'trigger', $2::jsonb, 250, 50)
		`, automation.ID, string(input.TriggerConfig))
		if err != nil {
			return Automation{}, err
		}
	} else {
		idMap := make(map[string]string, len(input.ParsedFlow.Nodes))
		for _, node := range input.ParsedFlow.Nodes {
			var nodeID string
			if err := tx.QueryRow(ctx, `
				insert into public.automation_nodes (
					automation_id, node_type, action_type, node_config, position_x, position_y
				) values ($1::uuid, $2, $3, $4::jsonb, $5, $6)
				returning id::text
			`, automation.ID, node.Type, node.ActionType, string(node.Config), node.Position.X, node.Position.Y).Scan(&nodeID); err != nil {
				return Automation{}, err
			}
			idMap[node.ID] = nodeID
		}
		for _, connection := range input.ParsedFlow.Connections {
			sourceID := idMap[connection.Source]
			targetID := idMap[connection.Target]
			if sourceID == "" || targetID == "" {
				return Automation{}, ErrAutomationMisconfigured
			}
			if _, err := tx.Exec(ctx, `
				insert into public.automation_connections (
					automation_id, source_node_id, target_node_id, source_handle, condition_branch
				) values ($1::uuid, $2::uuid, $3::uuid, $4, coalesce($5, 'default'))
			`, automation.ID, sourceID, targetID, connection.SourceHandle, connection.ConditionBranch); err != nil {
				return Automation{}, err
			}
		}

		_, _, firstNodeKey := publishedFlowMetadata(*input.ParsedFlow)
		checksum := fmt.Sprintf("%x", sha256.Sum256(input.FlowDefinition))
		var versionID string
		if err := tx.QueryRow(ctx, `
			insert into public.automation_flow_versions (
				automation_id, organization_id, version, trigger_type, trigger_config,
				graph, graph_checksum, first_node_key, created_by, published_at
			) values (
				$1::uuid, $2::uuid, 1, $3, $4::jsonb, $5::jsonb, $6, $7, $8::uuid, now()
			) returning id::text
		`, automation.ID, tenantContext.OrganizationID, input.TriggerType, string(input.TriggerConfig), string(input.FlowDefinition), checksum, firstNodeKey, tenantContext.UserID).Scan(&versionID); err != nil {
			return Automation{}, err
		}
		if _, err := tx.Exec(ctx, `
			update public.automations
			set active_flow_version_id = $3::uuid,
			    is_active = $4,
			    updated_at = now()
			where organization_id = $1::uuid and id = $2::uuid
		`, tenantContext.OrganizationID, automation.ID, versionID, input.IsActive); err != nil {
			return Automation{}, err
		}
		automation, err = scanAutomation(tx.QueryRow(ctx, `
			select `+automationSelectFields()+`
			from public.automations
			where organization_id = $1::uuid and id = $2::uuid
		`, tenantContext.OrganizationID, automation.ID))
		if err != nil {
			return Automation{}, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return Automation{}, err
	}

	return automation, nil
}

func (repo Repository) Update(ctx context.Context, tenantContext tenant.Context, automationID string, input UpdateInput) (Automation, error) {
	if !canManageAutomations(tenantContext) {
		return Automation{}, tenant.ErrOrganizationAccessDenied
	}

	current, err := repo.Get(ctx, tenantContext, automationID)
	if err != nil {
		return Automation{}, err
	}

	name := current.Name
	description := current.Description
	isActive := current.IsActive
	triggerType := current.TriggerType
	triggerConfig := current.TriggerConfig
	flowDefinition := current.FlowDefinition
	expectedFlowVersionID := ""
	var activationFlow *FlowDefinition

	if input.Name != nil {
		name = *input.Name
	}
	if input.DescriptionSet {
		description = input.Description
	}
	if input.IsActive != nil {
		if *input.IsActive {
			var graphRaw string
			if err := repo.db.Pool().QueryRow(ctx, `
				select fv.id::text, fv.graph::text
				from public.automations a
				join public.automation_flow_versions fv on fv.id = a.active_flow_version_id
				where a.organization_id = $1::uuid
				  and a.id = $2::uuid
				  and a.deleted_at is null
				  and fv.requires_review = false
			`, tenantContext.OrganizationID, current.ID).Scan(&expectedFlowVersionID, &graphRaw); errors.Is(err, pgx.ErrNoRows) {
				return Automation{}, ErrAutomationMisconfigured
			} else if err != nil {
				return Automation{}, err
			}
			var parsedActivationFlow FlowDefinition
			if err := json.Unmarshal([]byte(graphRaw), &parsedActivationFlow); err != nil {
				return Automation{}, ErrAutomationMisconfigured
			}
			if err := validateFlowDefinition(&parsedActivationFlow); err != nil {
				return Automation{}, err
			}
			activationFlow = &parsedActivationFlow
		}
		isActive = *input.IsActive
	}
	if input.TriggerType != nil {
		triggerType = *input.TriggerType
	}
	if input.TriggerConfig != nil {
		triggerConfig = *input.TriggerConfig
	}
	if input.FlowDefinition != nil {
		flowDefinition = *input.FlowDefinition
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return Automation{}, err
	}
	defer tx.Rollback(ctx)
	var lockedFlowVersionID string
	if err := tx.QueryRow(ctx, `
		select coalesce(active_flow_version_id::text, '')
		from public.automations
		where organization_id = $1::uuid
		  and id = $2::uuid
		  and deleted_at is null
		for update
	`, tenantContext.OrganizationID, current.ID).Scan(&lockedFlowVersionID); errors.Is(err, pgx.ErrNoRows) {
		return Automation{}, ErrAutomationNotFound
	} else if err != nil {
		return Automation{}, err
	}
	if expectedFlowVersionID != "" && lockedFlowVersionID != expectedFlowVersionID {
		return Automation{}, ErrAutomationMisconfigured
	}
	if activationFlow != nil {
		if err := lockFlowMediaPaths(ctx, tx, tenantContext.OrganizationID, *activationFlow); err != nil {
			return Automation{}, err
		}
		if err := repo.validateFlowMediaObjects(ctx, tenantContext.OrganizationID, *activationFlow); err != nil {
			return Automation{}, err
		}
		if err := validateFlowReferences(ctx, tx, tenantContext, *activationFlow); err != nil {
			return Automation{}, err
		}
	}

	updated, err := scanAutomation(tx.QueryRow(ctx, `
		update public.automations
		set name = $3,
		    description = $4,
		    is_active = $5,
		    trigger_type = $6,
		    trigger_config = $7::jsonb,
		    flow_definition = $8::jsonb,
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
		  and deleted_at is null
		  and (nullif($9, '') is null or active_flow_version_id = nullif($9, '')::uuid)
		returning `+automationSelectFields()+`
	`, tenantContext.OrganizationID, current.ID, name, description, isActive, triggerType, string(triggerConfig), string(flowDefinition), expectedFlowVersionID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Automation{}, ErrAutomationNotFound
	}
	if err != nil {
		return Automation{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Automation{}, err
	}

	return updated, nil
}

func (repo Repository) Delete(ctx context.Context, tenantContext tenant.Context, automationID string) error {
	if !canManageAutomations(tenantContext) {
		return tenant.ErrOrganizationAccessDenied
	}

	automationID, ok := normalizeUUID(automationID)
	if !ok {
		return ErrInvalidInput
	}

	tag, err := repo.db.Pool().Exec(ctx, `
		update public.automations a
		set is_active = false,
		    deleted_at = now(),
		    updated_at = now()
		where a.organization_id = $1::uuid
		  and a.id = $2::uuid
		  and a.deleted_at is null
		  and not exists (
		    select 1
		    from public.automation_executions ae
		    where ae.automation_id = a.id
		      and ae.status in ('queued', 'running', 'waiting')
		  )
	`, tenantContext.OrganizationID, automationID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		var exists bool
		if err := repo.db.Pool().QueryRow(ctx, `
			select exists (
				select 1 from public.automations
				where organization_id = $1::uuid and id = $2::uuid and deleted_at is null
			)
		`, tenantContext.OrganizationID, automationID).Scan(&exists); err != nil {
			return err
		}
		if exists {
			return ErrFlowInUse
		}
		return ErrAutomationNotFound
	}

	return nil
}
