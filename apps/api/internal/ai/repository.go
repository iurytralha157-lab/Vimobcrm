package ai

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"unicode"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

type Repository struct {
	db *dbpkg.Postgres
}

func NewRepository(db *dbpkg.Postgres) Repository {
	return Repository{db: db}
}

func canManageAI(tenantContext tenant.Context) bool {
	return tenantContext.IsSuperAdmin ||
		tenantContext.HasRole("owner", "admin") ||
		tenantContext.HasPermission("settings_manage") ||
		tenantContext.HasPermission("ai_manage")
}

func (repo Repository) ListAgents(ctx context.Context, tenantContext tenant.Context) ([]Agent, error) {
	if !tenantContext.IsSuperAdmin {
		return nil, ErrPermission
	}
	if err := repo.ensureDefaultAgents(ctx); err != nil {
		return nil, err
	}

	rows, err := repo.db.Pool().Query(ctx, `
		select id::text, organization_id::text, name, description, status, config, created_at, updated_at
		from public.ai_agents
		order by coalesce(organization_id::text, ''), created_at asc
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []Agent{}
	for rows.Next() {
		item, err := scanAgent(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (repo Repository) Settings(ctx context.Context, tenantContext tenant.Context) (Settings, error) {
	if tenantContext.OrganizationID == "" {
		return Settings{}, ErrPermission
	}
	if err := repo.ensureOrganizationAI(ctx, tenantContext.OrganizationID); err != nil {
		return Settings{}, err
	}
	return repo.loadSettings(ctx, tenantContext.OrganizationID)
}

func (repo Repository) UpdateSettings(ctx context.Context, tenantContext tenant.Context, input SettingsInput) (Settings, error) {
	if tenantContext.OrganizationID == "" || !canManageAI(tenantContext) {
		return Settings{}, ErrPermission
	}
	if err := repo.ensureOrganizationAI(ctx, tenantContext.OrganizationID); err != nil {
		return Settings{}, err
	}
	input, err := input.Validate(tenantContext.IsSuperAdmin)
	if err != nil {
		return Settings{}, err
	}

	current, err := repo.loadSettings(ctx, tenantContext.OrganizationID)
	if err != nil {
		return Settings{}, err
	}

	isEnabled := current.IsEnabled
	if input.IsEnabled != nil {
		isEnabled = *input.IsEnabled
	}
	maxAgents := current.MaxAgents
	if tenantContext.IsSuperAdmin && input.MaxAgents != nil {
		maxAgents = *input.MaxAgents
	}
	maxSessions := current.MaxSessions
	if tenantContext.IsSuperAdmin && input.MaxSessions != nil {
		maxSessions = *input.MaxSessions
	}
	monthlyTokenLimit := current.MonthlyTokenLimit
	if tenantContext.IsSuperAdmin && input.MonthlyTokenLimit != nil {
		monthlyTokenLimit = *input.MonthlyTokenLimit
	}
	defaultTriageAgentID := current.DefaultTriageAgentID
	if input.DefaultTriageAgentID != nil {
		defaultTriageAgentID = strings.TrimSpace(*input.DefaultTriageAgentID)
		if defaultTriageAgentID != "" {
			if ok, err := repo.aiAgentAvailable(ctx, tenantContext.OrganizationID, defaultTriageAgentID); err != nil {
				return Settings{}, err
			} else if !ok {
				return Settings{}, ErrAgentNotFound
			}
		}
	}
	triagePrompt := current.TriagePrompt
	if input.TriagePrompt != nil {
		triagePrompt = *input.TriagePrompt
	}
	allowedTools := current.AllowedTools
	if len(input.AllowedTools) > 0 {
		allowedTools = input.AllowedTools
	}
	guardrails := current.Guardrails
	if len(input.Guardrails) > 0 {
		guardrails = input.Guardrails
	}

	_, err = repo.db.Pool().Exec(ctx, `
		update public.organization_ai_settings
		set is_enabled = $2,
		    max_agents = $3,
		    max_sessions = $4,
		    monthly_token_limit = $5,
		    default_triage_agent_id = nullif($6, '')::uuid,
		    triage_prompt = $7,
		    allowed_tools = $8::text[],
		    guardrails = $9::jsonb,
		    updated_at = now()
		where organization_id = $1::uuid
	`, tenantContext.OrganizationID, isEnabled, maxAgents, maxSessions, monthlyTokenLimit, defaultTriageAgentID, triagePrompt, allowedTools, jsonb(guardrails))
	if err != nil {
		return Settings{}, err
	}
	return repo.loadSettings(ctx, tenantContext.OrganizationID)
}

func (repo Repository) AdminUpdateSettings(ctx context.Context, tenantContext tenant.Context, organizationID string, input SettingsInput) (Settings, error) {
	if !tenantContext.IsSuperAdmin {
		return Settings{}, ErrPermission
	}
	organizationID, ok := normalizeUUID(organizationID)
	if !ok {
		return Settings{}, ErrInvalidInput
	}
	adminTenant := tenantContext
	adminTenant.OrganizationID = organizationID
	if err := repo.ensureOrganizationAI(ctx, organizationID); err != nil {
		return Settings{}, err
	}
	return repo.UpdateSettings(ctx, adminTenant, input)
}

func (repo Repository) ListOrganizationAgents(ctx context.Context, tenantContext tenant.Context) ([]Agent, error) {
	if tenantContext.OrganizationID == "" {
		return nil, ErrPermission
	}
	if err := repo.ensureOrganizationAI(ctx, tenantContext.OrganizationID); err != nil {
		return nil, err
	}
	rows, err := repo.db.Pool().Query(ctx, `
		select id::text, organization_id::text, name, description, status, config, created_at, updated_at
		from public.ai_agents
		where organization_id = $1::uuid
		order by coalesce((config->>'isDefault')::boolean, false) desc, created_at asc
	`, tenantContext.OrganizationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []Agent{}
	for rows.Next() {
		item, err := scanAgent(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (repo Repository) CreateOrganizationAgent(ctx context.Context, tenantContext tenant.Context, input AgentInput) (Agent, error) {
	if tenantContext.OrganizationID == "" || !canManageAI(tenantContext) {
		return Agent{}, ErrPermission
	}
	if err := repo.ensureOrganizationAI(ctx, tenantContext.OrganizationID); err != nil {
		return Agent{}, err
	}
	settings, err := repo.loadSettings(ctx, tenantContext.OrganizationID)
	if err != nil {
		return Agent{}, err
	}
	if settings.AgentCount >= settings.MaxAgents {
		return Agent{}, ErrLimitExceeded
	}
	input.OrganizationID = tenantContext.OrganizationID
	input, err = input.Validate()
	if err != nil {
		return Agent{}, err
	}
	input.Config.IsDefault = false

	var id string
	err = repo.db.Pool().QueryRow(ctx, `
		insert into public.ai_agents (organization_id, name, description, status, config)
		values ($1::uuid, $2, nullif($3, ''), $4, $5::jsonb)
		returning id::text
	`, tenantContext.OrganizationID, input.Name, input.Description, input.Status, jsonb(input.Config)).Scan(&id)
	if err != nil {
		return Agent{}, err
	}
	return repo.GetOrganizationAgentByID(ctx, tenantContext, id)
}

func (repo Repository) UpdateOrganizationAgent(ctx context.Context, tenantContext tenant.Context, id string, input AgentInput) (Agent, error) {
	if tenantContext.OrganizationID == "" || !canManageAI(tenantContext) {
		return Agent{}, ErrPermission
	}
	input.OrganizationID = tenantContext.OrganizationID
	input, err := input.Validate()
	if err != nil {
		return Agent{}, err
	}
	current, err := repo.GetOrganizationAgentByID(ctx, tenantContext, id)
	if err != nil {
		return Agent{}, err
	}
	if current.Config.IsDefault {
		input.Config.IsDefault = true
	}
	tag, err := repo.db.Pool().Exec(ctx, `
		update public.ai_agents
		set name = $3,
		    description = nullif($4, ''),
		    status = $5,
		    config = $6::jsonb,
		    updated_at = now()
		where id = $1::uuid
		  and organization_id = $2::uuid
	`, id, tenantContext.OrganizationID, input.Name, input.Description, input.Status, jsonb(input.Config))
	if err != nil {
		return Agent{}, err
	}
	if tag.RowsAffected() == 0 {
		return Agent{}, ErrAgentNotFound
	}
	return repo.GetOrganizationAgentByID(ctx, tenantContext, id)
}

func (repo Repository) DeleteOrganizationAgent(ctx context.Context, tenantContext tenant.Context, id string) error {
	if tenantContext.OrganizationID == "" || !canManageAI(tenantContext) {
		return ErrPermission
	}
	current, err := repo.GetOrganizationAgentByID(ctx, tenantContext, id)
	if err != nil {
		return err
	}
	if current.Config.IsDefault && current.Config.Type == "triage" {
		return ErrInvalidInput
	}
	tag, err := repo.db.Pool().Exec(ctx, `
		delete from public.ai_agents
		where id = $1::uuid
		  and organization_id = $2::uuid
	`, id, tenantContext.OrganizationID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrAgentNotFound
	}
	return nil
}

func (repo Repository) CreateAgent(ctx context.Context, tenantContext tenant.Context, input AgentInput) (Agent, error) {
	if !tenantContext.IsSuperAdmin {
		return Agent{}, ErrPermission
	}
	input, err := input.Validate()
	if err != nil {
		return Agent{}, err
	}

	var id string
	err = repo.db.Pool().QueryRow(ctx, `
		insert into public.ai_agents (organization_id, name, description, status, config)
		values (nullif($1, '')::uuid, $2, nullif($3, ''), $4, $5::jsonb)
		returning id::text
	`, input.OrganizationID, input.Name, input.Description, input.Status, jsonb(input.Config)).Scan(&id)
	if err != nil {
		return Agent{}, err
	}
	return repo.GetAgentByID(ctx, tenantContext, id)
}

func (repo Repository) UpdateAgent(ctx context.Context, tenantContext tenant.Context, id string, input AgentInput) (Agent, error) {
	if !tenantContext.IsSuperAdmin {
		return Agent{}, ErrPermission
	}
	input, err := input.Validate()
	if err != nil {
		return Agent{}, err
	}
	tag, err := repo.db.Pool().Exec(ctx, `
		update public.ai_agents
		set organization_id = nullif($2, '')::uuid,
		    name = $3,
		    description = nullif($4, ''),
		    status = $5,
		    config = $6::jsonb,
		    updated_at = now()
		where id = $1::uuid
	`, id, input.OrganizationID, input.Name, input.Description, input.Status, jsonb(input.Config))
	if err != nil {
		return Agent{}, err
	}
	if tag.RowsAffected() == 0 {
		return Agent{}, ErrAgentNotFound
	}
	return repo.GetAgentByID(ctx, tenantContext, id)
}

func (repo Repository) DeleteAgent(ctx context.Context, tenantContext tenant.Context, id string) error {
	if !tenantContext.IsSuperAdmin {
		return ErrPermission
	}
	tag, err := repo.db.Pool().Exec(ctx, `delete from public.ai_agents where id = $1::uuid`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrAgentNotFound
	}
	return nil
}

func (repo Repository) GetAgentByID(ctx context.Context, tenantContext tenant.Context, id string) (Agent, error) {
	agent, err := scanAgent(repo.db.Pool().QueryRow(ctx, `
		select id::text, organization_id::text, name, description, status, config, created_at, updated_at
		from public.ai_agents
		where id = $1::uuid
		limit 1
	`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return Agent{}, ErrAgentNotFound
	}
	return agent, err
}

func (repo Repository) GetOrganizationAgentByID(ctx context.Context, tenantContext tenant.Context, id string) (Agent, error) {
	agent, err := scanAgent(repo.db.Pool().QueryRow(ctx, `
		select id::text, organization_id::text, name, description, status, config, created_at, updated_at
		from public.ai_agents
		where id = $1::uuid
		  and organization_id = $2::uuid
		limit 1
	`, id, tenantContext.OrganizationID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Agent{}, ErrAgentNotFound
	}
	return agent, err
}

func (repo Repository) ListRoutingRules(ctx context.Context, tenantContext tenant.Context) ([]RoutingRule, error) {
	if tenantContext.OrganizationID == "" {
		return nil, ErrPermission
	}
	if err := repo.ensureOrganizationAI(ctx, tenantContext.OrganizationID); err != nil {
		return nil, err
	}
	rows, err := repo.db.Pool().Query(ctx, `
		select
			r.id::text,
			r.organization_id::text,
			r.agent_id::text,
			coalesce(a.name, ''),
			coalesce(a.config->>'type', ''),
			r.name,
			r.priority,
			r.is_enabled,
			r.action,
			r.conditions,
			r.created_at,
			r.updated_at
		from public.ai_routing_rules r
		join public.ai_agents a on a.id = r.agent_id
		where r.organization_id = $1::uuid
		order by r.priority asc, r.created_at asc
	`, tenantContext.OrganizationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []RoutingRule{}
	for rows.Next() {
		item, err := scanRoutingRule(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (repo Repository) CreateRoutingRule(ctx context.Context, tenantContext tenant.Context, input RoutingRuleInput) (RoutingRule, error) {
	if tenantContext.OrganizationID == "" || !canManageAI(tenantContext) {
		return RoutingRule{}, ErrPermission
	}
	if err := repo.ensureOrganizationAI(ctx, tenantContext.OrganizationID); err != nil {
		return RoutingRule{}, err
	}
	input, err := input.Validate()
	if err != nil {
		return RoutingRule{}, err
	}
	if ok, err := repo.aiAgentAvailable(ctx, tenantContext.OrganizationID, input.AgentID); err != nil {
		return RoutingRule{}, err
	} else if !ok {
		return RoutingRule{}, ErrAgentNotFound
	}
	enabled := true
	if input.IsEnabled != nil {
		enabled = *input.IsEnabled
	}

	var id string
	err = repo.db.Pool().QueryRow(ctx, `
		insert into public.ai_routing_rules (organization_id, agent_id, name, priority, is_enabled, action, conditions)
		values ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::jsonb)
		returning id::text
	`, tenantContext.OrganizationID, input.AgentID, input.Name, input.Priority, enabled, input.Action, jsonb(input.Conditions)).Scan(&id)
	if err != nil {
		return RoutingRule{}, err
	}
	return repo.GetRoutingRuleByID(ctx, tenantContext, id)
}

func (repo Repository) UpdateRoutingRule(ctx context.Context, tenantContext tenant.Context, id string, input RoutingRuleInput) (RoutingRule, error) {
	if tenantContext.OrganizationID == "" || !canManageAI(tenantContext) {
		return RoutingRule{}, ErrPermission
	}
	input, err := input.Validate()
	if err != nil {
		return RoutingRule{}, err
	}
	if ok, err := repo.aiAgentAvailable(ctx, tenantContext.OrganizationID, input.AgentID); err != nil {
		return RoutingRule{}, err
	} else if !ok {
		return RoutingRule{}, ErrAgentNotFound
	}
	enabled := true
	if input.IsEnabled != nil {
		enabled = *input.IsEnabled
	}
	tag, err := repo.db.Pool().Exec(ctx, `
		update public.ai_routing_rules
		set agent_id = $3::uuid,
		    name = $4,
		    priority = $5,
		    is_enabled = $6,
		    action = $7,
		    conditions = $8::jsonb,
		    updated_at = now()
		where id = $1::uuid
		  and organization_id = $2::uuid
	`, id, tenantContext.OrganizationID, input.AgentID, input.Name, input.Priority, enabled, input.Action, jsonb(input.Conditions))
	if err != nil {
		return RoutingRule{}, err
	}
	if tag.RowsAffected() == 0 {
		return RoutingRule{}, ErrRuleNotFound
	}
	return repo.GetRoutingRuleByID(ctx, tenantContext, id)
}

func (repo Repository) DeleteRoutingRule(ctx context.Context, tenantContext tenant.Context, id string) error {
	if tenantContext.OrganizationID == "" || !canManageAI(tenantContext) {
		return ErrPermission
	}
	tag, err := repo.db.Pool().Exec(ctx, `
		delete from public.ai_routing_rules
		where id = $1::uuid
		  and organization_id = $2::uuid
	`, id, tenantContext.OrganizationID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrRuleNotFound
	}
	return nil
}

func (repo Repository) GetRoutingRuleByID(ctx context.Context, tenantContext tenant.Context, id string) (RoutingRule, error) {
	item, err := scanRoutingRule(repo.db.Pool().QueryRow(ctx, `
		select
			r.id::text,
			r.organization_id::text,
			r.agent_id::text,
			coalesce(a.name, ''),
			coalesce(a.config->>'type', ''),
			r.name,
			r.priority,
			r.is_enabled,
			r.action,
			r.conditions,
			r.created_at,
			r.updated_at
		from public.ai_routing_rules r
		join public.ai_agents a on a.id = r.agent_id
		where r.id = $1::uuid
		  and r.organization_id = $2::uuid
		limit 1
	`, id, tenantContext.OrganizationID))
	if errors.Is(err, pgx.ErrNoRows) {
		return RoutingRule{}, ErrRuleNotFound
	}
	return item, err
}

func (repo Repository) ListRunnableAgents(ctx context.Context, organizationID string) ([]Agent, error) {
	if err := repo.ensureOrganizationAI(ctx, organizationID); err != nil {
		return nil, err
	}
	rows, err := repo.db.Pool().Query(ctx, `
		with org_agents as (
			select count(*)::int as total
			from public.ai_agents
			where organization_id = $1::uuid
			  and status = 'active'
		)
		select id::text, organization_id::text, name, description, status, config, created_at, updated_at
		from public.ai_agents
		where status = 'active'
		  and (
		    organization_id = $1::uuid
		    or (
		      organization_id is null
		      and (select total from org_agents) = 0
		    )
		  )
		order by (organization_id is null) asc, created_at asc
	`, organizationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []Agent{}
	for rows.Next() {
		item, err := scanAgent(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (repo Repository) LoadLeadContext(ctx context.Context, tenantContext tenant.Context, leadID string, message string) (LeadContext, error) {
	context := LeadContext{}
	if leadID != "" {
		lead, err := repo.loadLead(ctx, tenantContext.OrganizationID, leadID)
		if err != nil {
			return context, err
		}
		context.Lead = lead

		activities, err := repo.loadLeadActivities(ctx, tenantContext.OrganizationID, leadID)
		if err != nil {
			return context, err
		}
		context.Activities = activities
	}

	properties, err := repo.searchProperties(ctx, tenantContext.OrganizationID, message, context.Lead)
	if err != nil {
		return context, err
	}
	context.Properties = properties
	return context, nil
}

func (repo Repository) loadSettings(ctx context.Context, organizationID string) (Settings, error) {
	var item Settings
	var defaultTriageAgentID pgtype.Text
	var guardrailsPayload []byte
	err := repo.db.Pool().QueryRow(ctx, `
		select
			s.organization_id::text,
			s.is_enabled,
			s.max_agents,
			s.max_sessions,
			s.monthly_token_limit,
			s.default_triage_agent_id::text,
			s.triage_prompt,
			s.allowed_tools,
			s.guardrails,
			(select count(*)::int from public.ai_agents a where a.organization_id = s.organization_id),
			(
				select count(*)::int
				from public.whatsapp_sessions ws
				where ws.organization_id = s.organization_id
				  and coalesce(ws.is_active, true) = true
				  and lower(coalesce(ws.advanced_settings->>'ai_auto_reply_enabled', 'false')) in ('true', '1', 'yes', 'sim')
			)
		from public.organization_ai_settings s
		where s.organization_id = $1::uuid
		limit 1
	`, organizationID).Scan(
		&item.OrganizationID,
		&item.IsEnabled,
		&item.MaxAgents,
		&item.MaxSessions,
		&item.MonthlyTokenLimit,
		&defaultTriageAgentID,
		&item.TriagePrompt,
		&item.AllowedTools,
		&guardrailsPayload,
		&item.AgentCount,
		&item.ActiveSessionCount,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return Settings{}, ErrInvalidInput
	}
	if err != nil {
		return Settings{}, err
	}
	item.DefaultTriageAgentID = textValue(defaultTriageAgentID)
	item.Guardrails = map[string]any{}
	if len(guardrailsPayload) > 0 {
		_ = json.Unmarshal(guardrailsPayload, &item.Guardrails)
	}
	if item.AllowedTools == nil {
		item.AllowedTools = []string{}
	}
	return item, nil
}

func (repo Repository) ensureOrganizationAI(ctx context.Context, organizationID string) error {
	organizationID, ok := normalizeUUID(organizationID)
	if !ok {
		return ErrInvalidInput
	}
	moduleEnabled, err := repo.organizationAIModuleEnabled(ctx, organizationID)
	if err != nil {
		return err
	}
	defaultPrompt := defaultAgents()[0].Config.Prompt
	if _, err := repo.db.Pool().Exec(ctx, `
		insert into public.organization_ai_settings (organization_id, is_enabled, triage_prompt)
		values ($1::uuid, $2, $3)
		on conflict (organization_id) do nothing
	`, organizationID, moduleEnabled, defaultPrompt); err != nil {
		return err
	}

	var count int
	if err := repo.db.Pool().QueryRow(ctx, `
		select count(*)::int
		from public.ai_agents
		where organization_id = $1::uuid
	`, organizationID).Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return nil
	}

	defaultTriageID := ""
	for _, input := range defaultAgents() {
		input.OrganizationID = organizationID
		var id string
		if err := repo.db.Pool().QueryRow(ctx, `
			insert into public.ai_agents (organization_id, name, description, status, config)
			values ($1::uuid, $2, nullif($3, ''), $4, $5::jsonb)
			returning id::text
		`, organizationID, input.Name, input.Description, input.Status, jsonb(input.Config)).Scan(&id); err != nil {
			return err
		}
		if input.Config.Type == "triage" && input.Config.IsDefault {
			defaultTriageID = id
		}
	}
	if defaultTriageID != "" {
		_, err = repo.db.Pool().Exec(ctx, `
			update public.organization_ai_settings
			set default_triage_agent_id = $2::uuid,
			    updated_at = now()
			where organization_id = $1::uuid
		`, organizationID, defaultTriageID)
		return err
	}
	return nil
}

func (repo Repository) organizationAIModuleEnabled(ctx context.Context, organizationID string) (bool, error) {
	var enabled bool
	err := repo.db.Pool().QueryRow(ctx, `
		select exists (
			select 1
			from public.organization_modules
			where organization_id = $1::uuid
			  and module_name = any(array['ai_agent', 'ai'])
			  and coalesce(is_enabled, false) = true
		)
	`, organizationID).Scan(&enabled)
	return enabled, err
}

func (repo Repository) aiAgentAvailable(ctx context.Context, organizationID string, agentID string) (bool, error) {
	var exists bool
	err := repo.db.Pool().QueryRow(ctx, `
		select exists (
			select 1
			from public.ai_agents
			where id = $1::uuid
			  and (organization_id = $2::uuid or organization_id is null)
			  and status <> 'draft'
		)
	`, agentID, organizationID).Scan(&exists)
	return exists, err
}

func (repo Repository) MatchRoutingRule(ctx context.Context, tenantContext tenant.Context, request RunRequest, contextData LeadContext, agents []Agent) (*RoutingRule, Agent, error) {
	rows, err := repo.db.Pool().Query(ctx, `
		select
			r.id::text,
			r.organization_id::text,
			r.agent_id::text,
			coalesce(a.name, ''),
			coalesce(a.config->>'type', ''),
			r.name,
			r.priority,
			r.is_enabled,
			r.action,
			r.conditions,
			r.created_at,
			r.updated_at
		from public.ai_routing_rules r
		join public.ai_agents a on a.id = r.agent_id
		where r.organization_id = $1::uuid
		  and r.is_enabled = true
		order by r.priority asc, r.created_at asc
	`, tenantContext.OrganizationID)
	if err != nil {
		return nil, Agent{}, err
	}
	defer rows.Close()

	byID := map[string]Agent{}
	for _, agent := range agents {
		byID[agent.ID] = agent
	}

	for rows.Next() {
		rule, err := scanRoutingRule(rows)
		if err != nil {
			return nil, Agent{}, err
		}
		if !routingRuleMatches(rule, request, contextData) {
			continue
		}
		agent := byID[rule.AgentID]
		if agent.ID == "" || rule.Action == "ignore" || rule.Action == "require_human" {
			return &rule, Agent{}, nil
		}
		return &rule, agent, nil
	}
	if err := rows.Err(); err != nil {
		return nil, Agent{}, err
	}
	return nil, Agent{}, nil
}

func routingRuleMatches(rule RoutingRule, request RunRequest, contextData LeadContext) bool {
	conditions := rule.Conditions
	if len(conditions) == 0 {
		return true
	}
	if values := stringListFromAny(conditions["sessionIds"]); len(values) > 0 && !containsFold(values, request.SessionID) {
		return false
	}
	if values := stringListFromAny(conditions["sources"]); len(values) > 0 && !containsFold(values, firstNonEmpty(request.Source, leadString(contextData.Lead, "source"))) {
		return false
	}
	if values := stringListFromAny(conditions["pipelineIds"]); len(values) > 0 && !containsFold(values, leadString(contextData.Lead, "pipeline_id")) {
		return false
	}
	if values := stringListFromAny(conditions["stageIds"]); len(values) > 0 && !containsFold(values, leadString(contextData.Lead, "stage_id")) {
		return false
	}
	if values := stringListFromAny(conditions["pipelineNames"]); len(values) > 0 && !containsText(values, leadString(contextData.Lead, "pipeline_name")) {
		return false
	}
	if values := stringListFromAny(conditions["messageContains"]); len(values) > 0 && !containsText(values, request.Message) {
		return false
	}
	return true
}

func (repo Repository) Metrics(ctx context.Context, tenantContext tenant.Context) (Metrics, error) {
	if tenantContext.OrganizationID == "" {
		return Metrics{}, ErrPermission
	}

	var metrics Metrics
	err := repo.db.Pool().QueryRow(ctx, `
		with ai_sessions as (
			select id
			from public.whatsapp_sessions
			where organization_id = $1::uuid
			  and coalesce(is_active, true) = true
			  and coalesce(status, '') = 'connected'
			  and lower(coalesce(advanced_settings->>'ai_auto_reply_enabled', 'false')) in ('true', '1', 'yes', 'sim')
		),
		period as (
			select now() - interval '30 days' as start_at
		)
		select
			coalesce((
				select count(distinct wc.id)::bigint
				from public.whatsapp_conversations wc
				join ai_sessions ais on ais.id = wc.session_id
				cross join period p
				where wc.created_at >= p.start_at
				  and wc.deleted_at is null
				  and wc.is_group = false
				  and wc.lead_id is not null
			), 0)::bigint as leads_received,
			coalesce((
				select count(distinct wm.conversation_id)::bigint
				from public.whatsapp_messages wm
				join ai_sessions ais on ais.id = wm.session_id
				cross join period p
				where wm.created_at >= p.start_at
				  and wm.metadata->>'ai_generated' = 'true'
			), 0)::bigint as leads_attended,
			coalesce((
				select count(distinct l.id)::bigint
				from public.leads l
				join public.whatsapp_conversations wc on wc.lead_id = l.id
				join ai_sessions ais on ais.id = wc.session_id
				where l.organization_id = $1::uuid
				  and coalesce(l.deal_status, 'open') = 'open'
				  and l.next_follow_up_at is not null
				  and l.next_follow_up_at >= now()
			), 0)::bigint as followups_active
	`, tenantContext.OrganizationID).Scan(&metrics.LeadsReceived, &metrics.LeadsAttended, &metrics.FollowUpsActive)
	if err != nil {
		return Metrics{}, err
	}

	rows, err := repo.db.Pool().Query(ctx, `
		with days as (
			select generate_series(
				date_trunc('day', now()) - interval '13 days',
				date_trunc('day', now()),
				interval '1 day'
			)::date as day
		),
		ai_sessions as (
			select id
			from public.whatsapp_sessions
			where organization_id = $1::uuid
			  and coalesce(is_active, true) = true
			  and coalesce(status, '') = 'connected'
			  and lower(coalesce(advanced_settings->>'ai_auto_reply_enabled', 'false')) in ('true', '1', 'yes', 'sim')
		),
		received as (
			select wc.created_at::date as day, count(distinct wc.id)::bigint as total
			from public.whatsapp_conversations wc
			join ai_sessions ais on ais.id = wc.session_id
			where wc.deleted_at is null
			  and wc.is_group = false
			  and wc.lead_id is not null
			  and wc.created_at >= date_trunc('day', now()) - interval '13 days'
			group by wc.created_at::date
		),
		attended as (
			select wm.created_at::date as day, count(distinct wm.conversation_id)::bigint as total
			from public.whatsapp_messages wm
			join ai_sessions ais on ais.id = wm.session_id
			where wm.metadata->>'ai_generated' = 'true'
			  and wm.created_at >= date_trunc('day', now()) - interval '13 days'
			group by wm.created_at::date
		),
		followups as (
			select l.next_follow_up_at::date as day, count(distinct l.id)::bigint as total
			from public.leads l
			join public.whatsapp_conversations wc on wc.lead_id = l.id
			join ai_sessions ais on ais.id = wc.session_id
			where l.organization_id = $1::uuid
			  and coalesce(l.deal_status, 'open') = 'open'
			  and l.next_follow_up_at is not null
			  and l.next_follow_up_at >= date_trunc('day', now()) - interval '13 days'
			group by l.next_follow_up_at::date
		)
		select
			to_char(days.day, 'YYYY-MM-DD') as date,
			to_char(days.day, 'DD/MM') as label,
			coalesce(received.total, 0)::bigint as leads_received,
			coalesce(attended.total, 0)::bigint as leads_attended,
			coalesce(followups.total, 0)::bigint as followups_active
		from days
		left join received on received.day = days.day
		left join attended on attended.day = days.day
		left join followups on followups.day = days.day
		order by days.day asc
	`, tenantContext.OrganizationID)
	if err != nil {
		return Metrics{}, err
	}
	defer rows.Close()

	metrics.Series = []MetricPoint{}
	for rows.Next() {
		var point MetricPoint
		if err := rows.Scan(&point.Date, &point.Label, &point.LeadsReceived, &point.LeadsAttended, &point.FollowUpsActive); err != nil {
			return Metrics{}, err
		}
		metrics.Series = append(metrics.Series, point)
	}
	if err := rows.Err(); err != nil {
		return Metrics{}, err
	}

	return metrics, nil
}

func (repo Repository) ListEvents(ctx context.Context, tenantContext tenant.Context) ([]Event, error) {
	if tenantContext.OrganizationID == "" {
		return nil, ErrPermission
	}

	rows, err := repo.db.Pool().Query(ctx, `
		select
			id::text,
			event_type,
			status,
			coalesce(payload, '{}'::jsonb)::text,
			created_at,
			processed_at
		from public.events
		where organization_id = $1::uuid
		  and (
		    entity_type = 'ai'
		    or event_type like 'ai.%'
		    or event_type like 'ai_%'
		    or event_type like 'whatsapp.ai_%'
		  )
		order by created_at desc, id desc
		limit 40
	`, tenantContext.OrganizationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []Event{}
	for rows.Next() {
		var item Event
		var payloadJSON string
		var processedAt pgtype.Timestamptz
		if err := rows.Scan(&item.ID, &item.EventType, &item.Status, &payloadJSON, &item.CreatedAt, &processedAt); err != nil {
			return nil, err
		}
		item.Payload = map[string]any{}
		_ = json.Unmarshal([]byte(payloadJSON), &item.Payload)
		if processedAt.Valid {
			item.ProcessedAt = &processedAt.Time
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (repo Repository) SaveAIEvent(ctx context.Context, tenantContext tenant.Context, eventType string, payload map[string]any) {
	_, _ = repo.db.Pool().Exec(ctx, `
		insert into public.events (organization_id, event_type, entity_type, entity_id, payload, status)
		values ($1::uuid, $2, 'ai', null, $3::jsonb, 'processed')
	`, tenantContext.OrganizationID, eventType, jsonb(payload))
}

func (repo Repository) SaveConversationState(ctx context.Context, tenantContext tenant.Context, conversationID string, responseID string, memory map[string]any) {
	if strings.TrimSpace(conversationID) == "" {
		return
	}
	activeAgentID, _ := memory["activeAgentId"].(string)
	leadID, _ := memory["leadId"].(string)
	activeAgentType, _ := memory["activeAgentType"].(string)
	triageStatus := "pending"
	if activeAgentType != "" && activeAgentType != "triage" {
		triageStatus = "completed"
	}
	handoffHistory := []any{}
	if handoff, ok := memory["handoff"]; ok && handoff != nil {
		handoffHistory = append(handoffHistory, handoff)
	}
	_, _ = repo.db.Pool().Exec(ctx, `
		insert into public.conversation_ai_state (
			organization_id,
			lead_id,
			conversation_id,
			last_response_id,
			memory,
			active_agent_id,
			triage_status,
			handoff_history
		)
		values ($1::uuid, nullif($5, '')::uuid, $2::uuid, nullif($3, ''), $4::jsonb, nullif($6, '')::uuid, $7, $8::jsonb)
		on conflict (organization_id, conversation_id)
		do update set last_response_id = excluded.last_response_id,
		              lead_id = coalesce(excluded.lead_id, conversation_ai_state.lead_id),
		              memory = excluded.memory,
		              active_agent_id = excluded.active_agent_id,
		              triage_status = excluded.triage_status,
		              handoff_history = case
		                when excluded.handoff_history = '[]'::jsonb then conversation_ai_state.handoff_history
		                else coalesce(conversation_ai_state.handoff_history, '[]'::jsonb) || excluded.handoff_history
		              end,
		              updated_at = now()
	`, tenantContext.OrganizationID, conversationID, responseID, jsonb(memory), leadID, activeAgentID, triageStatus, jsonb(handoffHistory))
}

func (repo Repository) loadLead(ctx context.Context, organizationID string, leadID string) (map[string]any, error) {
	var payload []byte
	err := repo.db.Pool().QueryRow(ctx, `
		select to_jsonb(row) from (
			select
				l.id::text,
				l.name,
				l.email,
				l.phone,
				l.source,
				l.status,
				l.deal_status,
				l.property_code,
				l.valor_interesse::text as interest_value,
				l.faixa_valor_imovel,
				l.renda_familiar,
				l.finalidade_compra,
				l.created_at,
				l.pipeline_id::text,
				l.stage_id::text,
				s.name as stage_name,
				p.name as pipeline_name,
				u.name as assigned_user_name
			from public.leads l
			left join public.stages s on s.id = l.stage_id
			left join public.pipelines p on p.id = l.pipeline_id
			left join public.users u on u.id = l.assigned_user_id
			where l.organization_id = $1::uuid
			  and l.id = $2::uuid
			limit 1
		) row
	`, organizationID, leadID).Scan(&payload)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrInvalidInput
	}
	if err != nil {
		return nil, err
	}
	out := map[string]any{}
	_ = json.Unmarshal(payload, &out)
	return out, nil
}

func (repo Repository) loadLeadActivities(ctx context.Context, organizationID string, leadID string) ([]map[string]any, error) {
	rows, err := repo.db.Pool().Query(ctx, `
		select to_jsonb(row) from (
			select a.type, a.content, a.metadata, a.created_at, u.name as user_name
			from public.activities a
			left join public.users u on u.id = a.user_id
			where a.organization_id = $1::uuid
			  and a.lead_id = $2::uuid
			order by a.created_at desc
			limit 12
		) row
	`, organizationID, leadID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []map[string]any{}
	for rows.Next() {
		var payload []byte
		if err := rows.Scan(&payload); err != nil {
			return nil, err
		}
		item := map[string]any{}
		_ = json.Unmarshal(payload, &item)
		items = append(items, item)
	}
	return items, rows.Err()
}

func (repo Repository) searchProperties(ctx context.Context, organizationID string, message string, lead map[string]any) ([]map[string]any, error) {
	propertyCode := ""
	if lead != nil {
		if value, ok := lead["property_code"].(string); ok {
			propertyCode = strings.TrimSpace(value)
		}
	}
	searchTerms := propertySearchTerms(message, lead)
	rows, err := repo.db.Pool().Query(ctx, `
		select to_jsonb(row) from (
			select
				id::text,
				code,
				title,
				tipo_de_imovel as property_type,
				coalesce(finalidade, tipo_de_negocio) as modality,
				preco::text as sale_price,
				cidade as city,
				bairro as neighborhood,
				quartos as bedrooms,
				suites,
				vagas as parking_spaces
			from public.properties
			where organization_id = $1::uuid
			  and coalesce(is_demo, false) = false
			  and lower(coalesce(status, 'ativo')) in ('ativo', 'active')
			  and (
				($2 <> '' and code ilike '%' || $2 || '%')
				or exists (
					select 1
					from unnest($3::text[]) term
					where lower(concat_ws(' ', title, cidade, bairro, tipo_de_imovel, tipo_de_negocio, finalidade)) like '%' || term || '%'
				)
			  )
			order by updated_at desc nulls last, created_at desc
			limit 5
		) row
	`, organizationID, propertyCode, searchTerms)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []map[string]any{}
	for rows.Next() {
		var payload []byte
		if err := rows.Scan(&payload); err != nil {
			return nil, err
		}
		item := map[string]any{}
		_ = json.Unmarshal(payload, &item)
		items = append(items, item)
	}
	return items, rows.Err()
}

func propertySearchTerms(message string, lead map[string]any) []string {
	builder := strings.Builder{}
	builder.WriteString(message)
	if lead != nil {
		for _, key := range []string{"city", "neighborhood", "property_code", "finalidade_compra"} {
			if value, ok := lead[key].(string); ok {
				builder.WriteByte(' ')
				builder.WriteString(value)
			}
		}
	}

	stopwords := map[string]struct{}{
		"agora": {}, "ajuda": {}, "ajudar": {}, "alguma": {}, "algum": {}, "aqui": {},
		"bom": {}, "boa": {}, "comprar": {}, "com": {}, "consegue": {}, "conseguem": {},
		"das": {}, "dos": {}, "de": {}, "do": {}, "em": {}, "entrada": {}, "estou": {},
		"financiar": {}, "financiamento": {}, "me": {}, "minha": {}, "ola": {}, "olá": {},
		"para": {}, "por": {}, "procurando": {}, "quero": {}, "sim": {}, "tem": {},
		"tenho": {}, "uma": {}, "um": {}, "voces": {}, "vocês": {}, "voce": {}, "você": {},
	}

	normalized := normalizeText(builder.String())
	parts := strings.FieldsFunc(normalized, func(value rune) bool {
		return !unicode.IsLetter(value) && !unicode.IsDigit(value)
	})

	terms := []string{}
	seen := map[string]struct{}{}
	for _, part := range parts {
		part = strings.ToLower(strings.TrimSpace(part))
		if part == "" {
			continue
		}
		if len([]rune(part)) < 3 && part != "bh" {
			continue
		}
		if _, skip := stopwords[part]; skip {
			continue
		}
		if _, exists := seen[part]; exists {
			continue
		}
		seen[part] = struct{}{}
		terms = append(terms, part)
		if len(terms) >= 12 {
			break
		}
	}
	return terms
}

func (repo Repository) ensureDefaultAgents(ctx context.Context) error {
	var count int
	if err := repo.db.Pool().QueryRow(ctx, `select count(*) from public.ai_agents`).Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return nil
	}

	for _, input := range defaultAgents() {
		if _, err := repo.db.Pool().Exec(ctx, `
			insert into public.ai_agents (name, description, status, config)
			values ($1, $2, $3, $4::jsonb)
		`, input.Name, input.Description, input.Status, jsonb(input.Config)); err != nil {
			return err
		}
	}
	return nil
}

func scanAgent(row interface{ Scan(dest ...any) error }) (Agent, error) {
	var item Agent
	var organizationID, description pgtype.Text
	var configPayload []byte
	err := row.Scan(&item.ID, &organizationID, &item.Name, &description, &item.Status, &configPayload, &item.CreatedAt, &item.UpdatedAt)
	if err != nil {
		return Agent{}, err
	}
	item.OrganizationID = textValue(organizationID)
	item.Description = textValue(description)
	if len(configPayload) > 0 {
		_ = json.Unmarshal(configPayload, &item.Config)
	}
	item.Config = normalizeAgentConfig(item.Config)
	return item, nil
}

func scanRoutingRule(row interface{ Scan(dest ...any) error }) (RoutingRule, error) {
	var item RoutingRule
	var conditionsPayload []byte
	err := row.Scan(
		&item.ID,
		&item.OrganizationID,
		&item.AgentID,
		&item.AgentName,
		&item.AgentType,
		&item.Name,
		&item.Priority,
		&item.IsEnabled,
		&item.Action,
		&conditionsPayload,
		&item.CreatedAt,
		&item.UpdatedAt,
	)
	if err != nil {
		return RoutingRule{}, err
	}
	item.Conditions = map[string]any{}
	if len(conditionsPayload) > 0 {
		_ = json.Unmarshal(conditionsPayload, &item.Conditions)
	}
	item.Action = normalizeRoutingAction(item.Action)
	return item, nil
}

func textValue(value pgtype.Text) string {
	if !value.Valid {
		return ""
	}
	return value.String
}

func normalizeUUID(value string) (string, bool) {
	var uuid pgtype.UUID
	if err := uuid.Scan(strings.TrimSpace(value)); err != nil {
		return "", false
	}
	if !uuid.Valid {
		return "", false
	}
	return uuid.String(), true
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func leadString(lead map[string]any, key string) string {
	if lead == nil {
		return ""
	}
	switch value := lead[key].(type) {
	case string:
		return strings.TrimSpace(value)
	default:
		return ""
	}
}

func stringListFromAny(value any) []string {
	switch typed := value.(type) {
	case []string:
		return cleanStringList(typed, 80, 180)
	case []any:
		items := []string{}
		for _, item := range typed {
			if text, ok := item.(string); ok {
				items = append(items, text)
			}
		}
		return cleanStringList(items, 80, 180)
	case string:
		return cleanStringList([]string{typed}, 80, 180)
	default:
		return []string{}
	}
}

func containsFold(values []string, target string) bool {
	target = strings.ToLower(strings.TrimSpace(target))
	if target == "" {
		return false
	}
	for _, value := range values {
		if strings.ToLower(strings.TrimSpace(value)) == target {
			return true
		}
	}
	return false
}

func containsText(values []string, target string) bool {
	target = normalizeText(target)
	if target == "" {
		return false
	}
	for _, value := range values {
		value = normalizeText(value)
		if value != "" && strings.Contains(target, value) {
			return true
		}
	}
	return false
}

func defaultAgents() []AgentInput {
	return []AgentInput{
		{
			Name:        "Triagem de atendimento",
			Description: "Primeiro atendimento, identifica intencao e direciona para especialistas.",
			Status:      "active",
			Config: AgentConfig{
				Type:            "triage",
				Model:           defaultModel,
				Temperature:     0.35,
				IsDefault:       true,
				AllowedTools:    []string{"getLeadContext", "searchProperties", "classifyLeadIntent"},
				HandoffTargets:  []string{"mcmv", "high_value", "launch"},
				RoutingKeywords: []string{"minha casa minha vida", "mcmv", "alto padrao", "luxo", "lancamento", "planta"},
				Prompt:          "Voce e a IA de triagem do Vimob CRM. Entenda o que o lead procura sem fazer perguntas roboticas. Classifique o perfil e peca apenas informacoes essenciais. Se identificar Minha Casa Minha Vida, alto padrao ou lancamento, transfira internamente para o especialista sem se apresentar novamente.",
			},
		},
		{
			Name:        "Especialista Minha Casa Minha Vida",
			Description: "Atendimento para leads de financiamento, renda, entrada, subsidio e imoveis economicos.",
			Status:      "active",
			Config: AgentConfig{
				Type:         "mcmv",
				Model:        defaultModel,
				Temperature:  0.3,
				AllowedTools: []string{"getLeadContext", "searchProperties", "draftWhatsAppMessage", "createFollowUpTask"},
				Prompt:       "Voce e especialista em Minha Casa Minha Vida. Explique com clareza renda, entrada, financiamento, subsidio e proximos passos. Nunca prometa aprovacao. Se faltar renda, composicao familiar ou entrada, pergunte de forma natural.",
			},
		},
		{
			Name:        "Especialista Alto Padrao",
			Description: "Atendimento consultivo para imoveis de maior ticket, investidores e alto padrao.",
			Status:      "active",
			Config: AgentConfig{
				Type:         "high_value",
				Model:        defaultModel,
				Temperature:  0.35,
				AllowedTools: []string{"getLeadContext", "searchProperties", "draftWhatsAppMessage", "createFollowUpTask"},
				Prompt:       "Voce e especialista em imoveis de alto padrao. Use uma abordagem consultiva, objetiva e discreta. Valorize localizacao, liquidez, privacidade, acabamento, seguranca e potencial de valorizacao.",
			},
		},
		{
			Name:        "Especialista Lancamentos",
			Description: "Atendimento para obras, fluxo de pagamento, tabela, unidades e valorizacao.",
			Status:      "active",
			Config: AgentConfig{
				Type:         "launch",
				Model:        defaultModel,
				Temperature:  0.35,
				AllowedTools: []string{"getLeadContext", "searchProperties", "draftWhatsAppMessage", "createFollowUpTask"},
				Prompt:       "Voce e especialista em lancamentos imobiliarios. Explique obra, entrega, tabela, unidades, fluxo de pagamento e valorizacao. Confirme interesse antes de sugerir visita ou proposta.",
			},
		},
	}
}
