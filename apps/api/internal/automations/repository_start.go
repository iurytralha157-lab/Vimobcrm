package automations

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

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
