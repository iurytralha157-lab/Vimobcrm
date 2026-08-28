package integrations

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
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
			Timeout: 95 * time.Second,
			CheckRedirect: func(*http.Request, []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
	}
}

func (repo Repository) InvokeFunction(ctx context.Context, name string, authorization string, body []byte) (FunctionResponse, error) {
	return repo.InvokeFunctionRequest(ctx, name, http.MethodPost, authorization, body, nil, "")
}

func signedEdgeClientIPHeaders(secret string, method string, requestPath string, clientIP string, body []byte, now time.Time) (string, string, bool) {
	secret = strings.TrimSpace(secret)
	normalizedIP := net.ParseIP(strings.TrimSpace(clientIP))
	if len(secret) < 32 || normalizedIP == nil {
		return "", "", false
	}
	timestamp := fmt.Sprintf("%d", now.UTC().Unix())
	bodyDigest := sha256.Sum256(body)
	canonical := strings.Join([]string{
		"v1",
		timestamp,
		strings.ToUpper(strings.TrimSpace(method)),
		requestPath,
		normalizedIP.String(),
		hex.EncodeToString(bodyDigest[:]),
	}, "\n")
	digest := hmac.New(sha256.New, []byte(secret))
	_, _ = digest.Write([]byte(canonical))
	return timestamp, hex.EncodeToString(digest.Sum(nil)), true
}

func (repo Repository) InvokeFunctionRequest(ctx context.Context, name string, method string, authorization string, body []byte, query url.Values, clientIP string) (FunctionResponse, error) {
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
	normalizedIP := net.ParseIP(strings.TrimSpace(clientIP))
	if name == "asaas-create-charge" && normalizedIP == nil {
		return FunctionResponse{}, ErrBillingCheckoutUnavailable
	}
	if normalizedIP != nil {
		timestamp, signature, signed := signedEdgeClientIPHeaders(
			repo.external.ClientIPSigningSecret,
			method,
			endpoint.EscapedPath(),
			normalizedIP.String(),
			body,
			time.Now(),
		)
		if name == "asaas-create-charge" && !signed {
			return FunctionResponse{}, ErrBillingCheckoutUnavailable
		}
		if signed {
			request.Header.Set("X-Vimob-Client-IP", normalizedIP.String())
			request.Header.Set("X-Vimob-Client-IP-Timestamp", timestamp)
			request.Header.Set("X-Vimob-Client-IP-Signature", signature)
		}
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
		select to_jsonb(v) - 'api_key' - 'api_key_secret_ref'
		from public.vista_integrations v
		where v.organization_id = $1::uuid
		limit 1
	`, tenantContext.OrganizationID)
}

func (repo Repository) SaveVista(ctx context.Context, tenantContext tenant.Context, request VistaIntegrationRequest) (map[string]any, error) {
	apiURL, err := normalizeVistaAPIURL(request.APIURL)
	apiKey := strings.TrimSpace(request.APIKey)
	if err != nil || apiKey == "" {
		return nil, ErrInvalidInput
	}
	return repo.upsertSecretIntegration(ctx, `
		insert into public.vista_integrations (
			organization_id,
			api_url,
			api_key,
			status,
			created_by,
			is_active,
			updated_at
		)
		values ($1::uuid, $2, $3, 'connected', $4::uuid, true, now())
		on conflict (organization_id) do update
		set api_url = excluded.api_url,
		    api_key_secret_ref = excluded.api_key_secret_ref,
		    api_key = null,
		    status = 'connected',
		    last_error = null,
		    is_active = true,
		    updated_at = now()
		returning to_jsonb(vista_integrations.*) - 'api_key' - 'api_key_secret_ref'
	`, tenantContext.OrganizationID, apiURL, apiKey, tenantContext.UserID)
}

func normalizeVistaAPIURL(value string) (string, error) {
	raw := strings.TrimSpace(value)
	if raw == "" {
		return "", ErrInvalidInput
	}
	if !strings.HasPrefix(strings.ToLower(raw), "http://") && !strings.HasPrefix(strings.ToLower(raw), "https://") {
		raw = "https://" + raw
	}
	target, err := url.ParseRequestURI(raw)
	if err != nil || target.Hostname() == "" || target.User != nil {
		return "", ErrInvalidInput
	}

	host := strings.ToLower(target.Hostname())
	if host == "localhost" || strings.HasSuffix(host, ".localhost") || strings.HasSuffix(host, ".local") {
		return "", ErrInvalidInput
	}
	if ip := net.ParseIP(host); ip != nil && (ip.IsPrivate() || ip.IsLoopback() || ip.IsUnspecified() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast()) {
		return "", ErrInvalidInput
	}
	if target.Scheme == "http" && (host == "vistahost.com.br" || strings.HasSuffix(host, ".vistahost.com.br")) {
		target.Scheme = "https"
	}
	if target.Scheme != "https" || target.Port() != "" && target.Port() != "443" {
		return "", ErrInvalidInput
	}

	target.RawQuery = ""
	target.Fragment = ""
	return strings.TrimRight(target.String(), "/"), nil
}

func (repo Repository) DeleteVista(ctx context.Context, tenantContext tenant.Context) error {
	return repo.deleteByOrganization(ctx, "public.vista_integrations", tenantContext.OrganizationID)
}

func (repo Repository) GetImoview(ctx context.Context, tenantContext tenant.Context) (map[string]any, error) {
	return repo.getSingleJSON(ctx, `
		select to_jsonb(i) - 'api_key' - 'api_key_secret_ref'
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
			api_key,
			status,
			created_by,
			is_active,
			updated_at
		)
		values ($1::uuid, $2, 'connected', $3::uuid, true, now())
		on conflict (organization_id) do update
		set api_key_secret_ref = excluded.api_key_secret_ref,
		    api_key = null,
		    status = 'connected',
		    last_error = null,
		    is_active = true,
		    updated_at = now()
		returning to_jsonb(imoview_integrations.*) - 'api_key' - 'api_key_secret_ref'
	`, tenantContext.OrganizationID, apiKey, tenantContext.UserID)
}

func (repo Repository) DeleteImoview(ctx context.Context, tenantContext tenant.Context) error {
	return repo.deleteByOrganization(ctx, "public.imoview_integrations", tenantContext.OrganizationID)
}

func (repo Repository) ListMetaIntegrations(ctx context.Context, tenantContext tenant.Context) ([]map[string]any, error) {
	items, err := repo.listJSON(ctx, `
		select to_jsonb(mi) || jsonb_build_object(
			'marketing_token_available',
				exists (
					select 1
					from vault.decrypted_secrets as secret
					where secret.id = credentials.user_access_token_secret_ref
					  and nullif(secret.decrypted_secret, '') is not null
				)
				and coalesce(credentials.granted_scopes, array[]::text[]) @> array[
					'ads_read',
					'read_insights',
					'instagram_basic',
					'instagram_manage_insights'
				]::text[]
		)
		from public.meta_integrations_public mi
		join public.meta_integrations as credentials
		  on credentials.id = mi.id
		 and credentials.organization_id = mi.organization_id
		where mi.organization_id = $1::uuid
		order by mi.created_at desc
	`, tenantContext.OrganizationID)
	if err == nil {
		return items, nil
	}
	if !isMetaMarketingCapabilitySchemaMissing(err) {
		return nil, err
	}

	// During a rolling migration the legacy, tokenless projection can already
	// serve lead integrations while the durable Marketing columns are not yet
	// available. Keep the connection visible, but fail the advanced capability
	// closed until the database can prove both token presence and scopes.
	return repo.listJSON(ctx, `
		select to_jsonb(mi) || jsonb_build_object(
			'marketing_token_available', false
		)
		from public.meta_integrations_public mi
		where mi.organization_id = $1::uuid
		order by mi.created_at desc
	`, tenantContext.OrganizationID)
}

func isMetaMarketingCapabilitySchemaMissing(err error) bool {
	var databaseError *pgconn.PgError
	if !errors.As(err, &databaseError) || databaseError.Code != "42703" {
		return false
	}
	detail := strings.ToLower(databaseError.ColumnName + " " + databaseError.Message)
	return strings.Contains(detail, "user_access_token_secret_ref") ||
		strings.Contains(detail, "granted_scopes")
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
		Cursors struct {
			After string `json:"after"`
		} `json:"cursors"`
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
		select to_jsonb(mi) || jsonb_build_object(
			'access_token',
			coalesce(nullif(mi.access_token, ''), secret.decrypted_secret)
		)
		from public.meta_integrations mi
		left join vault.decrypted_secrets secret
		  on secret.id = mi.access_token_secret_ref
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

	return metaIntegrationSnapshot{
		ID:          cleanStringFromAny(item["id"]),
		AccessToken: cleanTextFromAny(item["access_token"]),
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
	query.Set("fields", "id,name,status,leads_count,questions{key,label,type}")
	query.Set("limit", "100")
	if proof := metaAppSecretProof(repo.external.MetaAppSecret, accessToken); proof != "" {
		query.Set("appsecret_proof", proof)
	}
	endpoint.RawQuery = query.Encode()

	forms := []map[string]any{}
	after := ""
	seenCursors := make(map[string]struct{})
	for page := 0; page < 10; page++ {
		pageURL := *endpoint
		pageQuery := pageURL.Query()
		if after == "" {
			pageQuery.Del("after")
		} else {
			pageQuery.Set("after", after)
		}
		pageURL.RawQuery = pageQuery.Encode()
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, pageURL.String(), nil)
		if err != nil {
			return nil, err
		}
		request.Header.Set("Accept", "application/json")
		request.Header.Set("Authorization", "Bearer "+accessToken)

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
		nextCursor := strings.TrimSpace(payload.Paging.Cursors.After)
		if strings.TrimSpace(payload.Paging.Next) == "" || nextCursor == "" {
			break
		}
		if _, repeated := seenCursors[nextCursor]; repeated {
			break
		}
		seenCursors[nextCursor] = struct{}{}
		after = nextCursor
	}

	return forms, nil
}

func metaAppSecretProof(appSecret string, accessToken string) string {
	appSecret = strings.TrimSpace(appSecret)
	accessToken = strings.TrimSpace(accessToken)
	if appSecret == "" || accessToken == "" {
		return ""
	}
	digest := hmac.New(sha256.New, []byte(appSecret))
	_, _ = digest.Write([]byte(accessToken))
	return hex.EncodeToString(digest.Sum(nil))
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
			'payload',
				jsonb_strip_nulls(jsonb_build_object(
					'flow_id',
					mof.id::text,
					'success',
					mof.payload->'success',
					'adAccountId',
					coalesce(mof.payload->'adAccountId', mof.payload->'ad_account_id'),
					'ad_accounts',
					coalesce((
						select jsonb_agg(
							jsonb_strip_nulls(jsonb_build_object(
								'id', account->'id',
								'account_id', account->'account_id',
								'name', account->'name',
								'account_status', account->'account_status',
								'currency', account->'currency',
								'timezone_name', account->'timezone_name'
							))
							order by account->>'name', account->>'id'
						)
						from jsonb_array_elements(
							case
								when jsonb_typeof(mof.payload->'ad_accounts') = 'array'
									then mof.payload->'ad_accounts'
								else '[]'::jsonb
							end
						) as account
						where nullif(account->>'id', '') is not null
					), '[]'::jsonb),
					'facebook_user_id',
					mof.payload->'facebook_user_id',
					'facebook_user_name',
					mof.payload->'facebook_user_name',
					'pages',
					coalesce((
						select jsonb_agg(
							jsonb_strip_nulls(jsonb_build_object(
								'id', page->'id',
								'name', page->'name',
								'picture',
									case
										when nullif(page #>> '{picture,data,url}', '') is not null
											then jsonb_build_object(
												'data',
												jsonb_build_object('url', page #>> '{picture,data,url}')
											)
										else null
									end,
								'instagram_business_account',
									case
										when nullif(page #>> '{instagram_business_account,id}', '') is not null
											then jsonb_strip_nulls(jsonb_build_object(
												'id', page #> '{instagram_business_account,id}',
												'username', page #> '{instagram_business_account,username}'
											))
										else null
									end,
								'facebook_user_id', page->'facebook_user_id',
								'facebook_user_name', page->'facebook_user_name'
							))
						)
						from jsonb_array_elements(
							case
								when jsonb_typeof(mof.payload->'pages') = 'array'
									then mof.payload->'pages'
								else '[]'::jsonb
							end
						) as page
					), '[]'::jsonb)
				)),
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

// ClaimMetaOAuthConnectPayload atomically consumes one OAuth result and builds
// the legacy Edge Function request on the server. Provider tokens never cross
// the browser boundary.
func (repo Repository) ClaimMetaOAuthConnectPayload(
	ctx context.Context,
	tenantContext tenant.Context,
	request map[string]any,
) ([]byte, error) {
	flowID := cleanStringFromAny(request["flow_id"])
	pageID := cleanStringFromAny(request["page_id"])
	if flowID == "" || pageID == "" {
		return nil, ErrInvalidInput
	}
	requestedAdAccounts := cleanUniqueStringList(request["selected_ad_accounts"], 50)
	if len(requestedAdAccounts) == 0 {
		if requested := cleanStringFromAny(request["ad_account_id"]); requested != "" {
			requestedAdAccounts = []string{requested}
		}
	}

	var rawPayload []byte
	err := repo.db.Pool().QueryRow(ctx, `
		with claimed as (
			select flow.id, flow.payload
			from public.meta_oauth_flows as flow
			where flow.id = $2::uuid
			  and flow.organization_id = $1::uuid
			  and flow.user_id = $3::uuid
			  and flow.consumed_at is null
			  and coalesce(flow.expires_at, now() + interval '1 minute') > now()
			  and lower(coalesce(flow.status, '')) = 'success'
			  and nullif(
					coalesce(flow.payload->>'user_token', flow.payload->>'userToken'),
					''
				  ) is not null
			  and exists (
					select 1
					from jsonb_array_elements(
						case
							when jsonb_typeof(flow.payload->'pages') = 'array'
								then flow.payload->'pages'
							else '[]'::jsonb
						end
					) as page
					where page->>'id' = $4
				  )
			  and not exists (
					select 1
					from unnest($5::text[]) as requested(account_id)
					where not exists (
						select 1
						from jsonb_array_elements(
							case
								when jsonb_typeof(flow.payload->'ad_accounts') = 'array'
									then flow.payload->'ad_accounts'
								else '[]'::jsonb
							end
						) as account
						where account->>'id' = requested.account_id
					)
					  and requested.account_id <> coalesce(
						flow.payload->>'adAccountId',
						flow.payload->>'ad_account_id',
						''
					  )
				  )
			for update
		),
		consumed as (
			update public.meta_oauth_flows as flow
			set consumed_at = now(),
			    status = 'consumed',
			    payload = jsonb_build_object(
					'success', true,
					'flow_id', flow.id::text,
					'consumed', true
				),
			    updated_at = now()
			from claimed
			where flow.id = claimed.id
			returning claimed.payload as claimed_payload
		)
		select claimed_payload
		from consumed
	`, tenantContext.OrganizationID, flowID, tenantContext.UserID, pageID, requestedAdAccounts).Scan(&rawPayload)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrIntegrationNotFound
	}
	if err != nil {
		return nil, err
	}

	var payload map[string]any
	if err := json.Unmarshal(rawPayload, &payload); err != nil {
		return nil, ErrInvalidInput
	}
	userToken := cleanStringFromAny(payload["user_token"])
	if userToken == "" {
		userToken = cleanStringFromAny(payload["userToken"])
	}
	if userToken == "" {
		return nil, ErrInvalidInput
	}

	pageFound := false
	if pages, ok := payload["pages"].([]any); ok {
		for _, rawPage := range pages {
			page, ok := rawPage.(map[string]any)
			if !ok || cleanStringFromAny(page["id"]) != pageID {
				continue
			}
			pageFound = true
			delete(request, "page_picture_url")
			if picture, ok := page["picture"].(map[string]any); ok {
				if data, ok := picture["data"].(map[string]any); ok {
					if pictureURL := cleanStringFromAny(data["url"]); pictureURL != "" {
						request["page_picture_url"] = pictureURL
					}
				}
			}
			break
		}
	}
	if !pageFound {
		return nil, ErrInvalidInput
	}

	delete(request, "flow_id")
	delete(request, "user_token")
	delete(request, "userToken")
	delete(request, "access_token")
	delete(request, "accessToken")
	request["action"] = "connect_page"
	request["code"] = userToken
	request["organization_id"] = tenantContext.OrganizationID
	request["organizationId"] = tenantContext.OrganizationID
	request["facebook_user_id"] = cleanStringFromAny(payload["facebook_user_id"])
	request["facebook_user_name"] = cleanStringFromAny(payload["facebook_user_name"])
	accessibleAdAccounts := make(map[string]struct{})
	if accounts, ok := payload["ad_accounts"].([]any); ok {
		for _, rawAccount := range accounts {
			account, ok := rawAccount.(map[string]any)
			if !ok {
				continue
			}
			if accountID := cleanStringFromAny(account["id"]); accountID != "" {
				accessibleAdAccounts[accountID] = struct{}{}
			}
		}
	}
	defaultAdAccountID := cleanStringFromAny(payload["adAccountId"])
	if defaultAdAccountID == "" {
		defaultAdAccountID = cleanStringFromAny(payload["ad_account_id"])
	}
	if defaultAdAccountID != "" {
		accessibleAdAccounts[defaultAdAccountID] = struct{}{}
	}

	selectedAdAccounts := requestedAdAccounts
	if len(selectedAdAccounts) == 0 && defaultAdAccountID != "" {
		selectedAdAccounts = []string{defaultAdAccountID}
	}
	for _, accountID := range selectedAdAccounts {
		if _, allowed := accessibleAdAccounts[accountID]; !allowed {
			return nil, ErrInvalidInput
		}
	}

	if len(selectedAdAccounts) == 0 {
		delete(request, "ad_account_id")
		delete(request, "selected_ad_accounts")
	} else {
		request["ad_account_id"] = selectedAdAccounts[0]
		request["selected_ad_accounts"] = selectedAdAccounts
	}

	return json.Marshal(request)
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

	var referencesBelongToOrganization bool
	if err := tx.QueryRow(ctx, `
		select
			exists (
				select 1
				from public.meta_integrations as integration
				where integration.organization_id = $1::uuid
				  and integration.id = $2::uuid
			)
			and (
				$3 = ''
				or exists (
					select 1
					from public.round_robins as queue
					where queue.organization_id = $1::uuid
					  and queue.id = nullif($3, '')::uuid
				)
			)
			and (
				$4 = ''
				or exists (
					select 1
					from public.properties as property
					where property.organization_id = $1::uuid
					  and property.id = nullif($4, '')::uuid
				)
			)
	`,
		tenantContext.OrganizationID,
		integrationID,
		cleanString(request.RoundRobinID),
		cleanString(request.PropertyID),
	).Scan(&referencesBelongToOrganization); err != nil {
		return nil, err
	}
	if !referencesBelongToOrganization {
		return nil, ErrInvalidInput
	}

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
	if _, err := tx.Exec(ctx, `
		delete from public.round_robin_rules
		where organization_id = $1::uuid
		  and match_type = 'meta_form'
		  and match_value = $2
	`, tenantContext.OrganizationID, formID); err != nil {
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

type metaMessageTarget struct {
	ConversationID string
	RecipientID    string
	Platform       string
	SenderID       string
	AccessToken    string
}

type metaSendMessageResponse struct {
	MessageID   string `json:"message_id"`
	RecipientID string `json:"recipient_id"`
}

// SendMetaMessage keeps the complete messaging path in the Go backend. The
// recipient, sender and Page credential are all resolved from tenant-scoped
// database state; none of them are trusted from the browser request.
func (repo Repository) SendMetaMessage(ctx context.Context, tenantContext tenant.Context, conversationID string, request SendMetaMessageRequest) (SendMetaMessageResult, error) {
	conversationID = strings.TrimSpace(conversationID)
	text := strings.TrimSpace(request.Text)
	normalizedConversationID, validConversationID := normalizeMetaIdempotencyKey(conversationID)
	clientRequestID, validKey := normalizeMetaIdempotencyKey(request.IdempotencyKey)
	if !validConversationID || text == "" || len([]rune(text)) > 2_000 || !validKey {
		return SendMetaMessageResult{}, ErrInvalidInput
	}
	conversationID = normalizedConversationID

	reservation, owned, err := repo.reserveMetaOutboundMessage(
		ctx,
		tenantContext.OrganizationID,
		conversationID,
		clientRequestID,
		text,
	)
	if err != nil {
		return SendMetaMessageResult{}, err
	}
	if !owned {
		return metaOutboundSendResult(reservation, true, false), nil
	}

	target, err := repo.metaMessageTarget(ctx, tenantContext.OrganizationID, conversationID)
	if err != nil {
		detachedCtx, cancel := metaDetachedContext()
		defer cancel()
		failed, updateErr := repo.markMetaOutboundState(
			detachedCtx,
			tenantContext.OrganizationID,
			reservation,
			"failed",
			"meta_integration_unavailable",
		)
		if updateErr != nil {
			return metaOutboundSendResult(reservation, false, false), nil
		}
		return metaOutboundSendResult(failed, false, false), nil
	}

	reservation, err = repo.markMetaOutboundAttempt(ctx, tenantContext.OrganizationID, reservation)
	if err != nil {
		// The provider must never be called unless the durable row records that
		// an attempt is about to happen.
		return SendMetaMessageResult{}, err
	}

	providerMessage, err := repo.sendMetaGraphMessage(ctx, target, text)
	if err != nil {
		status := "failed"
		errorCode := "meta_provider_rejected"
		if errors.Is(err, ErrMetaDeliveryUncertain) {
			status = "uncertain"
			errorCode = "meta_delivery_uncertain"
		}
		detachedCtx, cancel := metaDetachedContext()
		defer cancel()
		updated, updateErr := repo.markMetaOutboundState(
			detachedCtx,
			tenantContext.OrganizationID,
			reservation,
			status,
			errorCode,
		)
		if updateErr != nil {
			// The committed pending reservation still blocks all retries from
			// reaching Graph, even when recording the more precise state fails.
			return metaOutboundSendResult(reservation, false, false), nil
		}
		return metaOutboundSendResult(updated, false, false), nil
	}

	completed, err := repo.finalizeMetaOutboundMessage(
		ctx,
		tenantContext.OrganizationID,
		reservation,
		providerMessage.MessageID,
	)
	if err == nil {
		return metaOutboundSendResult(completed, false, true), nil
	}

	// Meta accepted the request but local finalization failed. Never retry the
	// provider: retain the reservation as uncertain (or pending if this best-
	// effort classification cannot be persisted).
	detachedCtx, cancel := metaDetachedContext()
	defer cancel()
	uncertain, updateErr := repo.markMetaOutboundState(
		detachedCtx,
		tenantContext.OrganizationID,
		reservation,
		"uncertain",
		"meta_persistence_uncertain",
	)
	if updateErr != nil {
		return metaOutboundSendResult(reservation, false, false), nil
	}
	return metaOutboundSendResult(uncertain, false, false), nil
}

func (repo Repository) metaMessageTarget(ctx context.Context, organizationID string, conversationID string) (metaMessageTarget, error) {
	var target metaMessageTarget
	err := repo.db.Pool().QueryRow(ctx, `
		select
			conversation.id::text,
			conversation.external_id,
			conversation.platform,
			coalesce(case
				when conversation.platform = 'instagram'
					then nullif(integration.instagram_business_account_id, '')
				else nullif(integration.page_id, '')
			end, '') as sender_id,
			coalesce(nullif(secret.decrypted_secret, ''), nullif(integration.access_token, ''), '')
		from public.meta_conversations conversation
		join lateral (
			select candidate.*
			from public.meta_integrations candidate
			where candidate.organization_id = conversation.organization_id
			  and candidate.page_id = conversation.page_id
			  and coalesce(candidate.is_connected, false) = true
			order by candidate.updated_at desc nulls last, candidate.created_at desc
			limit 1
		) integration on true
		left join vault.decrypted_secrets secret
		  on secret.id = integration.access_token_secret_ref
		where conversation.organization_id = $1::uuid
		  and conversation.id::text = $2
		limit 1
	`, organizationID, conversationID).Scan(
		&target.ConversationID,
		&target.RecipientID,
		&target.Platform,
		&target.SenderID,
		&target.AccessToken,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return metaMessageTarget{}, ErrIntegrationNotFound
	}
	if err != nil {
		return metaMessageTarget{}, err
	}
	if strings.TrimSpace(target.RecipientID) == "" || strings.TrimSpace(target.SenderID) == "" || strings.TrimSpace(target.AccessToken) == "" {
		return metaMessageTarget{}, ErrIntegrationNotFound
	}
	if target.Platform != "messenger" && target.Platform != "instagram" {
		return metaMessageTarget{}, ErrInvalidInput
	}
	return target, nil
}

func (repo Repository) sendMetaGraphMessage(ctx context.Context, target metaMessageTarget, text string) (metaSendMessageResponse, error) {
	endpoint, err := url.Parse(
		strings.TrimRight(repo.external.MetaGraphBaseURL, "/") + "/" +
			strings.Trim(strings.TrimSpace(repo.external.MetaGraphVersion), "/") + "/" +
			url.PathEscape(target.SenderID) + "/messages",
	)
	if err != nil {
		return metaSendMessageResponse{}, fmt.Errorf("%w: invalid graph endpoint", ErrMetaUpstream)
	}
	query := endpoint.Query()
	if proof := metaAppSecretProof(repo.external.MetaAppSecret, target.AccessToken); proof != "" {
		query.Set("appsecret_proof", proof)
	}
	endpoint.RawQuery = query.Encode()

	payload := map[string]any{
		"recipient": map[string]string{"id": target.RecipientID},
		"message":   map[string]string{"text": text},
	}
	if target.Platform == "messenger" {
		payload["messaging_type"] = "RESPONSE"
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return metaSendMessageResponse{}, err
	}

	requestCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	graphRequest, err := http.NewRequestWithContext(requestCtx, http.MethodPost, endpoint.String(), bytes.NewReader(body))
	if err != nil {
		return metaSendMessageResponse{}, fmt.Errorf("%w: request creation failed", ErrMetaUpstream)
	}
	graphRequest.Header.Set("Accept", "application/json")
	graphRequest.Header.Set("Content-Type", "application/json")
	graphRequest.Header.Set("Authorization", "Bearer "+target.AccessToken)

	response, err := repo.client.Do(graphRequest)
	if err != nil {
		return metaSendMessageResponse{}, fmt.Errorf("%w: %w", ErrMetaUpstream, ErrMetaDeliveryUncertain)
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 64<<10))
		if response.StatusCode == http.StatusRequestTimeout ||
			response.StatusCode == http.StatusTooEarly ||
			response.StatusCode == http.StatusTooManyRequests ||
			response.StatusCode >= http.StatusInternalServerError {
			return metaSendMessageResponse{}, fmt.Errorf(
				"%w: %w",
				ErrMetaUpstream,
				ErrMetaDeliveryUncertain,
			)
		}
		return metaSendMessageResponse{}, fmt.Errorf("%w: graph status %d", ErrMetaUpstream, response.StatusCode)
	}

	var result metaSendMessageResponse
	decoder := json.NewDecoder(io.LimitReader(response.Body, 1<<20))
	if err := decoder.Decode(&result); err != nil {
		return metaSendMessageResponse{}, fmt.Errorf("%w: %w", ErrMetaUpstream, ErrMetaDeliveryUncertain)
	}
	result.MessageID = strings.TrimSpace(result.MessageID)
	result.RecipientID = strings.TrimSpace(result.RecipientID)
	if result.MessageID == "" {
		return metaSendMessageResponse{}, fmt.Errorf("%w: %w", ErrMetaUpstream, ErrMetaDeliveryUncertain)
	}
	return result, nil
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
	return tenantContext.HasPermission(permissions.SettingsIntegrations)
}

const googleCalendarIntegrationEnabled = true

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
		"verify-domain-dns":
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

func cleanUniqueStringList(value any, limit int) []string {
	if limit <= 0 {
		return []string{}
	}

	items := make([]string, 0)
	seen := make(map[string]struct{})
	appendValue := func(raw any) {
		if len(items) >= limit {
			return
		}
		cleaned := cleanStringFromAny(raw)
		if cleaned == "" {
			return
		}
		if _, exists := seen[cleaned]; exists {
			return
		}
		seen[cleaned] = struct{}{}
		items = append(items, cleaned)
	}

	switch typed := value.(type) {
	case []any:
		for _, raw := range typed {
			appendValue(raw)
		}
	case []string:
		for _, raw := range typed {
			appendValue(raw)
		}
	}

	return items
}

func nullableString(value *string) any {
	if value == nil {
		return nil
	}
	return *value
}
