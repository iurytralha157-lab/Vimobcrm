package roundrobin

import (
	"context"
	"fmt"
	"strings"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const (
	whatsappMessageContainsConditionType = "whatsapp_message_contains"
	whatsappSessionMatchKey              = "whatsapp_session_id"
	listMetaFormOptionsQuery             = `
		select
		  form_config.id::text,
		  form_config.form_id,
		  coalesce(nullif(btrim(form_config.form_name), ''), ''),
		  coalesce(nullif(btrim(meta_integration.page_id), ''), ''),
		  coalesce(nullif(btrim(meta_integration.page_name), ''), ''),
		  coalesce(form_config.round_robin_id::text, ''),
		  coalesce(form_config.is_active, true),
		  (
		    coalesce(meta_integration.is_connected, true)
		    and btrim(coalesce(meta_integration.page_id, '')) <> ''
		  )
		from public.meta_form_configs form_config
		join public.meta_integrations meta_integration
		  on meta_integration.organization_id = form_config.organization_id
		 and meta_integration.id = form_config.integration_id
		where form_config.organization_id = $1::uuid
		  and btrim(form_config.form_id) <> ''
		order by
		  (
		    coalesce(form_config.is_active, true)
		    and coalesce(meta_integration.is_connected, true)
		    and btrim(coalesce(meta_integration.page_id, '')) <> ''
		  ) desc,
		  lower(coalesce(nullif(form_config.form_name, ''), form_config.form_id)) asc,
		  form_config.form_id asc
	`
	listMetaFormLinkRulesQuery = `
		select
		  form_config.id::text,
		  form_config.round_robin_id::text,
		  form_config.form_id,
		  coalesce(form_config.is_active, true),
		  form_config.created_at,
		  form_config.updated_at
		from public.meta_form_configs form_config
		join public.round_robins round_robin
		  on round_robin.organization_id = form_config.organization_id
		 and round_robin.id = form_config.round_robin_id
		where form_config.organization_id = $1::uuid
		  and form_config.round_robin_id is not null
		  and btrim(form_config.form_id) <> ''
		order by form_config.created_at asc, form_config.id asc
	`
	lockMetaFormLinksQuery = `
		select
		  form_config.form_id,
		  coalesce(form_config.round_robin_id::text, ''),
		  coalesce(round_robin.name, '')
		from public.meta_form_configs form_config
		left join public.round_robins round_robin
		  on round_robin.organization_id = form_config.organization_id
		 and round_robin.id = form_config.round_robin_id
		where form_config.organization_id = $1::uuid
		  and form_config.form_id = any($2::text[])
		order by form_config.form_id asc
		for update of form_config
	`
)

type whatsappMessageDistributionState struct {
	QueueActive             bool
	RequireCheckIn          bool
	HasActiveRule           bool
	InvalidSessionRuleCount int
}

type metaFormLinkState struct {
	FormID       string
	RoundRobinID string
	QueueName    string
}

func validateWhatsAppMessageDistributionState(state whatsappMessageDistributionState) error {
	if !state.QueueActive || !state.HasActiveRule {
		return nil
	}

	if state.InvalidSessionRuleCount > 0 {
		return fmt.Errorf("%w: active WhatsApp message distribution requires a valid active connection", ErrInvalidInput)
	}
	if state.RequireCheckIn {
		return fmt.Errorf("%w: active WhatsApp message distribution does not support required check-in", ErrInvalidInput)
	}

	return nil
}

func (repo Repository) ListWhatsAppSessionOptions(ctx context.Context, tenantContext tenant.Context) ([]WhatsAppSessionOption, error) {
	rows, err := repo.db.Pool().Query(ctx, `
		select
		  session.id::text,
		  coalesce(session.instance_name, ''),
		  coalesce(session.display_name, ''),
		  coalesce(session.phone_number, ''),
		  coalesce(session.status, ''),
		  coalesce(session.provider, ''),
		  coalesce(session.is_active, true)
		from public.whatsapp_sessions session
		where session.organization_id = $1::uuid
		  and session.provider = 'evolution_go'
		  and lower(btrim(coalesce(session.status, ''))) <> 'deleted'
		order by
		  coalesce(session.is_active, true) desc,
		  lower(coalesce(nullif(session.display_name, ''), nullif(session.phone_number, ''), session.instance_name, '')) asc,
		  session.id asc
	`, tenantContext.OrganizationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []WhatsAppSessionOption{}
	for rows.Next() {
		var item WhatsAppSessionOption
		if err := rows.Scan(
			&item.ID,
			&item.InstanceName,
			&item.DisplayName,
			&item.PhoneNumber,
			&item.Status,
			&item.Provider,
			&item.IsActive,
		); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func (repo Repository) ListMetaFormOptions(ctx context.Context, tenantContext tenant.Context) ([]MetaFormOption, error) {
	rows, err := repo.db.Pool().Query(ctx, listMetaFormOptionsQuery, tenantContext.OrganizationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []MetaFormOption{}
	for rows.Next() {
		var item MetaFormOption
		if err := rows.Scan(
			&item.ConfigID,
			&item.FormID,
			&item.FormName,
			&item.PageID,
			&item.PageName,
			&item.RoundRobinID,
			&item.IsActive,
			&item.IntegrationConnected,
		); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func (repo Repository) listMetaFormLinkRules(ctx context.Context, organizationID string) ([]Rule, error) {
	rows, err := repo.db.Pool().Query(ctx, listMetaFormLinkRulesQuery, organizationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []Rule{}
	for rows.Next() {
		var item Rule
		if err := rows.Scan(
			&item.ID,
			&item.RoundRobinID,
			&item.MatchValue,
			&item.IsActive,
			&item.CreatedAt,
			&item.UpdatedAt,
		); err != nil {
			return nil, err
		}
		item.MatchType = "meta_form"
		item.Match = map[string]any{"meta_form_id": []string{item.MatchValue}}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func mergeMissingMetaFormLinkRules(rules []Rule, linkedRules []Rule) []Rule {
	canonicalFormIDByQueueAndConfig := map[string]string{}
	for _, linkedRule := range linkedRules {
		canonicalFormIDByQueueAndConfig[linkedRule.RoundRobinID+"\x00"+linkedRule.ID] = linkedRule.MatchValue
	}

	existing := map[string]map[string]struct{}{}
	merged := append([]Rule(nil), rules...)
	for index, rule := range merged {
		if rule.MatchType != "meta_form" && rule.MatchType != "form" {
			continue
		}
		if existing[rule.RoundRobinID] == nil {
			existing[rule.RoundRobinID] = map[string]struct{}{}
		}
		formIDs := splitValues(rule.MatchValue)
		seen := map[string]struct{}{}
		canonicalFormIDs := make([]string, 0, len(formIDs))
		for _, formID := range formIDs {
			if canonicalFormID, ok := canonicalFormIDByQueueAndConfig[rule.RoundRobinID+"\x00"+formID]; ok {
				formID = canonicalFormID
			}
			if _, duplicate := seen[formID]; duplicate {
				continue
			}
			seen[formID] = struct{}{}
			canonicalFormIDs = append(canonicalFormIDs, formID)
			existing[rule.RoundRobinID][formID] = struct{}{}
		}
		canonicalMatchValue := strings.Join(canonicalFormIDs, ", ")
		if canonicalMatchValue != rule.MatchValue {
			merged[index].MatchValue = canonicalMatchValue
			merged[index].Match = cloneObject(rule.Match)
			merged[index].Match["meta_form_id"] = canonicalFormIDs
		}
	}

	for _, linkedRule := range linkedRules {
		if _, ok := existing[linkedRule.RoundRobinID][linkedRule.MatchValue]; ok {
			continue
		}
		if _, ok := existing[linkedRule.RoundRobinID][linkedRule.ID]; ok {
			continue
		}
		merged = append(merged, linkedRule)
		if existing[linkedRule.RoundRobinID] == nil {
			existing[linkedRule.RoundRobinID] = map[string]struct{}{}
		}
		existing[linkedRule.RoundRobinID][linkedRule.MatchValue] = struct{}{}
	}
	return merged
}
