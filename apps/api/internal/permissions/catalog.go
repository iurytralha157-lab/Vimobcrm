package permissions

import (
	"sort"
	"strings"
)

type Definition struct {
	Key         string
	Label       string
	Description string
	Domain      string
}

const (
	DashboardView          = "dashboard_view"
	DashboardSiteView      = "dashboard_site_view"
	DashboardCampaignsView = "dashboard_campaigns_view"
	LeadViewOwn            = "lead_view_own"
	LeadViewTeam           = "lead_view_team"
	LeadViewAll            = "lead_view_all"
	LeadOperate            = "lead_operate"
	LeadCreate             = "lead_create"
	LeadDelete             = "lead_delete"
	LeadImport             = "lead_import"
	LeadExport             = "lead_export"
	AttentionView          = "attention_view"
	WhatsAppView           = "whatsapp_view"
	WhatsAppOperate        = "whatsapp_operate"
	WhatsAppManage         = "whatsapp_manage"
	TeamView               = "team_view"
	TeamManage             = "team_manage"
	DistributionManage     = "distribution_manage"
	PipelineManage         = "pipeline_manage"
	TagManage              = "tag_manage"
	PropertyView           = "property_view"
	PropertyManage         = "property_manage"
	ScheduleView           = "schedule_view"
	ScheduleManage         = "schedule_manage"
	AutomationsView        = "automations_view"
	AutomationsManage      = "automations_manage"
	FinancialView          = "financial_view"
	FinancialManage        = "financial_manage"
	GamificationView       = "gamification_view"
	GamificationManage     = "gamification_manage"
	UsersManage            = "users_manage"
	PermissionsManage      = "permissions_manage"
	SettingsIntegrations   = "settings_integrations"
	SettingsOrganization   = "settings_organization"
	SettingsAI             = "settings_ai"
	SettingsSite           = "settings_site"
	SettingsBilling        = "settings_billing"
)

var catalog = []Definition{
	{DashboardView, "Ver dashboard geral", "Acessar o painel comercial no escopo permitido", "dashboard"},
	{DashboardSiteView, "Ver dashboard do site", "Acessar métricas e análises do site", "dashboard"},
	{DashboardCampaignsView, "Ver dashboard de campanhas", "Acessar métricas e análises de campanhas", "dashboard"},
	{LeadViewOwn, "Ver leads próprios", "Visualizar leads sob sua responsabilidade principal", "leads"},
	{LeadViewTeam, "Ver leads das equipes lideradas", "Visualizar leads vinculados às equipes que lidera", "leads"},
	{LeadViewAll, "Ver todos os leads", "Visualizar todos os leads da organização", "leads"},
	{LeadOperate, "Editar e operar leads", "Editar, mover, transferir, reabrir e classificar leads visíveis", "leads"},
	{LeadCreate, "Criar leads", "Criar novos leads manualmente", "leads"},
	{LeadDelete, "Excluir leads", "Excluir leads visíveis", "leads"},
	{LeadImport, "Importar leads", "Importar leads em massa", "leads"},
	{LeadExport, "Exportar leads", "Exportar leads e contatos", "leads"},
	{AttentionView, "Ver central de atenção", "Acessar alertas dos leads visíveis", "crm"},
	{WhatsAppView, "Ver conversas", "Visualizar conversas autorizadas", "conversations"},
	{WhatsAppOperate, "Operar conversas", "Enviar mensagens e organizar conversas autorizadas", "conversations"},
	{WhatsAppManage, "Gerenciar conexões", "Criar e administrar conexões do WhatsApp", "conversations"},
	{TeamView, "Ver equipes", "Visualizar equipes dentro do escopo permitido", "management"},
	{TeamManage, "Gerenciar equipes", "Editar membros e disponibilidade dentro do escopo permitido", "management"},
	{DistributionManage, "Gerenciar distribuição", "Criar e configurar listas e regras de distribuição", "management"},
	{PipelineManage, "Gerenciar pipelines", "Gerenciar pipelines, etapas, cadências e automações de etapa", "management"},
	{TagManage, "Gerenciar tags", "Criar, editar e excluir tags globais", "management"},
	{PropertyView, "Ver imóveis", "Visualizar o catálogo de imóveis", "properties"},
	{PropertyManage, "Gerenciar imóveis", "Criar, editar, atribuir e excluir imóveis", "properties"},
	{ScheduleView, "Ver agenda", "Visualizar eventos autorizados", "schedule"},
	{ScheduleManage, "Gerenciar agenda", "Criar, editar, concluir e excluir eventos autorizados", "schedule"},
	{AutomationsView, "Ver automações", "Visualizar automações e histórico", "automations"},
	{AutomationsManage, "Gerenciar automações", "Criar, editar e excluir automações", "automations"},
	{FinancialView, "Ver financeiro", "Visualizar dados financeiros", "financial"},
	{FinancialManage, "Gerenciar financeiro", "Criar e alterar dados financeiros", "financial"},
	{GamificationView, "Ver gamificação", "Visualizar arena, ranking e histórico", "gamification"},
	{GamificationManage, "Configurar gamificação", "Gerenciar regras, missões e temporadas", "gamification"},
	{UsersManage, "Gerenciar usuários", "Convidar, editar, desativar e excluir usuários", "settings"},
	{PermissionsManage, "Gerenciar permissões", "Alterar o acesso individual dos usuários", "settings"},
	{SettingsIntegrations, "Gerenciar integrações", "Configurar integrações da organização", "settings"},
	{SettingsOrganization, "Gerenciar organização", "Alterar dados e preferências da organização", "settings"},
	{SettingsAI, "Gerenciar IA", "Configurar agentes e regras de inteligência artificial", "settings"},
	{SettingsSite, "Gerenciar site", "Configurar o site da organização", "settings"},
	{SettingsBilling, "Gerenciar cobrança", "Alterar plano e dados de cobrança", "settings"},
}

var aliases = map[string]string{
	"data_view_dashboard":  DashboardView,
	"data_view_org_stats":  DashboardView,
	"data_view_team_stats": DashboardView,
	"lead_edit":            LeadOperate,
	"lead_edit_own":        LeadOperate,
	"lead_edit_all":        LeadOperate,
	"lead_manage":          LeadOperate,
	"lead_assign":          LeadOperate,
	"lead_transfer":        LeadOperate,
	"pipeline_edit":        PipelineManage,
	"settings_pipelines":   PipelineManage,
	"cadences_manage":      PipelineManage,
	"settings_teams":       TeamManage,
	"teams_manage":         TeamManage,
	"settings_users":       UsersManage,
	"automations_edit":     AutomationsManage,
	"property_create":      PropertyManage,
	"property_delete":      PropertyManage,
	"property_assign":      PropertyManage,
	"property_view_all":    PropertyView,
	"property_view_team":   PropertyView,
	"schedule_manage":      ScheduleManage,
	"site_manage":          SettingsSite,
	"ai_manage":            SettingsAI,
}

var legacyExpansions = map[string][]string{
	"lead_edit_own":       {LeadOperate, LeadViewOwn},
	"lead_edit_all":       {LeadOperate, LeadViewAll},
	"lead_manage":         {LeadOperate, LeadViewAll},
	"settings_manage":     {PermissionsManage, UsersManage, TeamManage, PipelineManage, TagManage, SettingsIntegrations, SettingsOrganization},
	"financial_manage":    {FinancialView, FinancialManage},
	"gamification_manage": {GamificationView, GamificationManage},
	"property_manage":     {PropertyView, PropertyManage},
	"whatsapp_manage":     {WhatsAppView, WhatsAppOperate, WhatsAppManage},
}

var permissionImplications = map[string][]string{
	WhatsAppOperate:    {WhatsAppView},
	WhatsAppManage:     {WhatsAppView, WhatsAppOperate},
	TeamManage:         {TeamView},
	PropertyManage:     {PropertyView},
	ScheduleManage:     {ScheduleView},
	AutomationsManage:  {AutomationsView},
	FinancialManage:    {FinancialView},
	GamificationManage: {GamificationView},
}

func Catalog() []Definition {
	out := append([]Definition(nil), catalog...)
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Domain == out[j].Domain {
			return out[i].Label < out[j].Label
		}
		return out[i].Domain < out[j].Domain
	})
	return out
}

func CanonicalKey(key string) string {
	key = strings.ToLower(strings.TrimSpace(key))
	if canonical, ok := aliases[key]; ok {
		return canonical
	}
	return key
}

func IsKnown(key string) bool {
	key = CanonicalKey(key)
	for _, item := range catalog {
		if item.Key == key {
			return true
		}
	}
	return false
}

func Expand(keys []string) map[string]bool {
	out := map[string]bool{}
	for _, key := range keys {
		normalized := strings.ToLower(strings.TrimSpace(key))
		if normalized == "*" {
			out["*"] = true
			continue
		}
		if expanded, ok := legacyExpansions[normalized]; ok {
			for _, candidate := range expanded {
				out[candidate] = true
			}
			continue
		}
		canonical := CanonicalKey(normalized)
		if IsKnown(canonical) {
			out[canonical] = true
		}
	}
	return out
}

func DefaultSet(memberRole string, isTeamLeader bool) map[string]bool {
	role := strings.ToLower(strings.TrimSpace(memberRole))
	if role == "owner" || role == "admin" {
		return map[string]bool{"*": true}
	}

	defaults := Expand([]string{
		DashboardView,
		LeadViewOwn,
		LeadOperate,
		LeadCreate,
		LeadImport,
		AttentionView,
		WhatsAppView,
		WhatsAppOperate,
		WhatsAppManage,
		PropertyView,
		ScheduleView,
		ScheduleManage,
		GamificationView,
	})
	if role == "manager" {
		defaults[LeadViewAll] = true
		defaults[TeamView] = true
	}
	if isTeamLeader {
		defaults[LeadViewTeam] = true
		defaults[TeamView] = true
		defaults[TeamManage] = true
	}
	return defaults
}

func InheritedSet(memberRole string, isTeamLeader bool, roleGrants []string) map[string]bool {
	inherited := DefaultSet(memberRole, isTeamLeader)
	if inherited["*"] {
		return inherited
	}
	for key := range Expand(roleGrants) {
		inherited[key] = true
	}
	return inherited
}

func Resolve(memberRole string, isTeamLeader bool, roleGrants []string, overrides map[string]bool) []string {
	resolved := InheritedSet(memberRole, isTeamLeader, roleGrants)
	if resolved["*"] {
		return []string{"*"}
	}
	for key, allowed := range overrides {
		canonical := CanonicalKey(key)
		if !IsKnown(canonical) {
			continue
		}
		if allowed {
			resolved[canonical] = true
		} else {
			delete(resolved, canonical)
		}
	}
	for granted, implied := range permissionImplications {
		if !resolved[granted] {
			continue
		}
		for _, key := range implied {
			resolved[key] = true
		}
	}
	keys := make([]string, 0, len(resolved))
	for key := range resolved {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func Has(effective []string, requested string) bool {
	requested = CanonicalKey(requested)
	for _, candidate := range effective {
		if candidate == "*" || CanonicalKey(candidate) == requested {
			return true
		}
	}
	return false
}
