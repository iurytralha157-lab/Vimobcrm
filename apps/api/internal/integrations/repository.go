package integrations

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

type Repository struct {
	db       *dbpkg.Postgres
	external ExternalConfig
	client   *http.Client
}

func NewRepository(db *dbpkg.Postgres, external ExternalConfig) Repository {
	if strings.TrimSpace(external.MetaGraphVersion) == "" {
		external.MetaGraphVersion = "v25.0"
	}
	if strings.TrimSpace(external.MetaGraphBaseURL) == "" {
		external.MetaGraphBaseURL = "https://graph.facebook.com"
	}
	return Repository{
		db:       db,
		external: external,
		client: &http.Client{
			Timeout: 60 * time.Second,
		},
	}
}

func (repo Repository) InvokeFunction(ctx context.Context, name string, authorization string, body []byte) (FunctionResponse, error) {
	return repo.InvokeFunctionRequest(ctx, name, http.MethodPost, authorization, body, nil)
}

func (repo Repository) InvokeFunctionRequest(ctx context.Context, name string, method string, authorization string, body []byte, query url.Values) (FunctionResponse, error) {
	if !allowedFunction(name) {
		return FunctionResponse{}, ErrFunctionNotAllowed
	}
	projectURL := strings.TrimRight(repo.external.ProjectURL, "/")
	if projectURL == "" {
		return FunctionResponse{}, ErrInvalidInput
	}
	if strings.TrimSpace(method) == "" {
		method = http.MethodPost
	}

	endpoint, err := url.Parse(projectURL + "/functions/v1/" + name)
	if err != nil {
		return FunctionResponse{}, err
	}
	if query != nil {
		endpoint.RawQuery = query.Encode()
	}

	request, err := http.NewRequestWithContext(ctx, method, endpoint.String(), bytes.NewReader(body))
	if err != nil {
		return FunctionResponse{}, err
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("Content-Type", "application/json")
	if repo.external.APIKey != "" {
		request.Header.Set("apikey", repo.external.APIKey)
	}
	if authorization != "" {
		request.Header.Set("Authorization", authorization)
	} else if repo.external.APIKey != "" {
		request.Header.Set("Authorization", "Bearer "+repo.external.APIKey)
	}

	response, err := repo.client.Do(request)
	if err != nil {
		return FunctionResponse{}, err
	}
	defer response.Body.Close()

	responseBody, err := io.ReadAll(io.LimitReader(response.Body, 8<<20))
	if err != nil {
		return FunctionResponse{}, err
	}
	return FunctionResponse{
		StatusCode:  response.StatusCode,
		ContentType: response.Header.Get("Content-Type"),
		Body:        responseBody,
	}, nil
}

func (repo Repository) GetVista(ctx context.Context, tenantContext tenant.Context) (map[string]any, error) {
	return repo.getSingleJSON(ctx, `
		select to_jsonb(v) || jsonb_build_object('api_key', null)
		from public.vista_integrations v
		where v.organization_id = $1::uuid
		limit 1
	`, tenantContext.OrganizationID)
}

func (repo Repository) SaveVista(ctx context.Context, tenantContext tenant.Context, request VistaIntegrationRequest) (map[string]any, error) {
	apiURL := strings.TrimSpace(request.APIURL)
	apiKey := strings.TrimSpace(request.APIKey)
	if apiURL == "" || apiKey == "" {
		return nil, ErrInvalidInput
	}
	return repo.upsertSecretIntegration(ctx, `
		insert into public.vista_integrations (
			organization_id,
			api_url,
			api_key_secret_ref,
			status,
			created_by,
			updated_at
		)
		values ($1::uuid, $2, $3, 'connected', $4::uuid, now())
		on conflict (organization_id) do update
		set api_url = excluded.api_url,
		    api_key_secret_ref = excluded.api_key_secret_ref,
		    status = 'connected',
		    last_error = null,
		    updated_at = now()
		returning to_jsonb(vista_integrations.*) || jsonb_build_object('api_key', null)
	`, tenantContext.OrganizationID, apiURL, "plain:"+apiKey, tenantContext.UserID)
}

func (repo Repository) DeleteVista(ctx context.Context, tenantContext tenant.Context) error {
	return repo.deleteByOrganization(ctx, "public.vista_integrations", tenantContext.OrganizationID)
}

func (repo Repository) GetImoview(ctx context.Context, tenantContext tenant.Context) (map[string]any, error) {
	return repo.getSingleJSON(ctx, `
		select to_jsonb(i) || jsonb_build_object('api_key', null)
		from public.imoview_integrations i
		where i.organization_id = $1::uuid
		limit 1
	`, tenantContext.OrganizationID)
}

func (repo Repository) SaveImoview(ctx context.Context, tenantContext tenant.Context, request ImoviewIntegrationRequest) (map[string]any, error) {
	apiKey := strings.TrimSpace(request.APIKey)
	if apiKey == "" {
		return nil, ErrInvalidInput
	}
	return repo.upsertSecretIntegration(ctx, `
		insert into public.imoview_integrations (
			organization_id,
			api_key_secret_ref,
			status,
			created_by,
			updated_at
		)
		values ($1::uuid, $2, 'connected', $3::uuid, now())
		on conflict (organization_id) do update
		set api_key_secret_ref = excluded.api_key_secret_ref,
		    status = 'connected',
		    last_error = null,
		    updated_at = now()
		returning to_jsonb(imoview_integrations.*) || jsonb_build_object('api_key', null)
	`, tenantContext.OrganizationID, "plain:"+apiKey, tenantContext.UserID)
}

func (repo Repository) DeleteImoview(ctx context.Context, tenantContext tenant.Context) error {
	return repo.deleteByOrganization(ctx, "public.imoview_integrations", tenantContext.OrganizationID)
}

func (repo Repository) ListMetaIntegrations(ctx context.Context, tenantContext tenant.Context) ([]map[string]any, error) {
	return repo.listJSON(ctx, `
		select to_jsonb(mi)
		from public.meta_integrations_public mi
		where mi.organization_id = $1::uuid
		order by mi.created_at desc
	`, tenantContext.OrganizationID)
}

func (repo Repository) ListMetaPageForms(ctx context.Context, tenantContext tenant.Context, pageID string) ([]map[string]any, error) {
	if !canManageMetaIntegrations(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}

	pageID = strings.TrimSpace(pageID)
	if pageID == "" {
		return nil, ErrInvalidInput
	}

	integration, err := repo.getMetaIntegrationByPage(ctx, tenantContext.OrganizationID, pageID)
	if err != nil {
		return nil, err
	}
	if integration.AccessToken == nil || strings.TrimSpace(*integration.AccessToken) == "" {
		return nil, ErrInvalidInput
	}

	return repo.fetchMetaLeadForms(ctx, pageID, *integration.AccessToken)
}

type metaIntegrationSnapshot struct {
	ID          string
	AccessToken *string
}

type metaLeadFormsResponse struct {
	Data   []metaLeadForm `json:"data"`
	Paging struct {
		Next string `json:"next"`
	} `json:"paging"`
}

type metaLeadForm struct {
	ID         string             `json:"id"`
	Name       string             `json:"name"`
	Status     string             `json:"status"`
	LeadsCount *int               `json:"leads_count,omitempty"`
	Questions  []metaFormQuestion `json:"questions,omitempty"`
}

type metaFormQuestion struct {
	Key   string `json:"key"`
	Label string `json:"label"`
	Type  string `json:"type"`
}

func (repo Repository) getMetaIntegrationByPage(ctx context.Context, organizationID string, pageID string) (metaIntegrationSnapshot, error) {
	var raw []byte
	err := repo.db.Pool().QueryRow(ctx, `
		select to_jsonb(mi)
		from public.meta_integrations mi
		where mi.organization_id = $1::uuid
		  and mi.page_id = $2
		  and coalesce(mi.is_connected, true) = true
		order by mi.updated_at desc nulls last, mi.created_at desc nulls last
		limit 1
	`, organizationID, pageID).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return metaIntegrationSnapshot{}, ErrIntegrationNotFound
	}
	if err != nil {
		return metaIntegrationSnapshot{}, err
	}

	var item map[string]any
	if err := json.Unmarshal(raw, &item); err != nil {
		return metaIntegrationSnapshot{}, err
	}

	accessToken := cleanTextFromAny(item["access_token"])
	if accessToken == nil {
		accessToken = plainSecretValue(cleanTextFromAny(item["access_token_secret_ref"]))
	}

	return metaIntegrationSnapshot{
		ID:          cleanStringFromAny(item["id"]),
		AccessToken: accessToken,
	}, nil
}

func (repo Repository) fetchMetaLeadForms(ctx context.Context, pageID string, accessToken string) ([]map[string]any, error) {
	pageID = strings.TrimSpace(pageID)
	accessToken = strings.TrimSpace(accessToken)
	if pageID == "" || accessToken == "" {
		return nil, ErrInvalidInput
	}

	endpoint, err := url.Parse(strings.TrimRight(repo.external.MetaGraphBaseURL, "/") + "/" + strings.Trim(strings.TrimSpace(repo.external.MetaGraphVersion), "/") + "/" + url.PathEscape(pageID) + "/leadgen_forms")
	if err != nil {
		return nil, err
	}
	query := endpoint.Query()
	query.Set("access_token", accessToken)
	query.Set("fields", "id,name,status,leads_count,questions{key,label,type}")
	query.Set("limit", "100")
	endpoint.RawQuery = query.Encode()

	forms := []map[string]any{}
	nextURL := endpoint.String()
	for page := 0; page < 10 && nextURL != ""; page++ {
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, nextURL, nil)
		if err != nil {
			return nil, err
		}
		request.Header.Set("Accept", "application/json")

		response, err := repo.client.Do(request)
		if err != nil {
			return nil, err
		}

		var payload metaLeadFormsResponse
		if response.StatusCode >= 400 {
			message := readMetaGraphError(response.Body)
			response.Body.Close()
			return nil, fmt.Errorf("Meta Graph returned HTTP %d: %s", response.StatusCode, message)
		}
		if err := json.NewDecoder(io.LimitReader(response.Body, 4<<20)).Decode(&payload); err != nil {
			response.Body.Close()
			return nil, err
		}
		response.Body.Close()

		for _, form := range payload.Data {
			forms = append(forms, metaLeadFormToMap(form))
		}
		nextURL = strings.TrimSpace(payload.Paging.Next)
	}

	return forms, nil
}

func metaLeadFormToMap(form metaLeadForm) map[string]any {
	status := strings.TrimSpace(form.Status)
	if status == "" {
		status = "ACTIVE"
	}
	item := map[string]any{
		"id":     strings.TrimSpace(form.ID),
		"name":   strings.TrimSpace(form.Name),
		"status": status,
	}
	if form.LeadsCount != nil {
		item["leads_count"] = *form.LeadsCount
	}
	if len(form.Questions) > 0 {
		questions := make([]map[string]any, 0, len(form.Questions))
		for _, question := range form.Questions {
			questions = append(questions, map[string]any{
				"key":   strings.TrimSpace(question.Key),
				"label": strings.TrimSpace(question.Label),
				"type":  strings.TrimSpace(question.Type),
			})
		}
		item["questions"] = questions
	}
	return item
}

func readMetaGraphError(reader io.Reader) string {
	var body map[string]any
	if err := json.NewDecoder(io.LimitReader(reader, 1<<20)).Decode(&body); err == nil {
		if errorBody, ok := body["error"].(map[string]any); ok {
			if message := cleanStringFromAny(errorBody["message"]); message != "" {
				return message
			}
		}
	}
	return "request failed"
}

func (repo Repository) GetMetaOAuthFlow(ctx context.Context, tenantContext tenant.Context, flowID string) (map[string]any, error) {
	flowID = strings.TrimSpace(flowID)
	if flowID == "" {
		return nil, ErrInvalidInput
	}

	return repo.getSingleJSON(ctx, `
		select jsonb_strip_nulls(jsonb_build_object(
			'id', mof.id::text,
			'organization_id', mof.organization_id::text,
			'user_id', mof.user_id::text,
			'status', mof.status,
			'payload', mof.payload,
			'error_message', mof.error_message,
			'expires_at', mof.expires_at,
			'consumed_at', mof.consumed_at,
			'created_at', mof.created_at,
			'updated_at', mof.updated_at
		))
		from public.meta_oauth_flows mof
		where mof.id = $2::uuid
		  and mof.organization_id = $1::uuid
		  and mof.user_id = $3::uuid
		limit 1
	`, tenantContext.OrganizationID, flowID, tenantContext.UserID)
}

func (repo Repository) ListMetaFormConfigs(ctx context.Context, tenantContext tenant.Context, integrationID string) ([]map[string]any, error) {
	integrationID = strings.TrimSpace(integrationID)
	if integrationID == "" {
		return repo.listJSON(ctx, `
			select to_jsonb(mfc) || jsonb_build_object('created_by_name', coalesce(u.name, u.email))
			from public.meta_form_configs mfc
			left join public.users u on u.id = mfc.created_by
			where mfc.organization_id = $1::uuid
			order by mfc.created_at desc
		`, tenantContext.OrganizationID)
	}
	return repo.listJSON(ctx, `
		select to_jsonb(mfc) || jsonb_build_object('created_by_name', coalesce(u.name, u.email))
		from public.meta_form_configs mfc
		left join public.users u on u.id = mfc.created_by
		where mfc.organization_id = $1::uuid
		  and mfc.integration_id = $2::uuid
		order by mfc.created_at desc
	`, tenantContext.OrganizationID, integrationID)
}

func (repo Repository) SaveMetaFormConfig(ctx context.Context, tenantContext tenant.Context, request MetaFormConfigRequest) (map[string]any, error) {
	integrationID := strings.TrimSpace(request.IntegrationID)
	formID := strings.TrimSpace(request.FormID)
	if integrationID == "" || formID == "" {
		return nil, ErrInvalidInput
	}
	isActive := true
	if request.IsActive != nil {
		isActive = *request.IsActive
	}
	defaultValuesJSON, _ := json.Marshal(nonNilMap(request.DefaultValues))
	autoTagsJSON, _ := json.Marshal(nonNilStrings(request.AutoTags))
	fieldMappingJSON, _ := json.Marshal(nonNilStringMap(request.FieldMapping))
	customFieldsJSON, _ := json.Marshal(nonNilStrings(request.CustomFieldsConfig))

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	var raw []byte
	err = tx.QueryRow(ctx, `
		insert into public.meta_form_configs (
			organization_id,
			integration_id,
			form_id,
			form_name,
			pipeline_id,
			stage_id,
			default_status,
			assigned_user_id,
			round_robin_id,
			property_id,
			purpose,
			source,
			source_details,
			default_values,
			auto_tags,
			field_mapping,
			custom_fields_config,
			created_by,
			is_active,
			updated_at
		)
		values (
			$1::uuid,
			$2::uuid,
			$3,
			$4,
			null,
			null,
			null,
			null,
			$5::uuid,
			$6::uuid,
			$7,
			$8,
			$9,
			$10::jsonb,
			$11::jsonb,
			$12::jsonb,
			$13::jsonb,
			$14::uuid,
			$15,
			now()
		)
		on conflict (organization_id, form_id) do update
		set integration_id = excluded.integration_id,
		    form_name = excluded.form_name,
		    round_robin_id = excluded.round_robin_id,
		    property_id = excluded.property_id,
		    purpose = excluded.purpose,
		    source = excluded.source,
		    source_details = excluded.source_details,
		    default_values = excluded.default_values,
		    auto_tags = excluded.auto_tags,
		    field_mapping = excluded.field_mapping,
		    custom_fields_config = excluded.custom_fields_config,
		    is_active = excluded.is_active,
		    updated_at = now()
		returning to_jsonb(meta_form_configs.*)
	`, tenantContext.OrganizationID, integrationID, formID, nullableString(cleanString(request.FormName)), nullableString(cleanString(request.RoundRobinID)), nullableString(cleanString(request.PropertyID)), nullableString(cleanString(request.Purpose)), nullableString(cleanString(request.Source)), nullableString(cleanString(request.SourceDetails)), string(defaultValuesJSON), string(autoTagsJSON), string(fieldMappingJSON), string(customFieldsJSON), tenantContext.UserID, isActive).Scan(&raw)
	if err != nil {
		return nil, err
	}

	if err := repo.replaceMetaFormRule(ctx, tx, tenantContext.OrganizationID, request.RoundRobinID, formID); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	var item map[string]any
	if err := json.Unmarshal(raw, &item); err != nil {
		return nil, err
	}
	return item, nil
}

func (repo Repository) ToggleMetaFormConfig(ctx context.Context, tenantContext tenant.Context, request ToggleMetaFormConfigRequest) error {
	if strings.TrimSpace(request.IntegrationID) == "" || strings.TrimSpace(request.FormID) == "" {
		return ErrInvalidInput
	}
	tag, err := repo.db.Pool().Exec(ctx, `
		update public.meta_form_configs
		set is_active = $4,
		    updated_at = now()
		where organization_id = $1::uuid
		  and integration_id = $2::uuid
		  and form_id = $3
	`, tenantContext.OrganizationID, request.IntegrationID, request.FormID, request.IsActive)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrIntegrationNotFound
	}
	return nil
}

func (repo Repository) DeleteMetaFormConfig(ctx context.Context, tenantContext tenant.Context, integrationID string, formID string) error {
	integrationID = strings.TrimSpace(integrationID)
	formID = strings.TrimSpace(formID)
	if integrationID == "" || formID == "" {
		return ErrInvalidInput
	}
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	tag, err := tx.Exec(ctx, `
		delete from public.meta_form_configs
		where organization_id = $1::uuid
		  and integration_id = $2::uuid
		  and form_id = $3
	`, tenantContext.OrganizationID, integrationID, formID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrIntegrationNotFound
	}
	if _, err := tx.Exec(ctx, `delete from public.round_robin_rules where match_type = 'meta_form' and match_value = $1`, formID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (repo Repository) MetaWebhookHealth(ctx context.Context, tenantContext tenant.Context) (map[string]any, error) {
	item, err := repo.getSingleJSON(ctx, `
		with events as (
			select status, error_message, received_at
			from public.meta_webhook_events
			where organization_id = $1::uuid
			  and received_at >= now() - interval '7 days'
			  and status = any(array['failed', 'skipped'])
			order by received_at desc
			limit 200
		),
		counts as (
			select coalesce(jsonb_object_agg(status, count), '{}'::jsonb) as value
			from (
				select status, count(*)::int as count
				from events
				group by status
			) grouped
		),
		last_error as (
			select error_message
			from events
			where error_message is not null
			order by received_at desc
			limit 1
		)
		select jsonb_build_object(
			'counts', coalesce((select value from counts), '{}'::jsonb),
			'lastError', (select error_message from last_error),
			'missing', false
		)
	`, tenantContext.OrganizationID)
	if err == nil {
		return item, nil
	}
	if !isOptionalMetaWebhookHealthError(err) {
		return nil, err
	}

	item, err = repo.getSingleJSON(ctx, `
		with events as (
			select 'failed'::text as status, error_message, created_at as received_at
			from public.meta_webhook_events
			where organization_id = $1::uuid
			  and created_at >= now() - interval '7 days'
			  and error_message is not null
			order by created_at desc
			limit 200
		),
		counts as (
			select coalesce(jsonb_object_agg(status, count), '{}'::jsonb) as value
			from (
				select status, count(*)::int as count
				from events
				group by status
			) grouped
		),
		last_error as (
			select error_message
			from events
			where error_message is not null
			order by received_at desc
			limit 1
		)
		select jsonb_build_object(
			'counts', coalesce((select value from counts), '{}'::jsonb),
			'lastError', (select error_message from last_error),
			'missing', false
		)
	`, tenantContext.OrganizationID)
	if err == nil {
		return item, nil
	}
	if isOptionalMetaWebhookHealthError(err) {
		return emptyMetaWebhookHealth(true), nil
	}
	return nil, err
}

func (repo Repository) ListMetaConversations(ctx context.Context, tenantContext tenant.Context, pageID string) ([]map[string]any, error) {
	pageID = strings.TrimSpace(pageID)
	where := "mc.organization_id = $1::uuid"
	args := []any{tenantContext.OrganizationID}
	if pageID != "" && pageID != "all" {
		args = append(args, pageID)
		where += " and mc.page_id = $2"
	}

	items, err := repo.listJSON(ctx, `
		select jsonb_strip_nulls(
			to_jsonb(mc)
			|| jsonb_build_object(
				'id', mc.id::text,
				'organization_id', mc.organization_id::text,
				'lead_id', mc.lead_id::text,
				'lead',
					case when l.id is null then null else jsonb_build_object(
						'id', l.id::text,
						'name', l.name
					) end
			)
		)
		from public.meta_conversations mc
		left join public.leads l on l.id = mc.lead_id
		where `+where+`
		order by mc.last_message_at desc nulls last, mc.updated_at desc
	`, args...)
	if isOptionalMetaStorageError(err) {
		return []map[string]any{}, nil
	}
	return items, err
}

func (repo Repository) ListMetaMessages(ctx context.Context, tenantContext tenant.Context, conversationID string) ([]map[string]any, error) {
	conversationID = strings.TrimSpace(conversationID)
	if conversationID == "" {
		return []map[string]any{}, nil
	}

	items, err := repo.listJSON(ctx, `
		select jsonb_strip_nulls(
			to_jsonb(mm)
			|| jsonb_build_object(
				'id', mm.id::text,
				'conversation_id', mm.conversation_id::text
			)
		)
		from public.meta_messages mm
		join public.meta_conversations mc on mc.id = mm.conversation_id
		where mc.organization_id = $1::uuid
		  and mm.conversation_id = $2::uuid
		order by mm.sent_at asc, mm.created_at asc
	`, tenantContext.OrganizationID, conversationID)
	if isOptionalMetaStorageError(err) {
		return []map[string]any{}, nil
	}
	return items, err
}

func (repo Repository) replaceMetaFormRule(ctx context.Context, tx pgx.Tx, organizationID string, roundRobinID *string, formID string) error {
	if _, err := tx.Exec(ctx, `
		delete from public.round_robin_rules
		where organization_id = $1::uuid
		  and coalesce(nullif(match_type, ''), conditions->>'match_type', name, '') = 'meta_form'
		  and coalesce(nullif(match_value, ''), conditions->>'match_value', '') = $2
	`, organizationID, formID); err != nil {
		return err
	}
	roundRobinID = cleanString(roundRobinID)
	if roundRobinID == nil {
		return nil
	}
	var exists bool
	if err := tx.QueryRow(ctx, `
		select exists (
			select 1
			from public.round_robins
			where organization_id = $1::uuid
			  and id = $2::uuid
		)
	`, organizationID, *roundRobinID).Scan(&exists); err != nil {
		return err
	}
	if !exists {
		return ErrInvalidInput
	}
	matchJSON, _ := json.Marshal(map[string]any{"meta_form_id": []string{formID}})
	_, err := tx.Exec(ctx, `
		insert into public.round_robin_rules (
			organization_id,
			round_robin_id,
			match_type,
			match_value,
			match,
			name,
			conditions,
			priority,
			is_active
		)
		values (
			$1::uuid,
			$2::uuid,
			'meta_form',
			$3,
			$4::jsonb,
			'meta_form',
			$4::jsonb,
			100,
			true
		)
	`, organizationID, *roundRobinID, formID, string(matchJSON))
	return err
}

func (repo Repository) upsertSecretIntegration(ctx context.Context, query string, args ...any) (map[string]any, error) {
	var raw []byte
	if err := repo.db.Pool().QueryRow(ctx, query, args...).Scan(&raw); err != nil {
		return nil, err
	}
	var item map[string]any
	if err := json.Unmarshal(raw, &item); err != nil {
		return nil, err
	}
	return item, nil
}

func (repo Repository) getSingleJSON(ctx context.Context, query string, args ...any) (map[string]any, error) {
	var raw []byte
	err := repo.db.Pool().QueryRow(ctx, query, args...).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrIntegrationNotFound
	}
	if err != nil {
		return nil, err
	}
	var item map[string]any
	if err := json.Unmarshal(raw, &item); err != nil {
		return nil, err
	}
	return item, nil
}

func (repo Repository) listJSON(ctx context.Context, query string, args ...any) ([]map[string]any, error) {
	rows, err := repo.db.Pool().Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []map[string]any{}
	for rows.Next() {
		var raw []byte
		if err := rows.Scan(&raw); err != nil {
			return nil, err
		}
		var item map[string]any
		if err := json.Unmarshal(raw, &item); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (repo Repository) deleteByOrganization(ctx context.Context, tableName string, organizationID string) error {
	if tableName != "public.vista_integrations" && tableName != "public.imoview_integrations" {
		return ErrInvalidInput
	}
	tag, err := repo.db.Pool().Exec(ctx, "delete from "+tableName+" where organization_id = $1::uuid", organizationID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrIntegrationNotFound
	}
	return nil
}

func isOptionalMetaStorageError(err error) bool {
	if err == nil {
		return false
	}
	message := err.Error()
	return strings.Contains(message, `relation "public.meta_conversations" does not exist`) ||
		strings.Contains(message, `relation "meta_conversations" does not exist`) ||
		strings.Contains(message, `relation "public.meta_messages" does not exist`) ||
		strings.Contains(message, `relation "meta_messages" does not exist`) ||
		strings.Contains(message, "column mc.") ||
		strings.Contains(message, "column mm.")
}

func isOptionalMetaWebhookHealthError(err error) bool {
	if err == nil {
		return false
	}
	message := err.Error()
	return strings.Contains(message, `relation "public.meta_webhook_events" does not exist`) ||
		strings.Contains(message, `relation "meta_webhook_events" does not exist`) ||
		strings.Contains(message, "column meta_webhook_events.status does not exist") ||
		strings.Contains(message, "column meta_webhook_events.received_at does not exist") ||
		strings.Contains(message, "column meta_webhook_events.error_message does not exist") ||
		strings.Contains(message, "column meta_webhook_events.created_at does not exist") ||
		strings.Contains(message, `column "status" does not exist`) ||
		strings.Contains(message, `column "received_at" does not exist`) ||
		strings.Contains(message, `column "error_message" does not exist`) ||
		strings.Contains(message, `column "created_at" does not exist`)
}

func emptyMetaWebhookHealth(missing bool) map[string]any {
	return map[string]any{
		"counts":    map[string]int{},
		"lastError": nil,
		"missing":   missing,
	}
}

func canManageMetaIntegrations(tenantContext tenant.Context) bool {
	return tenantContext.HasPermission("settings_manage")
}

const googleCalendarIntegrationEnabled = false

func allowedFunction(name string) bool {
	switch name {
	case "google-calendar-oauth",
		"google-calendar-sync":
		return googleCalendarIntegrationEnabled
	case "vista-sync",
		"imoview-sync",
		"asaas-checkout-info",
		"asaas-create-charge",
		"asaas-payment-status",
		"asaas-cancel-payment",
		"cleanup-orphan-members",
		"change-password",
		"verify-domain-dns",
		"meta-oauth",
		"instagram-oauth",
		"meta-campaign-insights",
		"meta-messenger-proxy":
		return true
	default:
		return false
	}
}

func nonNilMap(value map[string]any) map[string]any {
	if value == nil {
		return map[string]any{}
	}
	return value
}

func nonNilStringMap(value map[string]string) map[string]string {
	if value == nil {
		return map[string]string{}
	}
	return value
}

func nonNilStrings(value []string) []string {
	if value == nil {
		return []string{}
	}
	return value
}

func cleanString(value *string) *string {
	if value == nil {
		return nil
	}
	cleaned := strings.TrimSpace(*value)
	if cleaned == "" {
		return nil
	}
	return &cleaned
}

func cleanTextFromAny(value any) *string {
	text := cleanStringFromAny(value)
	if text == "" {
		return nil
	}
	return &text
}

func cleanStringFromAny(value any) string {
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case fmt.Stringer:
		return strings.TrimSpace(typed.String())
	default:
		return ""
	}
}

func plainSecretValue(value *string) *string {
	if value == nil {
		return nil
	}
	text := strings.TrimSpace(*value)
	text = strings.TrimPrefix(text, "plain:")
	if text == "" {
		return nil
	}
	return &text
}

func nullableString(value *string) any {
	if value == nil {
		return nil
	}
	return *value
}
