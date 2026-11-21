package automations

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
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

func debugJSON(value any) string {
	payload, err := json.Marshal(value)
	if err != nil {
		return fmt.Sprintf("%v", value)
	}
	return string(payload)
}
