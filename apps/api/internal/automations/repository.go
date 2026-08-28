package automations

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

type Repository struct {
	db          *dbpkg.Postgres
	functions   functionsClient
	storage     storageClient
	runtimeWake chan struct{}
}

type scanner interface {
	Scan(dest ...any) error
}

type ExecutionFilter struct {
	AutomationID string
	Limit        int
}

type ExecutionStepFilter struct {
	Limit  int
	Offset int
}

func canViewAutomations(tenantContext tenant.Context) bool {
	return tenantContext.HasPermission(permissions.AutomationsView) || canManageAutomations(tenantContext)
}

func canManageAutomations(tenantContext tenant.Context) bool {
	return tenantContext.HasPermission(permissions.AutomationsManage)
}

func NewRepository(db *dbpkg.Postgres, functionsConfig FunctionsConfig, storageConfig StorageConfig) Repository {
	return Repository{
		db:          db,
		functions:   newFunctionsClient(functionsConfig),
		storage:     newStorageClient(storageConfig),
		runtimeWake: make(chan struct{}, 1),
	}
}

func (repo Repository) signalRuntimeWake() {
	if repo.runtimeWake == nil {
		return
	}
	select {
	case repo.runtimeWake <- struct{}{}:
	default:
	}
}

func (repo Repository) List(ctx context.Context, tenantContext tenant.Context) ([]Automation, error) {
	if !canViewAutomations(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}

	rows, err := repo.db.Pool().Query(ctx, `
		select `+automationSelectFields()+`
		from public.automations
		where organization_id = $1::uuid
		  and deleted_at is null
		order by created_at desc, id desc
	`, tenantContext.OrganizationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []Automation{}
	for rows.Next() {
		item, err := scanAutomation(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}

	return items, rows.Err()
}

func (repo Repository) Get(ctx context.Context, tenantContext tenant.Context, automationID string) (AutomationWithNodes, error) {
	if !canViewAutomations(tenantContext) {
		return AutomationWithNodes{}, tenant.ErrOrganizationAccessDenied
	}

	automationID, ok := normalizeUUID(automationID)
	if !ok {
		return AutomationWithNodes{}, ErrInvalidInput
	}

	automation, err := scanAutomation(repo.db.Pool().QueryRow(ctx, `
		select `+automationSelectFields()+`
		from public.automations
		where organization_id = $1::uuid
		  and id = $2::uuid
		  and deleted_at is null
	`, tenantContext.OrganizationID, automationID))
	if errors.Is(err, pgx.ErrNoRows) {
		return AutomationWithNodes{}, ErrAutomationNotFound
	}
	if err != nil {
		return AutomationWithNodes{}, err
	}

	nodes, err := repo.listNodes(ctx, automationID)
	if err != nil {
		return AutomationWithNodes{}, err
	}
	connections, err := repo.listConnections(ctx, automationID)
	if err != nil {
		return AutomationWithNodes{}, err
	}

	return AutomationWithNodes{
		Automation:  automation,
		Nodes:       nodes,
		Connections: connections,
	}, nil
}

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
		if err := validateFlowReferences(ctx, tx, tenantContext.OrganizationID, *input.ParsedFlow); err != nil {
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
		if err := validateFlowReferences(ctx, tx, tenantContext.OrganizationID, *activationFlow); err != nil {
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
	if err := validateFlowReferences(ctx, tx, tenantContext.OrganizationID, input.FlowDefinition); err != nil {
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

func (repo Repository) ListTemplates(ctx context.Context, tenantContext tenant.Context) ([]AutomationTemplate, error) {
	if !canViewAutomations(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}

	rows, err := repo.db.Pool().Query(ctx, `
		select `+templateSelectFields()+`
		from public.automation_templates
		where organization_id = $1::uuid
		order by created_at desc, id desc
	`, tenantContext.OrganizationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []AutomationTemplate{}
	for rows.Next() {
		item, err := scanTemplate(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}

	return items, rows.Err()
}

func (repo Repository) CreateTemplate(ctx context.Context, tenantContext tenant.Context, input CreateTemplateInput) (AutomationTemplate, error) {
	if !canManageAutomations(tenantContext) {
		return AutomationTemplate{}, tenant.ErrOrganizationAccessDenied
	}

	return scanTemplate(repo.db.Pool().QueryRow(ctx, `
		insert into public.automation_templates (
			organization_id,
			name,
			content,
			media_url,
			media_type,
			created_by
		)
		values ($1::uuid, $2, $3, $4, $5, $6::uuid)
		returning `+templateSelectFields()+`
	`, tenantContext.OrganizationID, input.Name, input.Content, input.MediaURL, input.MediaType, tenantContext.UserID))
}

func (repo Repository) DeleteTemplate(ctx context.Context, tenantContext tenant.Context, templateID string) error {
	if !canManageAutomations(tenantContext) {
		return tenant.ErrOrganizationAccessDenied
	}

	templateID, ok := normalizeUUID(templateID)
	if !ok {
		return ErrInvalidInput
	}

	tag, err := repo.db.Pool().Exec(ctx, `
		delete from public.automation_templates
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, tenantContext.OrganizationID, templateID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrTemplateNotFound
	}

	return nil
}

func (repo Repository) ListExecutions(ctx context.Context, tenantContext tenant.Context, filter ExecutionFilter) ([]AutomationExecution, error) {
	if !canViewAutomations(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	if filter.Limit <= 0 || filter.Limit > 200 {
		filter.Limit = 50
	}

	args := []any{tenantContext.OrganizationID, filter.Limit}
	where := []string{"ae.organization_id = $1::uuid"}
	if filter.AutomationID != "" {
		automationID, ok := normalizeUUID(filter.AutomationID)
		if !ok {
			return nil, ErrInvalidInput
		}
		args = append(args, automationID)
		where = append(where, "ae.automation_id = $"+strconv.Itoa(len(args))+"::uuid")
	}

	rows, err := repo.db.Pool().Query(ctx, `
		select
			ae.id::text,
			coalesce(ae.automation_id::text, ''),
			coalesce(ae.lead_id::text, ''),
			coalesce(ae.conversation_id::text, ''),
			ae.organization_id::text,
			ae.status,
			coalesce(ae.current_node_id::text, ''),
			coalesce(ae.current_node_key, ''),
			coalesce(ae.started_at::text, ''),
			coalesce(ae.completed_at::text, ''),
			coalesce(ae.error_message, ''),
			coalesce(ae.execution_data, '{}'::jsonb)::text,
			coalesce(ae.next_execution_at::text, ''),
			coalesce(l.id::text, ''),
			coalesce(l.name, ''),
			coalesce(a.id::text, ''),
			coalesce(a.name, '')
		from public.automation_executions ae
		left join public.leads l on l.id = ae.lead_id
		left join public.automations a on a.id = ae.automation_id
		where `+strings.Join(where, " and ")+`
		order by ae.started_at desc, ae.id desc
		limit $2::integer
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []AutomationExecution{}
	for rows.Next() {
		item, err := scanExecution(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}

	return items, rows.Err()
}

func (repo Repository) ListExecutionSummaries(ctx context.Context, tenantContext tenant.Context) ([]AutomationExecutionSummary, error) {
	if !canViewAutomations(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	rows, err := repo.db.Pool().Query(ctx, `
		select
		  a.id::text,
		  count(execution.id)::integer,
		  count(*) filter (where execution.status = 'queued')::integer,
		  count(*) filter (where execution.status = 'running')::integer,
		  count(*) filter (where execution.status = 'waiting')::integer,
		  count(*) filter (where execution.status = 'completed')::integer,
		  count(*) filter (where execution.status = 'failed')::integer,
		  count(*) filter (where execution.status in ('cancelled', 'canceled'))::integer,
		  coalesce(array(
		    select active_execution.id::text
		    from public.automation_executions active_execution
		    where active_execution.automation_id = a.id
		      and active_execution.organization_id = a.organization_id
		      and active_execution.status in ('queued', 'running', 'waiting')
		    order by active_execution.started_at desc, active_execution.id desc
		    limit 100
		  ), array[]::text[]),
		  count(*) filter (where execution.status in ('queued', 'running', 'waiting')) > 100,
		  coalesce(max(execution.started_at)::text, '')
		from public.automations a
		left join public.automation_executions execution
		  on execution.automation_id = a.id and execution.organization_id = a.organization_id
		where a.organization_id = $1::uuid and a.deleted_at is null
		group by a.id, a.organization_id
		order by a.created_at desc, a.id desc
	`, tenantContext.OrganizationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []AutomationExecutionSummary{}
	for rows.Next() {
		var item AutomationExecutionSummary
		var lastStartedAt string
		if err := rows.Scan(
			&item.AutomationID, &item.Total, &item.Queued, &item.Running,
			&item.Waiting, &item.Completed, &item.Failed, &item.Cancelled,
			&item.ActiveExecutionIDs, &item.ActiveIDsTruncated, &lastStartedAt,
		); err != nil {
			return nil, err
		}
		item.LastStartedAt = stringPtrFromSQL(lastStartedAt)
		items = append(items, item)
	}
	return items, rows.Err()
}

func (repo Repository) CancelExecution(ctx context.Context, tenantContext tenant.Context, executionID string) error {
	if !canManageAutomations(tenantContext) {
		return tenant.ErrOrganizationAccessDenied
	}

	executionID, ok := normalizeUUID(executionID)
	if !ok {
		return ErrInvalidInput
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	tag, err := tx.Exec(ctx, `
		update public.automation_executions
		set status = 'cancelled',
		    cancellation_requested_at = now(),
		    completed_at = now(),
		    error_message = 'Cancelado manualmente pelo usuario',
		    next_execution_at = null,
		    locked_at = null,
		    locked_by = null,
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
		  and status in ('queued', 'running', 'waiting')
	`, tenantContext.OrganizationID, executionID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		var exists bool
		if err := tx.QueryRow(ctx, `
			select exists (
				select 1
				from public.automation_executions
				where organization_id = $1::uuid and id = $2::uuid
			)
		`, tenantContext.OrganizationID, executionID).Scan(&exists); err != nil {
			return err
		}
		if exists {
			return ErrExecutionNotCancellable
		}
		return ErrExecutionNotFound
	}
	if _, err := tx.Exec(ctx, `
		update public.automation_execution_steps
		set status = 'cancelled',
		    completed_at = now(),
		    error_message = 'cancelled_by_user'
		where execution_id = $1::uuid
		  and organization_id = $2::uuid
		  and status in ('running', 'waiting')
	`, executionID, tenantContext.OrganizationID); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}

	return nil
}

func (repo Repository) CancelAutomationExecutions(ctx context.Context, tenantContext tenant.Context, automationID string) (int, error) {
	if !canManageAutomations(tenantContext) {
		return 0, tenant.ErrOrganizationAccessDenied
	}
	automationID, ok := normalizeUUID(automationID)
	if !ok {
		return 0, ErrInvalidInput
	}
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)
	var exists bool
	if err := tx.QueryRow(ctx, `
		select true from public.automations
		where id = $1::uuid and organization_id = $2::uuid and deleted_at is null
		for update
	`, automationID, tenantContext.OrganizationID).Scan(&exists); errors.Is(err, pgx.ErrNoRows) {
		return 0, ErrAutomationNotFound
	} else if err != nil {
		return 0, err
	}

	rows, err := tx.Query(ctx, `
		update public.automation_executions
		set status = 'cancelled', cancellation_requested_at = now(), completed_at = now(),
		    error_message = 'Cancelado manualmente pelo usuario', next_execution_at = null,
		    locked_at = null, locked_by = null, updated_at = now()
		where organization_id = $1::uuid and automation_id = $2::uuid
		  and status in ('queued', 'running', 'waiting')
		returning id::text
	`, tenantContext.OrganizationID, automationID)
	if err != nil {
		return 0, err
	}
	executionIDs := []string{}
	for rows.Next() {
		var executionID string
		if err := rows.Scan(&executionID); err != nil {
			rows.Close()
			return 0, err
		}
		executionIDs = append(executionIDs, executionID)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return 0, err
	}
	rows.Close()
	if len(executionIDs) > 0 {
		if _, err := tx.Exec(ctx, `
			update public.automation_execution_steps
			set status = 'cancelled', completed_at = now(), error_message = 'cancelled_by_user'
			where organization_id = $1::uuid and execution_id = any($2::uuid[])
			  and status in ('running', 'waiting')
		`, tenantContext.OrganizationID, executionIDs); err != nil {
			return 0, err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return len(executionIDs), nil
}

func (repo Repository) CancelLeadExecutions(ctx context.Context, tenantContext tenant.Context, leadID string) (int, error) {
	if !canManageAutomations(tenantContext) {
		return 0, tenant.ErrOrganizationAccessDenied
	}
	leadID, ok := normalizeUUID(leadID)
	if !ok {
		return 0, ErrInvalidInput
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)

	var leadExists bool
	if err := tx.QueryRow(ctx, `
		select exists (
			select 1 from public.leads
			where organization_id = $1::uuid and id = $2::uuid
		)
	`, tenantContext.OrganizationID, leadID).Scan(&leadExists); err != nil {
		return 0, err
	}
	if !leadExists {
		return 0, ErrInvalidInput
	}

	rows, err := tx.Query(ctx, `
		update public.automation_executions
		set status = 'cancelled', cancellation_requested_at = now(), completed_at = now(),
		    error_message = 'Cancelado manualmente na conversa', next_execution_at = null,
		    locked_at = null, locked_by = null, updated_at = now()
		where organization_id = $1::uuid and lead_id = $2::uuid
		  and status in ('queued', 'running', 'waiting')
		returning id::text
	`, tenantContext.OrganizationID, leadID)
	if err != nil {
		return 0, err
	}
	executionIDs := []string{}
	for rows.Next() {
		var executionID string
		if err := rows.Scan(&executionID); err != nil {
			rows.Close()
			return 0, err
		}
		executionIDs = append(executionIDs, executionID)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return 0, err
	}
	rows.Close()

	if len(executionIDs) > 0 {
		if _, err := tx.Exec(ctx, `
			update public.automation_execution_steps
			set status = 'cancelled', completed_at = now(), error_message = 'cancelled_by_user'
			where organization_id = $1::uuid and execution_id = any($2::uuid[])
			  and status in ('running', 'waiting')
		`, tenantContext.OrganizationID, executionIDs); err != nil {
			return 0, err
		}

		if _, err := tx.Exec(ctx, `
			insert into public.lead_timeline_events (
				organization_id, lead_id, event_type, title, description,
				user_id, actor_user_id, metadata, event_at
			) values (
				$1::uuid, $2::uuid,
				'automation_stopped_manually',
				'Automacao interrompida manualmente',
				'Fluxo interrompido pelo botao da conversa',
				$3::uuid, $3::uuid,
				jsonb_build_object('execution_ids', to_jsonb($4::text[])),
				now()
			)
		`, tenantContext.OrganizationID, leadID, tenantContext.UserID, executionIDs); err != nil {
			return 0, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}
	return len(executionIDs), nil
}

func (repo Repository) ListExecutionSteps(ctx context.Context, tenantContext tenant.Context, executionID string, filter ExecutionStepFilter) ([]AutomationExecutionStep, error) {
	if !canViewAutomations(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	executionID, ok := normalizeUUID(executionID)
	if !ok {
		return nil, ErrInvalidInput
	}
	if filter.Limit < 1 || filter.Limit > 200 {
		filter.Limit = 50
	}
	if filter.Offset < 0 || filter.Offset > 10000 {
		return nil, ErrInvalidInput
	}

	var executionExists bool
	if err := repo.db.Pool().QueryRow(ctx, `
		select exists (
			select 1 from public.automation_executions
			where id = $1::uuid and organization_id = $2::uuid
		)
	`, executionID, tenantContext.OrganizationID).Scan(&executionExists); err != nil {
		return nil, err
	}
	if !executionExists {
		return nil, ErrExecutionNotFound
	}

	rows, err := repo.db.Pool().Query(ctx, `
		select
			id::text,
			execution_id::text,
			node_key,
			node_type,
			coalesce(action_type, ''),
			status,
			attempt,
			coalesce(started_at::text, ''),
			coalesce(completed_at::text, ''),
			coalesce(left(error_message, 500), '')
		from public.automation_execution_steps
		where execution_id = $1::uuid
		  and organization_id = $2::uuid
		order by started_at asc, id asc
		limit $3 offset $4
	`, executionID, tenantContext.OrganizationID, filter.Limit, filter.Offset)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	steps := []AutomationExecutionStep{}
	for rows.Next() {
		var step AutomationExecutionStep
		var actionType, completedAt, errorMessage string
		if err := rows.Scan(
			&step.ID,
			&step.ExecutionID,
			&step.NodeKey,
			&step.NodeType,
			&actionType,
			&step.Status,
			&step.Attempt,
			&step.StartedAt,
			&completedAt,
			&errorMessage,
		); err != nil {
			return nil, err
		}
		step.ActionType = stringPtrFromSQL(actionType)
		step.CompletedAt = stringPtrFromSQL(completedAt)
		step.ErrorMessage = stringPtrFromSQL(errorMessage)
		steps = append(steps, step)
	}
	return steps, rows.Err()
}

func (repo Repository) ListRuntimeIssues(ctx context.Context, tenantContext tenant.Context, limit int, offset int) (RuntimeIssuesResult, error) {
	if !canViewAutomations(tenantContext) {
		return RuntimeIssuesResult{}, tenant.ErrOrganizationAccessDenied
	}
	if limit < 1 || limit > 200 {
		limit = 50
	}
	if offset < 0 || offset > 10000 {
		return RuntimeIssuesResult{}, ErrInvalidInput
	}

	result := RuntimeIssuesResult{Issues: []RuntimeIssue{}}
	if err := repo.db.Pool().QueryRow(ctx, `
		select
		  (select count(*) from public.automation_event_outbox o where o.organization_id = $1::uuid and o.status = 'dead_letter'),
		  (select count(*) from public.automation_event_outbox o where o.organization_id = $1::uuid and o.status = 'failed'),
		  (select count(*)
		   from public.automation_effect_dispatches d
		   join public.whatsapp_outbox outbox
		     on outbox.organization_id = d.organization_id
		    and d.response->>'outbox_id' = outbox.id::text
		   where d.organization_id = $1::uuid
		     and d.status = 'failed'
		     and d.request->>'delivery_contract' = 'canonical_whatsapp_outbox_v1'
		     and outbox.status = 'failed'),
		  (select count(*) from public.automation_circuit_breakers c where c.organization_id = $1::uuid and c.open_until > now()),
		  (select count(*)
		   from public.automation_event_outbox o
		   cross join lateral jsonb_array_elements(coalesce(o.payload->'runtime_decisions', '[]'::jsonb)) decision
		   where o.organization_id = $1::uuid and decision->>'type' = 'duplicate_or_already_active'),
		  (select count(*) from public.automation_effect_dispatches d where d.organization_id = $1::uuid and d.status = 'unknown'),
		  (select count(*) from public.automation_effect_dispatches d where d.organization_id = $1::uuid and d.status = 'sending' and d.attempted_at < now() - interval '2 minutes')
	`, tenantContext.OrganizationID).Scan(
		&result.Summary.DeadLetters,
		&result.Summary.FailedEvents,
		&result.Summary.FailedEffects,
		&result.Summary.OpenCircuits,
		&result.Summary.DuplicateDecisions,
		&result.Summary.UnknownEffects,
		&result.Summary.StaleSendingEffects,
	); err != nil {
		return RuntimeIssuesResult{}, err
	}

	rows, err := repo.db.Pool().Query(ctx, `
		with issue_rows as (
		  select
		    o.id::text as id,
		    case when o.status = 'dead_letter' then 'dead_letter' else 'failed_event' end as kind,
		    case when o.status = 'dead_letter' then 'error' else 'warning' end as severity,
		    o.status,
		    null::text as automation_id,
		    null::text as automation_name,
		    null::text as execution_id,
		    o.lead_id::text as lead_id,
		    left(coalesce(o.last_error, 'trigger processing failed'), 500) as message,
		    jsonb_build_object('eventType', o.event_type, 'attempts', o.attempts, 'maxAttempts', o.max_attempts) as details,
		    exists (
		      select 1 from public.organization_modules module
		      where module.organization_id = o.organization_id
		        and lower(trim(module.module_name)) = 'automations'
		        and coalesce(module.is_enabled, false)
		    ) as retryable,
		    coalesce(o.dead_lettered_at, o.updated_at, o.created_at) as occurred_at
		  from public.automation_event_outbox o
		  where o.organization_id = $1::uuid and o.status in ('dead_letter', 'failed')

		  union all

		  select
		    d.id::text,
		    'failed_effect',
		    'error',
		    outbox.status,
		    e.automation_id::text,
		    a.name,
		    d.execution_id::text,
		    e.lead_id::text,
		    left(coalesce(d.error_message, outbox.last_error, 'WhatsApp delivery failed'), 500),
		    jsonb_build_object(
		      'effectType', d.effect_type,
		      'nodeKey', d.node_key,
		      'effectKey', d.effect_key,
		      'outboxId', outbox.id,
		      'outboxStatus', outbox.status,
		      'attempts', outbox.attempts,
		      'maxAttempts', outbox.max_attempts
		    ),
		    outbox.status = 'failed'
		      and session.provider = 'evolution_go'
		      and session.status = 'connected'
		      and coalesce(session.is_active, true),
		    coalesce(outbox.dead_lettered_at, outbox.failed_at, outbox.updated_at)
		  from public.automation_effect_dispatches d
		  join public.automation_executions e on e.id = d.execution_id and e.organization_id = d.organization_id
		  left join public.automations a on a.id = e.automation_id and a.organization_id = e.organization_id
		  join public.whatsapp_outbox outbox
		    on outbox.organization_id = d.organization_id
		   and d.response->>'outbox_id' = outbox.id::text
		  join public.whatsapp_sessions session
		    on session.id = outbox.session_id
		   and session.organization_id = outbox.organization_id
		  where d.organization_id = $1::uuid
		    and d.status = 'failed'
		    and d.request->>'delivery_contract' = 'canonical_whatsapp_outbox_v1'
		    and outbox.status = 'failed'

		  union all

		  select
		    o.id::text,
		    case when decision->>'type' = 'circuit_open' then 'circuit_decision' else 'duplicate_decision' end,
		    case when decision->>'type' = 'circuit_open' then 'warning' else 'info' end,
		    o.status,
		    decision->>'automation_id',
		    a.name,
		    null::text,
		    o.lead_id::text,
		    decision->>'type',
		    decision,
		    decision->>'type' = 'circuit_open' and not exists (
		      select 1 from public.automation_circuit_breakers breaker
		      where breaker.organization_id = o.organization_id
		        and breaker.automation_id = nullif(decision->>'automation_id', '')::uuid
		        and breaker.lead_id = o.lead_id
		        and breaker.open_until > now()
		    ),
		    coalesce(private.safe_automation_timestamptz(decision->>'recorded_at'), o.updated_at)
		  from public.automation_event_outbox o
		  cross join lateral jsonb_array_elements(coalesce(o.payload->'runtime_decisions', '[]'::jsonb)) decision
		  left join public.automations a
		    on a.id = nullif(decision->>'automation_id', '')::uuid and a.organization_id = o.organization_id
		  where o.organization_id = $1::uuid

		  union all

		  select
		    d.id::text,
		    'ambiguous_effect',
		    'error',
		    d.status,
		    e.automation_id::text,
		    a.name,
		    d.execution_id::text,
		    e.lead_id::text,
		    left(coalesce(d.error_message, 'provider outcome is ambiguous; automatic resend is disabled'), 500),
		    jsonb_build_object('effectType', d.effect_type, 'nodeKey', d.node_key, 'effectKey', d.effect_key, 'providerId', d.provider_id),
		    false,
		    d.attempted_at
		  from public.automation_effect_dispatches d
		  join public.automation_executions e on e.id = d.execution_id and e.organization_id = d.organization_id
		  left join public.automations a on a.id = e.automation_id and a.organization_id = e.organization_id
		  where d.organization_id = $1::uuid
		    and (d.status = 'unknown' or (d.status = 'sending' and d.attempted_at < now() - interval '2 minutes'))

		  union all

		  select
		    c.id::text,
		    'circuit_open',
		    'warning',
		    'open',
		    c.automation_id::text,
		    a.name,
		    null::text,
		    c.lead_id::text,
		    coalesce(c.reason, 'automation circuit is open'),
		    jsonb_build_object('executionCount', c.execution_count, 'openUntil', c.open_until),
		    false,
		    c.updated_at
		  from public.automation_circuit_breakers c
		  left join public.automations a on a.id = c.automation_id and a.organization_id = c.organization_id
		  where c.organization_id = $1::uuid and c.open_until > now()
		)
		select id, kind, severity, status, coalesce(automation_id, ''), coalesce(automation_name, ''),
		       coalesce(execution_id, ''), coalesce(lead_id, ''), coalesce(message, ''),
		       details::text, retryable, occurred_at::text
		from issue_rows
		order by occurred_at desc, id desc
		limit $2 offset $3
	`, tenantContext.OrganizationID, limit, offset)
	if err != nil {
		return RuntimeIssuesResult{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var issue RuntimeIssue
		var automationID, automationName, executionID, leadID, message, details string
		if err := rows.Scan(
			&issue.ID, &issue.Kind, &issue.Severity, &issue.Status,
			&automationID, &automationName, &executionID, &leadID, &message,
			&details, &issue.Retryable, &issue.OccurredAt,
		); err != nil {
			return RuntimeIssuesResult{}, err
		}
		issue.AutomationID = stringPtrFromSQL(automationID)
		issue.AutomationName = stringPtrFromSQL(automationName)
		issue.ExecutionID = stringPtrFromSQL(executionID)
		issue.LeadID = stringPtrFromSQL(leadID)
		issue.Message = stringPtrFromSQL(message)
		issue.Details = json.RawMessage(details)
		result.Issues = append(result.Issues, issue)
	}
	return result, rows.Err()
}

func (repo Repository) RetryRuntimeIssue(ctx context.Context, tenantContext tenant.Context, kind string, issueID string) error {
	if !canManageAutomations(tenantContext) {
		return tenant.ErrOrganizationAccessDenied
	}
	issueID, ok := normalizeUUID(issueID)
	if !ok {
		return ErrInvalidInput
	}
	kind = strings.TrimSpace(kind)
	if kind != "dead_letter" && kind != "failed_event" && kind != "failed_effect" && kind != "circuit_decision" {
		return ErrRuntimeIssueNotRetryable
	}
	if kind == "failed_effect" {
		var resetCount int
		err := repo.db.Pool().QueryRow(ctx, `
			with target as materialized (
			  select dispatch.id as dispatch_id, outbox.id, outbox.message_id, outbox.organization_id
			  from public.automation_effect_dispatches dispatch
			  join public.whatsapp_outbox outbox
			    on outbox.organization_id = dispatch.organization_id
			   and dispatch.response->>'outbox_id' = outbox.id::text
			  join public.whatsapp_sessions session
			    on session.id = outbox.session_id
			   and session.organization_id = outbox.organization_id
			  where dispatch.id = $1::uuid
			    and dispatch.organization_id = $2::uuid
			    and dispatch.status = 'failed'
			    and dispatch.request->>'delivery_contract' = 'canonical_whatsapp_outbox_v1'
			    and outbox.status = 'failed'
			    and session.provider = 'evolution_go'
			    and session.status = 'connected'
			    and coalesce(session.is_active, true)
			    and exists (
			      select 1 from public.organization_modules module
			      where module.organization_id = dispatch.organization_id
			        and lower(trim(module.module_name)) = 'automations'
			        and coalesce(module.is_enabled, false)
			    )
			  for update of dispatch, outbox
			), reset_outbox as (
			  update public.whatsapp_outbox outbox
			  set status = 'pending', attempts = 0, next_attempt_at = now(),
			      locked_at = null, locked_by = null, last_error = null,
			      failed_at = null, dead_lettered_at = null, updated_at = now()
			  from target
			  where outbox.id = target.id and outbox.organization_id = target.organization_id
			  returning outbox.id, outbox.message_id, outbox.organization_id
			), reset_dispatch as (
			  update public.automation_effect_dispatches dispatch
			  set status = 'succeeded',
			      response = (coalesce(dispatch.response, '{}'::jsonb) - 'last_error')
			        || jsonb_build_object('status', 'queued', 'delivery_status', 'queued'),
			      provider_id = null,
			      error_message = null,
			      attempted_at = now(),
			      completed_at = now()
			  from target
			  where dispatch.id = target.dispatch_id
			    and dispatch.organization_id = target.organization_id
			  returning dispatch.id
			), reset_message as (
			  update public.whatsapp_messages message
			  set status = 'queued', updated_at = now()
			  from reset_outbox
			  where message.id = reset_outbox.message_id
			    and message.organization_id = reset_outbox.organization_id
			  returning message.id
			), reset_timeline as (
			  update public.lead_timeline_events timeline
			  set event_type = 'whatsapp_message_queued',
			      title = 'Mensagem WhatsApp reenfileirada',
			      metadata = (coalesce(timeline.metadata, '{}'::jsonb) - 'last_error')
			        || jsonb_build_object('delivery_status', 'queued')
			  from reset_outbox
			  where timeline.organization_id = reset_outbox.organization_id
			    and timeline.metadata->>'outbox_id' = reset_outbox.id::text
			  returning timeline.id
			)
			select count(*)::integer from reset_outbox
		`, issueID, tenantContext.OrganizationID).Scan(&resetCount)
		if err != nil {
			return err
		}
		if resetCount != 1 {
			return ErrRuntimeIssueNotRetryable
		}
		return nil
	}

	tag, err := repo.db.Pool().Exec(ctx, `
		update public.automation_event_outbox o
		set status = 'pending',
		    attempts = 0,
		    available_at = now(),
		    locked_at = null,
		    locked_by = null,
		    completed_at = null,
		    dead_lettered_at = null,
		    last_error = null,
		    payload = o.payload - 'runtime_decisions',
		    updated_at = now()
		where o.id = $1::uuid
		  and o.organization_id = $2::uuid
		  and exists (
		    select 1 from public.organization_modules module
		    where module.organization_id = o.organization_id
		      and lower(trim(module.module_name)) = 'automations'
		      and coalesce(module.is_enabled, false)
		  )
		  and (
		    ($3 in ('dead_letter', 'failed_event') and o.status in ('dead_letter', 'failed'))
		    or (
		      $3 = 'circuit_decision'
		      and o.status = 'completed'
		      and exists (
		        select 1 from jsonb_array_elements(coalesce(o.payload->'runtime_decisions', '[]'::jsonb)) decision
		        where decision->>'type' = 'circuit_open'
		      )
		      and not exists (
		        select 1
		        from jsonb_array_elements(coalesce(o.payload->'runtime_decisions', '[]'::jsonb)) decision
		        join public.automation_circuit_breakers breaker
		          on breaker.organization_id = o.organization_id
		         and breaker.automation_id = nullif(decision->>'automation_id', '')::uuid
		         and breaker.lead_id = o.lead_id
		         and breaker.open_until > now()
		        where decision->>'type' = 'circuit_open'
		      )
		    )
		  )
	`, issueID, tenantContext.OrganizationID, kind)
	if err != nil {
		return err
	}
	if tag.RowsAffected() != 1 {
		return ErrRuntimeIssueNotRetryable
	}
	return nil
}

func (repo Repository) Start(ctx context.Context, tenantContext tenant.Context, automationID string, input StartInput) (StartResult, error) {
	automationID, ok := normalizeUUID(automationID)
	if !ok {
		return StartResult{}, ErrInvalidInput
	}
	if !canManageAutomations(tenantContext) {
		return StartResult{}, tenant.ErrOrganizationAccessDenied
	}
	if !repo.functions.isConfigured() {
		return StartResult{}, ErrAutomationRuntime
	}

	var automationName string
	var flowVersionID string
	var firstNodeKey string
	err := repo.db.Pool().QueryRow(ctx, `
		select a.name, fv.id::text, fv.first_node_key
		from public.automations a
		join public.automation_flow_versions fv on fv.id = a.active_flow_version_id
		where a.organization_id = $1::uuid
		  and a.id = $2::uuid
		  and a.is_active = true
		  and fv.organization_id = a.organization_id
	`, tenantContext.OrganizationID, automationID).Scan(&automationName, &flowVersionID, &firstNodeKey)
	if errors.Is(err, pgx.ErrNoRows) {
		return StartResult{}, ErrAutomationNotFound
	}
	if err != nil {
		return StartResult{}, err
	}

	var leadExists bool
	if err := repo.db.Pool().QueryRow(ctx, `
		select exists (
			select 1 from public.leads
			where id = $1::uuid and organization_id = $2::uuid
		)
	`, input.LeadID, tenantContext.OrganizationID).Scan(&leadExists); err != nil {
		return StartResult{}, err
	}
	if !leadExists {
		return StartResult{}, ErrInvalidInput
	}

	if input.ConversationID != "" {
		var conversationMatches bool
		if err := repo.db.Pool().QueryRow(ctx, `
			select exists (
				select 1
				from public.whatsapp_conversations
				where id = $1::uuid
				  and organization_id = $2::uuid
				  and lead_id = $3::uuid
				  and deleted_at is null
			)
		`, input.ConversationID, tenantContext.OrganizationID, input.LeadID).Scan(&conversationMatches); err != nil {
			return StartResult{}, err
		}
		if !conversationMatches {
			return StartResult{}, ErrInvalidInput
		}
	}

	executionData, err := json.Marshal(map[string]any{
		"trigger_data": map[string]any{
			"lead_id":         input.LeadID,
			"conversation_id": input.ConversationID,
		},
		"variables": map[string]any{},
	})
	if err != nil {
		return StartResult{}, err
	}

	var executionID string
	err = repo.db.Pool().QueryRow(ctx, `
		insert into public.automation_executions (
			automation_id,
			flow_version_id,
			lead_id,
			conversation_id,
			organization_id,
			current_node_key,
			status,
			started_at,
			execution_data
		)
		values ($1::uuid, $2::uuid, $3::uuid, nullif($4, '')::uuid, $5::uuid, $6, 'queued', now(), $7::jsonb)
		returning id::text
	`, automationID, flowVersionID, input.LeadID, input.ConversationID, tenantContext.OrganizationID, firstNodeKey, string(executionData)).Scan(&executionID)
	if err != nil {
		var pgError *pgconn.PgError
		if errors.As(err, &pgError) && pgError.Code == "23505" && pgError.ConstraintName == "automation_executions_active_lead_uidx" {
			return StartResult{}, ErrExecutionAlreadyActive
		}
		return StartResult{}, err
	}

	repo.signalRuntimeWake()

	return StartResult{
		ExecutionID:     executionID,
		AutomationID:    automationID,
		AutomationName:  automationName,
		ExecutorStarted: false,
		Status:          "queued",
		DispatchPending: true,
	}, nil
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

func validateFlowReferences(ctx context.Context, tx pgx.Tx, organizationID string, flow FlowDefinition) error {
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

func validateStageReference(ctx context.Context, tx pgx.Tx, organizationID, pipelineID, stageID string) error {
	if pipelineID == "" && stageID == "" {
		return nil
	}
	var exists bool
	if err := tx.QueryRow(ctx, `
		select true
		from public.stages s
		join public.pipelines p on p.id = s.pipeline_id
		where s.id = $1::uuid
		  and s.pipeline_id = $2::uuid
		  and s.organization_id = $3::uuid
		  and p.organization_id = $3::uuid
		for key share of s, p
	`, stageID, pipelineID, organizationID).Scan(&exists); errors.Is(err, pgx.ErrNoRows) {
		return invalidFlow("stage and pipeline must belong to the same organization")
	} else if err != nil {
		return err
	}
	return nil
}

func (repo Repository) firstActionNodeID(ctx context.Context, automationID string) (string, error) {
	var triggerNodeID string
	err := repo.db.Pool().QueryRow(ctx, `
		select id::text
		from public.automation_nodes
		where automation_id = $1::uuid
		  and node_type = 'trigger'
		order by created_at asc, id asc
		limit 1
	`, automationID).Scan(&triggerNodeID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrAutomationMisconfigured
	}
	if err != nil {
		return "", err
	}

	var firstNodeID string
	err = repo.db.Pool().QueryRow(ctx, `
		select target_node_id::text
		from public.automation_connections
		where automation_id = $1::uuid
		  and source_node_id = $2::uuid
		order by created_at asc, id asc
		limit 1
	`, automationID, triggerNodeID).Scan(&firstNodeID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrAutomationMisconfigured
	}
	if err != nil {
		return "", err
	}

	return firstNodeID, nil
}

func (repo Repository) listNodes(ctx context.Context, automationID string) ([]AutomationNode, error) {
	rows, err := repo.db.Pool().Query(ctx, `
		select `+automationNodeSelectFields()+`
		from public.automation_nodes
		where automation_id = $1::uuid
		order by created_at asc, id asc
	`, automationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	nodes := []AutomationNode{}
	for rows.Next() {
		node, err := scanAutomationNode(rows)
		if err != nil {
			return nil, err
		}
		nodes = append(nodes, node)
	}

	return nodes, rows.Err()
}

func (repo Repository) listConnections(ctx context.Context, automationID string) ([]AutomationConnection, error) {
	rows, err := repo.db.Pool().Query(ctx, `
		select
			id::text,
			automation_id::text,
			source_node_id::text,
			target_node_id::text,
			coalesce(source_handle, ''),
			coalesce(condition_branch, '')
		from public.automation_connections
		where automation_id = $1::uuid
		order by created_at asc, id asc
	`, automationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	connections := []AutomationConnection{}
	for rows.Next() {
		var connection AutomationConnection
		var sourceHandle string
		var conditionBranch string
		if err := rows.Scan(
			&connection.ID,
			&connection.AutomationID,
			&connection.SourceNodeID,
			&connection.TargetNodeID,
			&sourceHandle,
			&conditionBranch,
		); err != nil {
			return nil, err
		}
		connection.SourceHandle = stringPtrFromSQL(sourceHandle)
		connection.ConditionBranch = stringPtrFromSQL(conditionBranch)
		connections = append(connections, connection)
	}

	return connections, rows.Err()
}

func automationSelectFields() string {
	return `
		id::text,
		organization_id::text,
		name,
		coalesce(description, ''),
		is_active,
		trigger_type,
		coalesce(trigger_config, '{}'::jsonb)::text,
		coalesce(flow_definition, 'null'::jsonb)::text,
		coalesce(created_by::text, ''),
		coalesce(created_at::text, ''),
		coalesce(updated_at::text, '')`
}

func automationNodeSelectFields() string {
	return `
		id::text,
		automation_id::text,
		node_type,
		coalesce(action_type, ''),
		coalesce(node_config, '{}'::jsonb)::text,
		coalesce(position_x, 0)::float8,
		coalesce(position_y, 0)::float8,
		coalesce(created_at::text, '')`
}

func templateSelectFields() string {
	return `
		id::text,
		organization_id::text,
		name,
		content,
		coalesce(media_url, ''),
		coalesce(media_type, ''),
		coalesce(created_by::text, ''),
		coalesce(created_at::text, ''),
		coalesce(updated_at::text, '')`
}

func scanAutomation(row scanner) (Automation, error) {
	var item Automation
	var description string
	var triggerConfig string
	var flowDefinition string
	var createdBy string
	if err := row.Scan(
		&item.ID,
		&item.OrganizationID,
		&item.Name,
		&description,
		&item.IsActive,
		&item.TriggerType,
		&triggerConfig,
		&flowDefinition,
		&createdBy,
		&item.CreatedAt,
		&item.UpdatedAt,
	); err != nil {
		return Automation{}, err
	}

	item.Description = stringPtrFromSQL(description)
	item.TriggerConfig = rawJSON(triggerConfig, "{}")
	item.FlowDefinition = rawJSON(flowDefinition, "null")
	item.CreatedBy = stringPtrFromSQL(createdBy)
	return item, nil
}

func scanAutomationNode(row scanner) (AutomationNode, error) {
	var item AutomationNode
	var actionType string
	var config string
	if err := row.Scan(
		&item.ID,
		&item.AutomationID,
		&item.NodeType,
		&actionType,
		&config,
		&item.PositionX,
		&item.PositionY,
		&item.CreatedAt,
	); err != nil {
		return AutomationNode{}, err
	}

	item.ActionType = stringPtrFromSQL(actionType)
	item.Config = rawJSON(config, "{}")
	return item, nil
}

func scanTemplate(row scanner) (AutomationTemplate, error) {
	var item AutomationTemplate
	var mediaURL string
	var mediaType string
	var createdBy string
	if err := row.Scan(
		&item.ID,
		&item.OrganizationID,
		&item.Name,
		&item.Content,
		&mediaURL,
		&mediaType,
		&createdBy,
		&item.CreatedAt,
		&item.UpdatedAt,
	); err != nil {
		return AutomationTemplate{}, err
	}

	item.MediaURL = stringPtrFromSQL(mediaURL)
	item.MediaType = stringPtrFromSQL(mediaType)
	item.CreatedBy = stringPtrFromSQL(createdBy)
	return item, nil
}

func scanExecution(row scanner) (AutomationExecution, error) {
	var item AutomationExecution
	var automationID string
	var leadID string
	var conversationID string
	var currentNodeID string
	var currentNodeKey string
	var completedAt string
	var errorMessage string
	var executionData string
	var nextExecutionAt string
	var leadRefID string
	var leadName string
	var automationRefID string
	var automationName string
	if err := row.Scan(
		&item.ID,
		&automationID,
		&leadID,
		&conversationID,
		&item.OrganizationID,
		&item.Status,
		&currentNodeID,
		&currentNodeKey,
		&item.StartedAt,
		&completedAt,
		&errorMessage,
		&executionData,
		&nextExecutionAt,
		&leadRefID,
		&leadName,
		&automationRefID,
		&automationName,
	); err != nil {
		return AutomationExecution{}, err
	}

	item.AutomationID = stringPtrFromSQL(automationID)
	item.LeadID = stringPtrFromSQL(leadID)
	item.ConversationID = stringPtrFromSQL(conversationID)
	item.CurrentNodeID = stringPtrFromSQL(currentNodeID)
	item.CurrentNodeKey = stringPtrFromSQL(currentNodeKey)
	item.CompletedAt = stringPtrFromSQL(completedAt)
	item.ErrorMessage = stringPtrFromSQL(errorMessage)
	item.ExecutionData = rawJSON(executionData, "{}")
	item.NextExecutionAt = stringPtrFromSQL(nextExecutionAt)
	if leadRefID != "" {
		item.Lead = &Ref{ID: leadRefID, Name: stringPtrFromSQL(leadName)}
	}
	if automationRefID != "" {
		item.Automation = &Ref{ID: automationRefID, Name: stringPtrFromSQL(automationName)}
	}

	return item, nil
}

func debugJSON(value any) string {
	payload, err := json.Marshal(value)
	if err != nil {
		return fmt.Sprintf("%v", value)
	}
	return string(payload)
}
