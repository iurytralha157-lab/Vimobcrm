package ai

import (
	"context"
	"encoding/json"
	"errors"
	"strings"

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

func (repo Repository) ListRunnableAgents(ctx context.Context, organizationID string) ([]Agent, error) {
	if err := repo.ensureDefaultAgents(ctx); err != nil {
		return nil, err
	}
	rows, err := repo.db.Pool().Query(ctx, `
		select id::text, organization_id::text, name, description, status, config, created_at, updated_at
		from public.ai_agents
		where status = 'active'
		  and (organization_id is null or organization_id = $1::uuid)
		order by organization_id nulls first, created_at asc
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
	_, _ = repo.db.Pool().Exec(ctx, `
		insert into public.conversation_ai_state (organization_id, conversation_id, last_response_id, memory)
		values ($1::uuid, $2::uuid, nullif($3, ''), $4::jsonb)
		on conflict (organization_id, conversation_id)
		do update set last_response_id = excluded.last_response_id,
		              memory = excluded.memory,
		              updated_at = now()
	`, tenantContext.OrganizationID, conversationID, responseID, jsonb(memory))
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
	search := "%" + strings.ToLower(trimMax(message, 120)) + "%"
	propertyCode := ""
	if lead != nil {
		if value, ok := lead["property_code"].(string); ok {
			propertyCode = strings.TrimSpace(value)
		}
	}
	rows, err := repo.db.Pool().Query(ctx, `
		select to_jsonb(row) from (
			select id::text, code, title, property_type, modality, sale_price::text, city, neighborhood, bedrooms, suites, parking_spaces
			from public.properties
			where organization_id = $1::uuid
			  and (
				$2 = ''
				or code ilike '%' || $2 || '%'
				or lower(coalesce(title, '')) like $3
				or lower(coalesce(city, '')) like $3
				or lower(coalesce(neighborhood, '')) like $3
			  )
			order by updated_at desc nulls last, created_at desc
			limit 5
		) row
	`, organizationID, propertyCode, search)
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

func textValue(value pgtype.Text) string {
	if !value.Valid {
		return ""
	}
	return value.String
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
