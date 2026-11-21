package automations

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/roundrobin"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func (repo Repository) SaveFlow(ctx context.Context, tenantContext tenant.Context, automationID string, input SaveFlowInput) ([]AutomationNode, error) {
	if !canManageAutomations(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}

	automationID, ok := normalizeUUID(automationID)
	if !ok {
		return nil, ErrInvalidInput
	}
	if err := repo.validateFlowMediaObjects(ctx, tenantContext.OrganizationID, input.FlowDefinition); err != nil {
		return nil, err
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var currentCreatedBy string
	if err := tx.QueryRow(ctx, `
		select coalesce(created_by::text, '')
		from public.automations
		where organization_id = $1::uuid
		  and id = $2::uuid
		for update
	`, tenantContext.OrganizationID, automationID).Scan(&currentCreatedBy); errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrAutomationNotFound
	} else if err != nil {
		return nil, err
	}

	var legacyActiveExecutions int
	if err := tx.QueryRow(ctx, `
		select count(*)
		from public.automation_executions
		where organization_id = $1::uuid
		  and automation_id = $2::uuid
		  and flow_version_id is null
		  and status in ('queued', 'running', 'waiting')
	`, tenantContext.OrganizationID, automationID).Scan(&legacyActiveExecutions); err != nil {
		return nil, err
	}
	if legacyActiveExecutions > 0 {
		return nil, ErrFlowInUse
	}
	if err := lockFlowMediaPaths(ctx, tx, tenantContext.OrganizationID, input.FlowDefinition); err != nil {
		return nil, err
	}
	if err := repo.validateFlowMediaObjects(ctx, tenantContext.OrganizationID, input.FlowDefinition); err != nil {
		return nil, err
	}
	if err := validateFlowReferences(ctx, tx, tenantContext, input.FlowDefinition); err != nil {
		return nil, err
	}

	if _, err := tx.Exec(ctx, `delete from public.automation_connections where automation_id = $1::uuid`, automationID); err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `delete from public.automation_nodes where automation_id = $1::uuid`, automationID); err != nil {
		return nil, err
	}

	idMap := map[string]string{}
	inserted := []AutomationNode{}
	for _, node := range input.FlowDefinition.Nodes {
		config := node.Config
		if len(config) == 0 || string(config) == "null" {
			config = json.RawMessage(`{}`)
		}
		nodeType := node.Type
		if nodeType == "" {
			nodeType = "action"
		}

		insertedNode, err := scanAutomationNode(tx.QueryRow(ctx, `
			insert into public.automation_nodes (
				automation_id,
				node_type,
				action_type,
				node_config,
				position_x,
				position_y
			)
			values ($1::uuid, $2, $3, $4::jsonb, $5, $6)
			returning `+automationNodeSelectFields()+`
		`, automationID, nodeType, node.ActionType, string(config), node.Position.X, node.Position.Y))
		if err != nil {
			return nil, err
		}
		idMap[node.ID] = insertedNode.ID
		inserted = append(inserted, insertedNode)
	}

	for _, connection := range input.FlowDefinition.Connections {
		sourceID := idMap[connection.Source]
		targetID := idMap[connection.Target]
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
		`, automationID, sourceID, targetID, connection.SourceHandle, connection.ConditionBranch); err != nil {
			return nil, err
		}
	}

	triggerType, triggerConfig, firstNodeKey := publishedFlowMetadata(input.FlowDefinition)
	checksum := fmt.Sprintf("%x", sha256.Sum256(input.Raw))
	createdBy := tenantContext.UserID
	if createdBy == "" {
		createdBy = currentCreatedBy
	}

	var versionID string
	if err := tx.QueryRow(ctx, `
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
			coalesce(max(version), 0) + 1,
			$3,
			$4::jsonb,
			$5::jsonb,
			$6,
			$7,
			nullif($8, '')::uuid,
			now()
		from public.automation_flow_versions
		where automation_id = $1::uuid
		returning id::text
	`, automationID, tenantContext.OrganizationID, triggerType, string(triggerConfig), string(input.Raw), checksum, firstNodeKey, createdBy).Scan(&versionID); err != nil {
		return nil, err
	}

	tag, err := tx.Exec(ctx, `
		update public.automations
		set flow_definition = $3::jsonb,
		    trigger_type = $4,
		    trigger_config = $5::jsonb,
		    active_flow_version_id = $6::uuid,
		    name = coalesce($7, name),
		    description = coalesce($8, description),
		    is_active = coalesce($9, is_active),
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, tenantContext.OrganizationID, automationID, string(input.Raw), triggerType, string(triggerConfig), versionID, input.Name, input.Description, input.IsActive)
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrAutomationNotFound
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	return inserted, nil
}

func publishedFlowMetadata(flow FlowDefinition) (string, json.RawMessage, string) {
	triggerType := "manual"
	triggerConfig := json.RawMessage(`{}`)
	triggerID := ""
	for _, node := range flow.Nodes {
		if node.Type != "trigger" {
			continue
		}
		triggerID = node.ID
		triggerConfig = node.Config
		var config map[string]any
		if json.Unmarshal(node.Config, &config) == nil {
			if value := stringConfig(config, "trigger_type"); validTriggerType(value) {
				triggerType = value
			}
		}
		break
	}

	firstNodeKey := ""
	for _, connection := range flow.Connections {
		if connection.Source == triggerID {
			firstNodeKey = connection.Target
			break
		}
	}
	return triggerType, triggerConfig, firstNodeKey
}

func validateFlowReferences(ctx context.Context, tx pgx.Tx, actor tenant.Context, flow FlowDefinition) error {
	organizationID := actor.OrganizationID
	for _, node := range flow.Nodes {
		config := flowNodeConfig(node)
		if node.Type == "trigger" {
			if err := validateOptionalOrganizationReference(ctx, tx, organizationID, "lead", stringConfig(config, "target_lead_id")); err != nil {
				return err
			}
			if err := validateOptionalOrganizationReference(ctx, tx, organizationID, "tag", stringConfig(config, "tag_id")); err != nil {
				return err
			}
			if err := validateOptionalOrganizationReference(ctx, tx, organizationID, "session", stringConfig(config, "session_id")); err != nil {
				return err
			}
			filterUserID := stringConfig(config, "filter_user_id")
			if filterUserID != "" && filterUserID != "__me__" {
				if err := validateOptionalOrganizationReference(ctx, tx, organizationID, "user", filterUserID); err != nil {
					return err
				}
			}
			pipelineID := stringConfig(config, "pipeline_id")
			stageID := stringConfig(config, "to_stage_id")
			if pipelineID != "" || stageID != "" {
				if err := validateStageReference(ctx, tx, organizationID, pipelineID, stageID); err != nil {
					return err
				}
			}
			continue
		}
		if node.Type != "action" || node.ActionType == nil {
			continue
		}

		switch *node.ActionType {
		case "send_whatsapp", "send_image", "send_audio", "send_video":
			if err := validateOptionalOrganizationReference(ctx, tx, organizationID, "session", stringConfig(config, "session_id")); err != nil {
				return err
			}
			if *node.ActionType != "send_whatsapp" {
				mediaPath := stringConfig(config, "media_path")
				expectedFolder := map[string]string{
					"send_image": "images", "send_audio": "audios", "send_video": "videos",
				}[*node.ActionType]
				if !strings.HasPrefix(mediaPath, organizationID+"/"+expectedFolder+"/") {
					return invalidFlow("media_path belongs to another organization")
				}
			}
		case "add_tag", "remove_tag":
			if err := validateOptionalOrganizationReference(ctx, tx, organizationID, "tag", stringConfig(config, "tag_id")); err != nil {
				return err
			}
		case "move_lead":
			if err := validateStageReference(ctx, tx, organizationID, stringConfig(config, "pipeline_id"), stringConfig(config, "stage_id")); err != nil {
				return err
			}
		case "assign_user":
			if err := validateOptionalOrganizationReference(ctx, tx, organizationID, "user", stringConfig(config, "user_id")); err != nil {
				return err
			}
		case "distribute_lead":
			if !actor.HasPermission(permissions.LeadOperate) {
				return tenant.ErrOrganizationAccessDenied
			}
			if err := roundrobin.LockActiveQueueForDistribution(ctx, tx, actor, stringConfig(config, "round_robin_id")); errors.Is(err, roundrobin.ErrRoundRobinNotFound) {
				return invalidFlow("distribution queue is unavailable")
			} else if err != nil {
				return err
			}
		case "set_variable":
			if stringConfig(config, "actionType") == "property_interest" {
				if err := validateOptionalOrganizationReference(ctx, tx, organizationID, "property", stringConfig(config, "property_id")); err != nil {
					return err
				}
			}
		}
	}
	return nil
}

func (repo Repository) validateFlowMediaObjects(ctx context.Context, organizationID string, flow FlowDefinition) error {
	for _, node := range flow.Nodes {
		if node.Type != "action" || node.ActionType == nil || !strings.HasPrefix(*node.ActionType, "send_") || *node.ActionType == "send_whatsapp" {
			continue
		}
		config := flowNodeConfig(node)
		path := stringConfig(config, "media_path")
		expectedFolder := map[string]string{
			"send_image": "images", "send_audio": "audios", "send_video": "videos",
		}[*node.ActionType]
		if stringConfig(config, "media_bucket") != automationMediaBucket || !strings.HasPrefix(path, organizationID+"/"+expectedFolder+"/") {
			return invalidFlow("media object belongs to another organization")
		}
		exists, err := repo.storage.exists(ctx, automationMediaBucket, path)
		if err != nil {
			return err
		}
		if !exists {
			return invalidFlow("media object does not exist")
		}
	}
	return nil
}

func lockFlowMediaPaths(ctx context.Context, tx pgx.Tx, organizationID string, flow FlowDefinition) error {
	paths := make([]string, 0)
	seen := map[string]struct{}{}
	for _, node := range flow.Nodes {
		if node.Type != "action" || node.ActionType == nil || !strings.HasPrefix(*node.ActionType, "send_") || *node.ActionType == "send_whatsapp" {
			continue
		}
		path := stringConfig(flowNodeConfig(node), "media_path")
		if path == "" || !strings.HasPrefix(path, organizationID+"/") {
			continue
		}
		if _, exists := seen[path]; exists {
			continue
		}
		seen[path] = struct{}{}
		paths = append(paths, path)
	}
	sort.Strings(paths)
	for _, path := range paths {
		if _, err := tx.Exec(ctx, `
			select pg_catalog.pg_advisory_xact_lock(
				pg_catalog.hashtextextended('automation-media:' || $1, 0)
			)
		`, path); err != nil {
			return err
		}
	}
	return nil
}

func validateOptionalOrganizationReference(ctx context.Context, tx pgx.Tx, organizationID, referenceType, referenceID string) error {
	if referenceID == "" {
		return nil
	}
	var query string
	switch referenceType {
	case "tag":
		query = `select true from public.tags where id = $1::uuid and organization_id = $2::uuid for key share`
	case "session":
		query = `select true from public.whatsapp_sessions
			where id = $1::uuid and organization_id = $2::uuid and status = 'connected'
			  and coalesce(is_active, true) and coalesce(provider, 'evolution_go') = 'evolution_go'
			for key share`
	case "property":
		query = `select true from public.properties where id = $1::uuid and organization_id = $2::uuid for key share`
	case "lead":
		query = `select true from public.leads where id = $1::uuid and organization_id = $2::uuid for key share`
	case "user":
		query = `select true
			from public.organization_members member
			join public.users app_user on app_user.id = member.user_id
			where member.user_id = $1::uuid and member.organization_id = $2::uuid
			  and coalesce(member.is_active, false) and coalesce(app_user.is_active, false)
			for key share of member, app_user`
	default:
		return ErrInvalidInput
	}
	var exists bool
	if err := tx.QueryRow(ctx, query, referenceID, organizationID).Scan(&exists); errors.Is(err, pgx.ErrNoRows) {
		return invalidFlow(referenceType + " reference belongs to another organization or does not exist")
	} else if err != nil {
		return err
	}
	return nil
}
