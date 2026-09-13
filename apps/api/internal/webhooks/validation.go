package webhooks

import (
	"context"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/propertyscope"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

var outgoingWebhookEvents = map[string]struct{}{
	"lead.created":   {},
	"lead.reentered": {},
}

func normalizeWebhookCreateRequest(request WebhookRequest) (WebhookRequest, error) {
	name := cleanString(request.Name)
	webhookType := cleanString(request.Type)
	if name == nil || webhookType == nil || utf8.RuneCountInString(*name) > 180 {
		return WebhookRequest{}, ErrInvalidInput
	}
	if *webhookType != "incoming" && *webhookType != "outgoing" {
		return WebhookRequest{}, ErrInvalidInput
	}
	request.Name = name
	request.Type = webhookType
	return normalizeWebhookRequestForType(request, *webhookType, true)
}

func normalizeWebhookUpdateRequest(
	request WebhookRequest,
	webhookType string,
	currentURL *string,
	currentEvents []string,
) (WebhookRequest, error) {
	if request.Type != nil {
		return WebhookRequest{}, ErrInvalidInput
	}
	if request.Name != nil {
		request.Name = cleanString(request.Name)
		if request.Name == nil || utf8.RuneCountInString(*request.Name) > 180 {
			return WebhookRequest{}, ErrInvalidInput
		}
	}
	if webhookType == "outgoing" {
		if request.WebhookURL == nil {
			request.WebhookURL = currentURL
		}
		if request.TriggerEvents == nil {
			request.TriggerEvents = currentEvents
		}
	}
	return normalizeWebhookRequestForType(request, webhookType, false)
}

func normalizeWebhookRequestForType(
	request WebhookRequest,
	webhookType string,
	creating bool,
) (WebhookRequest, error) {
	if err := validateWebhookMapping(request.FieldMapping); err != nil {
		return WebhookRequest{}, err
	}
	if webhookType == "outgoing" {
		if request.TargetPipelineID != nil || request.TargetTeamID != nil ||
			request.TargetStageID != nil || request.TargetPropertyID != nil ||
			request.TargetTagIDs != nil || request.FieldMapping != nil {
			return WebhookRequest{}, ErrInvalidInput
		}
		urlValue := cleanString(request.WebhookURL)
		if urlValue == nil {
			return WebhookRequest{}, ErrInvalidInput
		}
		parsed, err := validateOutgoingWebhookURL(*urlValue)
		if err != nil {
			return WebhookRequest{}, ErrInvalidInput
		}
		normalizedEvents, err := normalizeOutgoingWebhookEvents(request.TriggerEvents)
		if err != nil {
			return WebhookRequest{}, err
		}
		normalizedURL := parsed.String()
		request.WebhookURL = &normalizedURL
		request.TriggerEvents = normalizedEvents
		return request, nil
	}

	if webhookType != "incoming" || request.WebhookURL != nil || request.TriggerEvents != nil {
		return WebhookRequest{}, ErrInvalidInput
	}
	if creating {
		request.TriggerEvents = []string{}
	}
	return request, validateWebhookUUIDs(request)
}

func normalizeOutgoingWebhookEvents(events []string) ([]string, error) {
	if len(events) == 0 || len(events) > len(outgoingWebhookEvents) {
		return nil, ErrInvalidInput
	}
	normalized := make([]string, 0, len(events))
	seen := make(map[string]struct{}, len(events))
	for _, event := range events {
		event = strings.ToLower(strings.TrimSpace(event))
		if _, allowed := outgoingWebhookEvents[event]; !allowed {
			return nil, ErrInvalidInput
		}
		if _, duplicate := seen[event]; duplicate {
			return nil, ErrInvalidInput
		}
		seen[event] = struct{}{}
		normalized = append(normalized, event)
	}
	return normalized, nil
}

func validateWebhookMapping(mapping map[string]string) error {
	if len(mapping) > 100 {
		return ErrInvalidInput
	}
	for key, value := range mapping {
		if strings.TrimSpace(key) == "" || strings.TrimSpace(value) == "" ||
			utf8.RuneCountInString(key) > 120 || utf8.RuneCountInString(value) > 120 {
			return ErrInvalidInput
		}
	}
	return nil
}

func validateWebhookUUIDs(request WebhookRequest) error {
	for _, value := range []*string{
		request.TargetPipelineID,
		request.TargetTeamID,
		request.TargetStageID,
		request.TargetPropertyID,
	} {
		if value == nil || strings.TrimSpace(*value) == "" {
			continue
		}
		if _, ok := normalizeUUID(*value); !ok {
			return ErrInvalidInput
		}
	}
	if len(request.TargetTagIDs) > 500 {
		return ErrInvalidInput
	}
	for _, value := range request.TargetTagIDs {
		if _, ok := normalizeUUID(value); !ok {
			return ErrInvalidInput
		}
	}
	return nil
}

func (repo Repository) currentWebhookContract(
	ctx context.Context,
	tenantContext tenant.Context,
	id string,
) (string, *string, []string, error) {
	var webhookType string
	var currentURL pgtype.Text
	var currentEvents []string
	err := repo.db.Pool().QueryRow(ctx, `
		select type, webhook_url, trigger_events
		from public.webhooks_integrations
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, tenantContext.OrganizationID, id).Scan(&webhookType, &currentURL, &currentEvents)
	if err != nil {
		return "", nil, nil, err
	}
	return webhookType, textPointer(currentURL), currentEvents, nil
}

func (repo Repository) validateWebhookReferences(
	ctx context.Context,
	tenantContext tenant.Context,
	request WebhookRequest,
) error {
	targetPropertyID := request.TargetPropertyID
	if targetPropertyID == nil {
		if mappedPropertyID := strings.TrimSpace(request.FieldMapping["interest_property_id"]); mappedPropertyID != "" {
			targetPropertyID = &mappedPropertyID
		}
	}
	if targetPropertyID != nil {
		normalizedPropertyID, ok := normalizeUUID(*targetPropertyID)
		if !ok {
			return ErrInvalidInput
		}
		targetPropertyID = &normalizedPropertyID
		if !propertyscope.CanRead(tenantContext) {
			return tenant.ErrOrganizationAccessDenied
		}
	}
	if request.TargetPipelineID == nil && request.TargetTeamID == nil &&
		request.TargetStageID == nil && targetPropertyID == nil &&
		request.TargetTagIDs == nil {
		return nil
	}

	var pipelineOK, teamOK, stageOK, propertyOK, tagsOK bool
	err := repo.db.Pool().QueryRow(ctx, `
		select
			$2::uuid is null or exists (
				select 1 from public.pipelines item
				where item.organization_id = $1::uuid and item.id = $2::uuid
			),
			$3::uuid is null or exists (
				select 1 from public.teams item
				where item.organization_id = $1::uuid and item.id = $3::uuid
			),
			$4::uuid is null or exists (
				select 1 from public.stages item
				where item.organization_id = $1::uuid
				  and item.id = $4::uuid
				  and ($2::uuid is null or item.pipeline_id = $2::uuid)
			),
			$5::uuid is null or exists (
				select 1 from public.properties item
				where item.organization_id = $1::uuid and item.id = $5::uuid
				  and `+propertyscope.VisibilitySQL("item", "$7", "$8", "$9")+`
			),
			not exists (
				select requested.id
				from unnest(coalesce($6::uuid[], '{}'::uuid[])) requested(id)
				where not exists (
					select 1 from public.tags item
					where item.organization_id = $1::uuid and item.id = requested.id
				)
			)
	`,
		tenantContext.OrganizationID,
		nullableString(cleanString(request.TargetPipelineID)),
		nullableString(cleanString(request.TargetTeamID)),
		nullableString(cleanString(request.TargetStageID)),
		nullableString(cleanString(targetPropertyID)),
		request.TargetTagIDs,
		propertyscope.CanViewAll(tenantContext),
		tenantContext.UserID,
		propertyscope.CanViewTeam(tenantContext),
	).Scan(&pipelineOK, &teamOK, &stageOK, &propertyOK, &tagsOK)
	if err != nil {
		return err
	}
	if !pipelineOK || !teamOK || !stageOK || !propertyOK || !tagsOK {
		return ErrInvalidInput
	}
	return nil
}
