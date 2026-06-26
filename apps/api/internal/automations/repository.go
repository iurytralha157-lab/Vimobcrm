package automations

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

type Repository struct {
	db        *dbpkg.Postgres
	functions functionsClient
	storage   storageClient
}

type scanner interface {
	Scan(dest ...any) error
}

type ExecutionFilter struct {
	AutomationID string
	Limit        int
}

func NewRepository(db *dbpkg.Postgres, functionsConfig FunctionsConfig, storageConfig StorageConfig) Repository {
	return Repository{
		db:        db,
		functions: newFunctionsClient(functionsConfig),
		storage:   newStorageClient(storageConfig),
	}
}

func (repo Repository) List(ctx context.Context, tenantContext tenant.Context) ([]Automation, error) {
	if !tenantContext.HasPermission("automations_view") {
		return nil, tenant.ErrOrganizationAccessDenied
	}

	rows, err := repo.db.Pool().Query(ctx, `
		select `+automationSelectFields()+`
		from public.automations
		where organization_id = $1::uuid
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
	if !tenantContext.HasPermission("automations_view") {
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
	if !tenantContext.HasPermission("automations_edit") {
		return Automation{}, tenant.ErrOrganizationAccessDenied
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return Automation{}, err
	}
	defer tx.Rollback(ctx)

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
		values ($1::uuid, $2, $3, $4, $5::jsonb, $6::jsonb, $7::uuid, true)
		returning `+automationSelectFields()+`
	`, tenantContext.OrganizationID, input.Name, input.Description, input.TriggerType, string(input.TriggerConfig), string(input.FlowDefinition), tenantContext.UserID))
	if err != nil {
		return Automation{}, err
	}

	if string(input.FlowDefinition) == "null" {
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
	}

	if err := tx.Commit(ctx); err != nil {
		return Automation{}, err
	}

	return automation, nil
}

func (repo Repository) Update(ctx context.Context, tenantContext tenant.Context, automationID string, input UpdateInput) (Automation, error) {
	if !tenantContext.HasPermission("automations_edit") {
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

	if input.Name != nil {
		name = *input.Name
	}
	if input.DescriptionSet {
		description = input.Description
	}
	if input.IsActive != nil {
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

	updated, err := scanAutomation(repo.db.Pool().QueryRow(ctx, `
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
		returning `+automationSelectFields()+`
	`, tenantContext.OrganizationID, current.ID, name, description, isActive, triggerType, string(triggerConfig), string(flowDefinition)))
	if errors.Is(err, pgx.ErrNoRows) {
		return Automation{}, ErrAutomationNotFound
	}
	if err != nil {
		return Automation{}, err
	}

	return updated, nil
}

func (repo Repository) Delete(ctx context.Context, tenantContext tenant.Context, automationID string) error {
	if !tenantContext.HasPermission("automations_edit") {
		return tenant.ErrOrganizationAccessDenied
	}

	automationID, ok := normalizeUUID(automationID)
	if !ok {
		return ErrInvalidInput
	}

	tag, err := repo.db.Pool().Exec(ctx, `
		delete from public.automations
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, tenantContext.OrganizationID, automationID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrAutomationNotFound
	}

	return nil
}

func (repo Repository) Duplicate(ctx context.Context, tenantContext tenant.Context, automationID string) (Automation, error) {
	if !tenantContext.HasPermission("automations_edit") {
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
			values ($1::uuid, $2::uuid, $3::uuid, $4, $5)
		`, created.ID, sourceID, targetID, connection.SourceHandle, connection.ConditionBranch); err != nil {
			return Automation{}, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return Automation{}, err
	}

	return created, nil
}

func (repo Repository) SaveFlow(ctx context.Context, tenantContext tenant.Context, automationID string, input SaveFlowInput) ([]AutomationNode, error) {
	if !tenantContext.HasPermission("automations_edit") {
		return nil, tenant.ErrOrganizationAccessDenied
	}

	automationID, ok := normalizeUUID(automationID)
	if !ok {
		return nil, ErrInvalidInput
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	tag, err := tx.Exec(ctx, `
		update public.automations
		set flow_definition = $3::jsonb,
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, tenantContext.OrganizationID, automationID, string(input.Raw))
	if err != nil {
		return nil, err
	}
	if tag.RowsAffected() == 0 {
		return nil, ErrAutomationNotFound
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
			values ($1::uuid, $2::uuid, $3::uuid, $4, $5)
		`, automationID, sourceID, targetID, connection.SourceHandle, connection.ConditionBranch); err != nil {
			return nil, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	return inserted, nil
}

func (repo Repository) ListTemplates(ctx context.Context, tenantContext tenant.Context) ([]AutomationTemplate, error) {
	if !tenantContext.HasPermission("automations_view") {
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
	if !tenantContext.HasPermission("automations_edit") {
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
	if !tenantContext.HasPermission("automations_edit") {
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
	if !tenantContext.HasPermission("automations_view") {
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

func (repo Repository) CancelExecution(ctx context.Context, tenantContext tenant.Context, executionID string) error {
	if !tenantContext.HasPermission("automations_edit") {
		return tenant.ErrOrganizationAccessDenied
	}

	executionID, ok := normalizeUUID(executionID)
	if !ok {
		return ErrInvalidInput
	}

	tag, err := repo.db.Pool().Exec(ctx, `
		update public.automation_executions
		set status = 'cancelled',
		    completed_at = now(),
		    error_message = 'Cancelado manualmente pelo usuario'
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, tenantContext.OrganizationID, executionID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrExecutionNotFound
	}

	return nil
}

func (repo Repository) Start(ctx context.Context, tenantContext tenant.Context, automationID string, input StartInput) (StartResult, error) {
	automationID, ok := normalizeUUID(automationID)
	if !ok {
		return StartResult{}, ErrInvalidInput
	}
	if !tenantContext.HasPermission("automations_edit") {
		return StartResult{}, tenant.ErrOrganizationAccessDenied
	}

	var automationName string
	err := repo.db.Pool().QueryRow(ctx, `
		select name
		from public.automations
		where organization_id = $1::uuid
		  and id = $2::uuid
		  and is_active = true
	`, tenantContext.OrganizationID, automationID).Scan(&automationName)
	if errors.Is(err, pgx.ErrNoRows) {
		return StartResult{}, ErrAutomationNotFound
	}
	if err != nil {
		return StartResult{}, err
	}

	firstNodeID, err := repo.firstActionNodeID(ctx, automationID)
	if err != nil {
		return StartResult{}, err
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
			lead_id,
			conversation_id,
			organization_id,
			current_node_id,
			status,
			started_at,
			execution_data
		)
		values ($1::uuid, $2::uuid, nullif($3, '')::uuid, $4::uuid, $5::uuid, 'running', now(), $6::jsonb)
		returning id::text
	`, automationID, input.LeadID, input.ConversationID, tenantContext.OrganizationID, firstNodeID, string(executionData)).Scan(&executionID)
	if err != nil {
		return StartResult{}, err
	}

	executorStarted := true
	if err := repo.functions.invoke(ctx, "automation-executor", map[string]any{"execution_id": executionID}); err != nil {
		executorStarted = false
	}

	return StartResult{
		ExecutionID:     executionID,
		AutomationID:    automationID,
		AutomationName:  automationName,
		ExecutorStarted: executorStarted,
	}, nil
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
