package meta

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

type oauthPostgresStore struct {
	db *dbpkg.Postgres
}

const oauthPublicIntegrationJSON = `jsonb_strip_nulls(jsonb_build_object(
	'id', integration.id::text,
	'organization_id', integration.organization_id::text,
	'page_id', integration.page_id,
	'page_name', integration.page_name,
	'page_picture_url', integration.page_picture_url,
	'is_connected', integration.is_connected,
	'pipeline_id', integration.pipeline_id::text,
	'stage_id', integration.stage_id::text,
	'default_status', integration.default_status,
	'ad_account_id', integration.ad_account_id,
	'selected_ad_accounts', coalesce(integration.selected_ad_accounts, '[]'::jsonb),
	'token_status', integration.token_status,
	'token_expires_at', integration.token_expires_at,
	'last_validated_at', integration.last_validated_at,
	'webhook_subscribed_at', integration.webhook_subscribed_at,
	'subscribed_fields', coalesce(integration.subscribed_fields, '["leadgen"]'::jsonb),
	'subscription_reconciled_at', integration.subscription_reconciled_at,
	'health_status', integration.health_status,
	'facebook_user_id', integration.facebook_user_id,
	'facebook_user_name', integration.facebook_user_name,
	'instagram_business_account_id', integration.instagram_business_account_id,
	'instagram_username', integration.instagram_username,
	'integration_type', integration.integration_type,
	'created_at', integration.created_at,
	'updated_at', integration.updated_at
))`

const oauthFlowUserTokenSecretRefKey = "user_token_secret_ref"

// oauthStoredFlowPayload is the only representation serialized into
// meta_oauth_flows.payload. The long-lived user token is deliberately absent;
// only its short-lived Vault reference crosses the callback/connect boundary.
// This type is database-internal and must never be used in an HTTP response.
type oauthStoredFlowPayload struct {
	Success            bool             `json:"success"`
	UserTokenSecretRef string           `json:"user_token_secret_ref"`
	TokenExpiresAt     *time.Time       `json:"token_expires_at,omitempty"`
	GrantedScopes      []string         `json:"granted_scopes"`
	FacebookUserID     string           `json:"facebook_user_id"`
	FacebookUserName   *string          `json:"facebook_user_name,omitempty"`
	Pages              []map[string]any `json:"pages"`
	AdAccounts         []oauthAdAccount `json:"ad_accounts"`
	AdAccountID        *string          `json:"ad_account_id,omitempty"`
}

func newOAuthStoredFlowPayload(payload oauthFlowPayload, secretRef string) oauthStoredFlowPayload {
	return oauthStoredFlowPayload{
		Success:            payload.Success,
		UserTokenSecretRef: secretRef,
		TokenExpiresAt:     payload.TokenExpiresAt,
		GrantedScopes:      append([]string(nil), payload.GrantedScopes...),
		FacebookUserID:     payload.FacebookUserID,
		FacebookUserName:   payload.FacebookUserName,
		Pages:              append([]map[string]any(nil), payload.Pages...),
		AdAccounts:         append([]oauthAdAccount(nil), payload.AdAccounts...),
		AdAccountID:        payload.AdAccountID,
	}
}

func (store oauthPostgresStore) createFlow(ctx context.Context, flow oauthFlow) error {
	_, err := store.db.Pool().Exec(ctx, `
		insert into public.meta_oauth_flows (
			id, organization_id, user_id, nonce, return_url, status, payload,
			error_message, expires_at, consumed_at, updated_at
		)
		values ($1::uuid, $2::uuid, $3::uuid, $4, $5, 'pending', null, null, $6, null, now())
	`, flow.ID, flow.OrganizationID, flow.UserID, flow.NonceHash, flow.ReturnURL, flow.ExpiresAt)
	if err != nil {
		return newOAuthFailure("oauth_flow_create_failed", http.StatusInternalServerError, err)
	}
	return nil
}

func (store oauthPostgresStore) purgeUserFlowPayloads(ctx context.Context, auth oauthAuthContext) {
	tx, err := store.db.Pool().Begin(ctx)
	if err != nil {
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()

	rows, err := tx.Query(ctx, `
		select id::text, coalesce(payload->>$3, '')
		from public.meta_oauth_flows
		where organization_id = $1::uuid
		  and user_id = $2::uuid
		  and payload is not null
		  and (expires_at <= now() or consumed_at is not null)
		for update
	`, auth.OrganizationID, auth.UserID, oauthFlowUserTokenSecretRefKey)
	if err != nil {
		return
	}
	type transientSecret struct {
		flowID    string
		secretRef string
	}
	secrets := make([]transientSecret, 0)
	for rows.Next() {
		var secret transientSecret
		if err := rows.Scan(&secret.flowID, &secret.secretRef); err != nil {
			rows.Close()
			return
		}
		if secret.secretRef = strings.TrimSpace(secret.secretRef); secret.secretRef != "" {
			secrets = append(secrets, secret)
		}
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return
	}
	rows.Close()

	for _, secret := range secrets {
		if _, err := deleteOAuthFlowTransientSecret(ctx, tx, secret.flowID, secret.secretRef, false); err != nil {
			return
		}
	}
	if _, err := tx.Exec(ctx, `
		update public.meta_oauth_flows
		set payload = null,
		    status = case
		      when expires_at <= now() and status in ('pending', 'success') then 'error'
		      else status
		    end,
		    error_message = case
		      when expires_at <= now() and status in ('pending', 'success') then 'oauth_flow_expired'
		      else error_message
		    end,
		    updated_at = now()
		where organization_id = $1::uuid
		  and user_id = $2::uuid
		  and payload is not null
		  and (expires_at <= now() or consumed_at is not null)
	`, auth.OrganizationID, auth.UserID); err != nil {
		return
	}
	_ = tx.Commit(ctx)
}

func (store oauthPostgresStore) loadFlow(ctx context.Context, flowID string, nonceHash string) (oauthFlow, error) {
	var flow oauthFlow
	err := store.db.Pool().QueryRow(ctx, `
		select id::text, organization_id::text, user_id::text, nonce, return_url,
		       status, expires_at, consumed_at
		from public.meta_oauth_flows
		where id = $1::uuid and nonce = $2
		limit 1
	`, flowID, nonceHash).Scan(
		&flow.ID,
		&flow.OrganizationID,
		&flow.UserID,
		&flow.NonceHash,
		&flow.ReturnURL,
		&flow.Status,
		&flow.ExpiresAt,
		&flow.ConsumedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return oauthFlow{}, newOAuthFailure("invalid_oauth_state", http.StatusBadRequest)
	}
	if err != nil {
		return oauthFlow{}, newOAuthFailure("oauth_flow_lookup_failed", http.StatusInternalServerError, err)
	}
	return flow, nil
}

func (store oauthPostgresStore) claimCallback(ctx context.Context, flow oauthFlow) error {
	var claimed string
	err := store.db.Pool().QueryRow(ctx, `
		update public.meta_oauth_flows
		set status = 'error',
		    error_message = 'oauth_callback_processing',
		    updated_at = now()
		where id = $1::uuid
		  and nonce = $2
		  and status = 'pending'
		  and consumed_at is null
		  and expires_at > now()
		returning id::text
	`, flow.ID, flow.NonceHash).Scan(&claimed)
	if errors.Is(err, pgx.ErrNoRows) {
		return newOAuthFailure("oauth_state_already_used", http.StatusBadRequest)
	}
	if err != nil {
		return newOAuthFailure("oauth_flow_claim_failed", http.StatusInternalServerError, err)
	}
	return nil
}

func (store oauthPostgresStore) finishCallbackError(ctx context.Context, flow oauthFlow, code string) error {
	if !oauthSafeErrorPattern.MatchString(code) {
		code = "meta_oauth_failed"
	}
	tx, err := store.db.Pool().Begin(ctx)
	if err != nil {
		return newOAuthFailure("oauth_flow_update_failed", http.StatusInternalServerError, err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var secretRef string
	err = tx.QueryRow(ctx, `
		select coalesce(payload->>$3, '')
		from public.meta_oauth_flows
		where id = $1::uuid
		  and nonce = $2
		  and status = 'error'
		  and error_message = 'oauth_callback_processing'
		for update
	`, flow.ID, flow.NonceHash, oauthFlowUserTokenSecretRefKey).Scan(&secretRef)
	if errors.Is(err, pgx.ErrNoRows) {
		return newOAuthFailure("oauth_flow_update_failed", http.StatusInternalServerError)
	}
	if err != nil {
		return newOAuthFailure("oauth_flow_update_failed", http.StatusInternalServerError, err)
	}
	if _, err := deleteOAuthFlowTransientSecret(ctx, tx, flow.ID, secretRef, false); err != nil {
		return newOAuthFailure("oauth_flow_update_failed", http.StatusInternalServerError, err)
	}

	command, err := tx.Exec(ctx, `
		update public.meta_oauth_flows
		set status = 'error', payload = null, error_message = $3, updated_at = now()
		where id = $1::uuid
		  and nonce = $2
		  and status = 'error'
		  and error_message = 'oauth_callback_processing'
	`, flow.ID, flow.NonceHash, code)
	if err != nil || command.RowsAffected() != 1 {
		return newOAuthFailure("oauth_flow_update_failed", http.StatusInternalServerError, err)
	}
	if err := tx.Commit(ctx); err != nil {
		return newOAuthFailure("oauth_flow_update_failed", http.StatusInternalServerError, err)
	}
	return nil
}

func (store oauthPostgresStore) finishCallbackSuccess(ctx context.Context, flow oauthFlow, payload oauthFlowPayload) error {
	userToken, err := oauthRequiredUserToken(payload.UserToken)
	if err != nil {
		return newOAuthFailure("oauth_flow_update_failed", http.StatusInternalServerError, err)
	}
	tx, err := store.db.Pool().Begin(ctx)
	if err != nil {
		return newOAuthFailure("oauth_flow_update_failed", http.StatusInternalServerError, err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var secretRef string
	err = tx.QueryRow(ctx, `
		select vault.create_secret($1, $2, $3)::text
	`,
		pgx.QueryExecModeExec,
		userToken,
		"meta-oauth-flow:"+flow.ID,
		"Transient Meta long-lived user token for OAuth connect",
	).Scan(&secretRef)
	if err != nil || strings.TrimSpace(secretRef) == "" {
		return newOAuthFailure("oauth_flow_update_failed", http.StatusInternalServerError, err)
	}
	storedPayload := newOAuthStoredFlowPayload(payload, secretRef)
	raw, err := json.Marshal(storedPayload)
	if err != nil {
		return newOAuthFailure("oauth_flow_update_failed", http.StatusInternalServerError, err)
	}
	command, err := tx.Exec(ctx, `
		update public.meta_oauth_flows
		set status = 'success', payload = $3::jsonb, error_message = null, updated_at = now()
		where id = $1::uuid
		  and nonce = $2
		  and status = 'error'
		  and error_message = 'oauth_callback_processing'
	`, pgx.QueryExecModeExec, flow.ID, flow.NonceHash, string(raw))
	if err != nil || command.RowsAffected() != 1 {
		return newOAuthFailure("oauth_flow_update_failed", http.StatusInternalServerError, err)
	}
	if err := tx.Commit(ctx); err != nil {
		return newOAuthFailure("oauth_flow_update_failed", http.StatusInternalServerError, err)
	}
	return nil
}

func (store oauthPostgresStore) claimConnectFlow(
	ctx context.Context,
	auth oauthAuthContext,
	flowID string,
	pageID string,
	selectedAccounts []string,
) (oauthFlowPayload, error) {
	selectedJSON, marshalErr := json.Marshal(selectedAccounts)
	if marshalErr != nil {
		return oauthFlowPayload{}, newOAuthFailure("invalid_ad_account_selection", http.StatusBadRequest, marshalErr)
	}
	tx, err := store.db.Pool().Begin(ctx)
	if err != nil {
		return oauthFlowPayload{}, newOAuthFailure("oauth_flow_claim_failed", http.StatusInternalServerError, err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// A crashed provider/database attempt may leave the short-lived flow in a
	// processing state. Release only stale claims; the connect operation is
	// idempotent at both the Meta subscription and integration upsert layers.
	_, _ = tx.Exec(ctx, `
		update public.meta_oauth_flows
		set status = 'success', error_message = null, updated_at = now()
		where id = $1::uuid
		  and organization_id = $2::uuid
		  and user_id = $3::uuid
		  and status = 'error'
		  and error_message = 'oauth_connect_processing'
		  and consumed_at is null
		  and expires_at > now()
		  and updated_at < now() - interval '2 minutes'
	`, flowID, auth.OrganizationID, auth.UserID)

	var raw []byte
	var userToken string
	var secretRef string
	err = tx.QueryRow(ctx, `
		select flow.payload - $6,
		       secret.decrypted_secret,
		       secret.id::text
		from public.meta_oauth_flows as flow
		join vault.decrypted_secrets as secret
		  on secret.id = private.meta_oauth_flow_transient_secret_id(flow.payload)
		 and secret.name = 'meta-oauth-flow:' || flow.id::text
		where flow.id = $2::uuid
		  and flow.organization_id = $1::uuid
		  and flow.user_id = $3::uuid
		  and flow.status = 'success'
		  and flow.consumed_at is null
		  and flow.expires_at > now()
		  and jsonb_typeof(flow.payload) = 'object'
		  and not (flow.payload ? 'user_token')
		  and exists (
			select 1
			from jsonb_array_elements(
				case when jsonb_typeof(flow.payload->'pages') = 'array'
					then flow.payload->'pages' else '[]'::jsonb end
			) as page
			where page->>'id' = $4
		  )
		  and not exists (
			select 1
			from jsonb_array_elements_text($5::jsonb) as requested(account_id)
			where not exists (
				select 1
				from jsonb_array_elements(
					case when jsonb_typeof(flow.payload->'ad_accounts') = 'array'
						then flow.payload->'ad_accounts' else '[]'::jsonb end
				) as account
				where case
					when account->>'id' ~ '^act_[0-9]{1,32}$' then account->>'id'
					when account->>'account_id' ~ '^[0-9]{1,32}$' then 'act_' || (account->>'account_id')
					else null
				end = requested.account_id
			)
		  )
		for update of flow
	`,
		auth.OrganizationID,
		flowID,
		auth.UserID,
		pageID,
		string(selectedJSON),
		oauthFlowUserTokenSecretRefKey,
	).Scan(&raw, &userToken, &secretRef)
	if errors.Is(err, pgx.ErrNoRows) {
		return oauthFlowPayload{}, newOAuthFailure("oauth_flow_not_available", http.StatusConflict)
	}
	if err != nil {
		return oauthFlowPayload{}, newOAuthFailure("oauth_flow_claim_failed", http.StatusInternalServerError, err)
	}
	var payload oauthFlowPayload
	decodeErr := json.Unmarshal(raw, &payload)
	validatedToken, tokenErr := oauthRequiredUserToken(userToken)
	if decodeErr != nil || tokenErr != nil || !payload.Success {
		if _, deleteErr := deleteOAuthFlowTransientSecret(ctx, tx, flowID, secretRef, false); deleteErr != nil {
			return oauthFlowPayload{}, newOAuthFailure("oauth_flow_claim_failed", http.StatusInternalServerError, deleteErr)
		}
		if _, updateErr := tx.Exec(ctx, `
			update public.meta_oauth_flows
			set status = 'error',
			    payload = null,
			    error_message = 'oauth_flow_payload_invalid',
			    updated_at = now()
			where id = $1::uuid
		`, flowID); updateErr != nil {
			return oauthFlowPayload{}, newOAuthFailure("oauth_flow_claim_failed", http.StatusInternalServerError, updateErr)
		}
		if commitErr := tx.Commit(ctx); commitErr != nil {
			return oauthFlowPayload{}, newOAuthFailure("oauth_flow_claim_failed", http.StatusInternalServerError, commitErr)
		}
		return oauthFlowPayload{}, newOAuthFailure("oauth_flow_payload_invalid", http.StatusConflict, errors.Join(decodeErr, tokenErr))
	}
	command, err := tx.Exec(ctx, `
		update public.meta_oauth_flows
		set status = 'error',
		    error_message = 'oauth_connect_processing',
		    updated_at = now()
		where id = $2::uuid
		  and organization_id = $1::uuid
		  and user_id = $3::uuid
		  and status = 'success'
		  and consumed_at is null
	`, auth.OrganizationID, flowID, auth.UserID)
	if err != nil || command.RowsAffected() != 1 {
		return oauthFlowPayload{}, newOAuthFailure("oauth_flow_claim_failed", http.StatusInternalServerError, err)
	}
	if err := tx.Commit(ctx); err != nil {
		return oauthFlowPayload{}, newOAuthFailure("oauth_flow_claim_failed", http.StatusInternalServerError, err)
	}
	payload.UserToken = validatedToken
	return payload, nil
}

func (store oauthPostgresStore) finishConnectFlow(ctx context.Context, auth oauthAuthContext, flowID string) error {
	tx, err := store.db.Pool().Begin(ctx)
	if err != nil {
		return newOAuthFailure("oauth_flow_finalize_failed", http.StatusInternalServerError, err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var secretRef string
	err = tx.QueryRow(ctx, `
		select secret.id::text
		from public.meta_oauth_flows as flow
		join vault.decrypted_secrets as secret
		  on secret.id = private.meta_oauth_flow_transient_secret_id(flow.payload)
		 and secret.name = 'meta-oauth-flow:' || flow.id::text
		where flow.id = $1::uuid
		  and flow.organization_id = $2::uuid
		  and flow.user_id = $3::uuid
		  and flow.status = 'error'
		  and flow.error_message = 'oauth_connect_processing'
		  and flow.consumed_at is null
		for update of flow
	`, flowID, auth.OrganizationID, auth.UserID).Scan(&secretRef)
	if err != nil {
		return newOAuthFailure("oauth_flow_finalize_failed", http.StatusInternalServerError, err)
	}
	if _, err := deleteOAuthFlowTransientSecret(ctx, tx, flowID, secretRef, true); err != nil {
		return newOAuthFailure("oauth_flow_finalize_failed", http.StatusInternalServerError, err)
	}
	command, err := tx.Exec(ctx, `
		update public.meta_oauth_flows
		set consumed_at = now(),
		    status = 'consumed',
		    payload = jsonb_build_object('consumed', true),
		    error_message = null,
		    updated_at = now()
		where id = $1::uuid
		  and organization_id = $2::uuid
		  and user_id = $3::uuid
		  and status = 'error'
		  and error_message = 'oauth_connect_processing'
		  and consumed_at is null
	`, flowID, auth.OrganizationID, auth.UserID)
	if err != nil || command.RowsAffected() != 1 {
		return newOAuthFailure("oauth_flow_finalize_failed", http.StatusInternalServerError, err)
	}
	if err := tx.Commit(ctx); err != nil {
		return newOAuthFailure("oauth_flow_finalize_failed", http.StatusInternalServerError, err)
	}
	return nil
}

func (store oauthPostgresStore) releaseConnectFlow(ctx context.Context, auth oauthAuthContext, flowID string) error {
	command, err := store.db.Pool().Exec(ctx, `
		update public.meta_oauth_flows
		set status = 'success', error_message = null, updated_at = now()
		where id = $1::uuid
		  and organization_id = $2::uuid
		  and user_id = $3::uuid
		  and status = 'error'
		  and error_message = 'oauth_connect_processing'
		  and consumed_at is null
		  and expires_at > now()
	`, flowID, auth.OrganizationID, auth.UserID)
	if err != nil {
		return err
	}
	if command.RowsAffected() != 1 {
		return newOAuthFailure("oauth_flow_release_failed", http.StatusConflict)
	}
	return nil
}

func (store oauthPostgresStore) moduleEnabled(ctx context.Context, organizationID string, moduleName string) (bool, error) {
	var enabled bool
	err := store.db.Pool().QueryRow(ctx, `
		select coalesce(bool_or(is_enabled), false)
		from public.organization_modules
		where organization_id = $1::uuid
		  and lower(btrim(module_name)) = lower(btrim($2))
	`, organizationID, moduleName).Scan(&enabled)
	return enabled, err
}

func deleteOAuthFlowTransientSecret(ctx context.Context, tx pgx.Tx, flowID string, secretRef string, required bool) (int64, error) {
	flowID = strings.TrimSpace(flowID)
	secretRef = strings.TrimSpace(secretRef)
	if flowID == "" || secretRef == "" {
		if required {
			return 0, errors.New("Meta OAuth transient Vault reference is missing")
		}
		return 0, nil
	}
	command, err := tx.Exec(ctx, `
		delete from vault.secrets
		where id::text = $1
		  and name = $2
	`, secretRef, "meta-oauth-flow:"+flowID)
	if err != nil {
		return 0, err
	}
	deleted := command.RowsAffected()
	if required && deleted != 1 {
		return deleted, errors.New("Meta OAuth transient Vault secret was not deleted")
	}
	return deleted, nil
}

func (store oauthPostgresStore) validateDestination(ctx context.Context, organizationID string, options oauthConnectionOptions) error {
	if options.StageID != nil && options.PipelineID == nil {
		return newOAuthFailure("pipeline_required_for_stage", http.StatusBadRequest)
	}
	if options.PipelineID != nil {
		var exists bool
		err := store.db.Pool().QueryRow(ctx, `
			select exists (
				select 1 from public.pipelines
				where id = $2::uuid and organization_id = $1::uuid and is_active = true
			)
		`, organizationID, *options.PipelineID).Scan(&exists)
		if err != nil {
			return newOAuthFailure("destination_lookup_failed", http.StatusInternalServerError, err)
		}
		if !exists {
			return newOAuthFailure("pipeline_not_found", http.StatusBadRequest)
		}
	}
	if options.StageID != nil {
		var exists bool
		err := store.db.Pool().QueryRow(ctx, `
			select exists (
				select 1 from public.stages
				where id = $3::uuid
				  and organization_id = $1::uuid
				  and pipeline_id = $2::uuid
				  and is_active = true
			)
		`, organizationID, *options.PipelineID, *options.StageID).Scan(&exists)
		if err != nil {
			return newOAuthFailure("destination_lookup_failed", http.StatusInternalServerError, err)
		}
		if !exists {
			return newOAuthFailure("stage_not_found", http.StatusBadRequest)
		}
	}
	return nil
}

func (store oauthPostgresStore) getIntegration(ctx context.Context, organizationID string, pageID string) (oauthIntegration, error) {
	var integration oauthIntegration
	var selectedRaw []byte
	err := store.db.Pool().QueryRow(ctx, `
		select integration.id::text,
		       integration.organization_id::text,
		       integration.page_id,
		       integration.page_name,
		       coalesce(integration.is_connected, false),
		       coalesce(integration.selected_ad_accounts, '[]'::jsonb),
		       integration.ad_account_id,
		       coalesce(page_secret.decrypted_secret, ''),
		       coalesce(user_secret.decrypted_secret, '')
		from public.meta_integrations as integration
		left join vault.decrypted_secrets as page_secret
		  on page_secret.id = integration.access_token_secret_ref
		left join vault.decrypted_secrets as user_secret
		  on user_secret.id = integration.user_access_token_secret_ref
		where integration.organization_id = $1::uuid
		  and integration.page_id = $2
		limit 1
	`, organizationID, pageID).Scan(
		&integration.ID,
		&integration.OrganizationID,
		&integration.PageID,
		&integration.PageName,
		&integration.Connected,
		&selectedRaw,
		&integration.AdAccountID,
		&integration.PageToken,
		&integration.UserToken,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return oauthIntegration{}, newOAuthFailure("meta_integration_not_found", http.StatusNotFound)
	}
	if err != nil {
		return oauthIntegration{}, newOAuthFailure("meta_integration_lookup_failed", http.StatusInternalServerError, err)
	}
	_ = json.Unmarshal(selectedRaw, &integration.SelectedAdAccounts)
	return integration, nil
}

func (store oauthPostgresStore) integrationConnected(ctx context.Context, organizationID string, pageID string) (bool, error) {
	var connected bool
	err := store.db.Pool().QueryRow(ctx, `
		select coalesce(is_connected, false)
		from public.meta_integrations
		where organization_id = $1::uuid and page_id = $2
		limit 1
	`, organizationID, pageID).Scan(&connected)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return connected, nil
}

func (store oauthPostgresStore) persistConnectedIntegration(
	ctx context.Context,
	auth oauthAuthContext,
	page oauthPage,
	identity oauthIdentity,
	debug oauthTokenDebug,
	userToken string,
	selected []string,
	options oauthConnectionOptions,
	messengerActive bool,
) (map[string]any, error) {
	selectedJSON, _ := json.Marshal(selected)
	integrationType := "facebook"
	if page.InstagramBusinessAccountID != nil {
		integrationType = "facebook_instagram"
	}
	now := time.Now().UTC()
	subscribedFields := []string{"leadgen"}
	if messengerActive {
		subscribedFields = append(subscribedFields, "messages", "messaging_postbacks")
	}
	subscribedFieldsJSON, _ := json.Marshal(subscribedFields)
	grantedScopes := append([]string(nil), debug.Scopes...)
	arguments := []any{
		auth.OrganizationID,
		page.ID,
		page.Name,
		oauthNullable(page.PictureURL),
		page.AccessToken,
		userToken,
		oauthNullable(options.PipelineID),
		oauthNullable(options.StageID),
		options.DefaultStatus,
		oauthNullableString(firstOAuthString(selected)),
		string(selectedJSON),
		oauthNullableTime(debug.ExpiresAt),
		now,
		identity.ID,
		oauthNullable(identity.Name),
		oauthNullable(page.InstagramBusinessAccountID),
		oauthNullable(page.InstagramUsername),
		integrationType,
		string(subscribedFieldsJSON),
		grantedScopes,
	}
	updateSQL := `
		update public.meta_integrations as integration
		set page_name = $3,
		    page_picture_url = $4,
		    access_token = $5,
		    user_access_token = $6,
		    pipeline_id = $7::uuid,
		    stage_id = $8::uuid,
		    default_status = $9,
		    is_connected = true,
		    last_error = null,
		    ad_account_id = $10,
		    selected_ad_accounts = $11::jsonb,
		    token_status = 'active',
		    token_expires_at = $12,
		    last_validated_at = $13,
		    webhook_subscribed_at = $13,
		    health_status = 'healthy',
		    facebook_user_id = $14,
		    facebook_user_name = $15,
		    instagram_business_account_id = $16,
		    instagram_username = $17,
		    integration_type = $18,
		    subscribed_fields = $19::jsonb,
		    granted_scopes = $20::text[],
		    subscription_reconciled_at = $13,
		    updated_at = $13
		where integration.organization_id = $1::uuid and integration.page_id = $2
		returning ` + oauthPublicIntegrationJSON
	if result, err := store.integrationJSON(ctx, updateSQL, arguments...); err == nil && result != nil {
		return result, nil
	}

	insertSQL := `
		insert into public.meta_integrations as integration (
			organization_id, page_id, page_name, page_picture_url,
			access_token, user_access_token, pipeline_id, stage_id, default_status,
			is_connected, last_error, ad_account_id, selected_ad_accounts,
			token_status, token_expires_at, last_validated_at, webhook_subscribed_at,
			health_status, facebook_user_id, facebook_user_name,
			instagram_business_account_id, instagram_username, integration_type,
			subscribed_fields, granted_scopes, subscription_reconciled_at, updated_at
		)
		values (
			$1::uuid, $2, $3, $4, $5, $6, $7::uuid, $8::uuid, $9,
			true, null, $10, $11::jsonb, 'active', $12, $13, $13,
			'healthy', $14, $15, $16, $17, $18, $19::jsonb, $20::text[], $13, $13
		)
		returning ` + oauthPublicIntegrationJSON
	result, err := store.integrationJSON(ctx, insertSQL, arguments...)
	if err == nil && result != nil {
		return result, nil
	}
	var pgError *pgconn.PgError
	if errors.As(err, &pgError) && pgError.Code == "23505" {
		if raced, updateErr := store.integrationJSON(ctx, updateSQL, arguments...); updateErr == nil && raced != nil {
			return raced, nil
		}
		if pgError.ConstraintName == "uq_meta_integrations_connected_page_owner" ||
			pgError.ConstraintName == "uq_meta_integrations_connected_instagram_owner" {
			return nil, newOAuthFailure("meta_asset_already_connected", http.StatusConflict)
		}
	}
	return nil, newOAuthFailure("meta_integration_write_failed", http.StatusInternalServerError, err)
}

func (store oauthPostgresStore) updateIntegrationOptions(
	ctx context.Context,
	organizationID string,
	pageID string,
	options oauthConnectionOptions,
	selected []string,
	selectionSet bool,
) (map[string]any, error) {
	selectedJSON, _ := json.Marshal(selected)
	query := `
		update public.meta_integrations as integration
		set pipeline_id = $3::uuid,
		    stage_id = $4::uuid,
		    default_status = $5,
		    selected_ad_accounts = case when $6 then $7::jsonb else selected_ad_accounts end,
		    ad_account_id = case when $6 then $8 else ad_account_id end,
		    last_validated_at = case when $6 then now() else last_validated_at end,
		    last_error = case when $6 then null else last_error end,
		    updated_at = now()
		where integration.organization_id = $1::uuid and integration.page_id = $2
		returning ` + oauthPublicIntegrationJSON
	result, err := store.integrationJSON(
		ctx,
		query,
		organizationID,
		pageID,
		oauthNullable(options.PipelineID),
		oauthNullable(options.StageID),
		options.DefaultStatus,
		selectionSet,
		string(selectedJSON),
		oauthNullableString(firstOAuthString(selected)),
	)
	if err != nil || result == nil {
		return nil, newOAuthFailure("meta_integration_write_failed", http.StatusInternalServerError, err)
	}
	return result, nil
}

func (store oauthPostgresStore) updateSelectedAccounts(ctx context.Context, organizationID string, pageID string, selected []string) (map[string]any, error) {
	selectedJSON, _ := json.Marshal(selected)
	query := `
		update public.meta_integrations as integration
		set selected_ad_accounts = $3::jsonb,
		    ad_account_id = $4,
		    last_validated_at = now(),
		    last_error = null,
		    updated_at = now()
		where integration.organization_id = $1::uuid and integration.page_id = $2
		returning ` + oauthPublicIntegrationJSON
	result, err := store.integrationJSON(ctx, query, organizationID, pageID, string(selectedJSON), oauthNullableString(firstOAuthString(selected)))
	if err != nil || result == nil {
		return nil, newOAuthFailure("meta_integration_write_failed", http.StatusInternalServerError, err)
	}
	return result, nil
}

func (store oauthPostgresStore) setIntegrationState(ctx context.Context, organizationID string, pageID string, values map[string]any) error {
	connected, _ := values["is_connected"].(bool)
	health := oauthString(values["health_status"])
	lastError := oauthString(values["last_error"])
	tokenStatus := oauthString(values["token_status"])
	_, err := store.db.Pool().Exec(ctx, `
		update public.meta_integrations
		set is_connected = $3,
		    health_status = coalesce(nullif($4, ''), health_status),
		    last_error = nullif($5, ''),
		    token_status = coalesce(nullif($6, ''), token_status),
		    updated_at = now()
		where organization_id = $1::uuid and page_id = $2
	`, organizationID, pageID, connected, health, lastError, tokenStatus)
	if err != nil {
		return newOAuthFailure("meta_integration_write_failed", http.StatusInternalServerError, err)
	}
	return nil
}

func (store oauthPostgresStore) refreshIntegrationMetadata(ctx context.Context, organizationID string, page oauthPage, messengerActive bool) error {
	integrationType := "facebook"
	if page.InstagramBusinessAccountID != nil {
		integrationType = "facebook_instagram"
	}
	subscribedFields := []string{"leadgen"}
	if messengerActive {
		subscribedFields = append(subscribedFields, "messages", "messaging_postbacks")
	}
	subscribedFieldsJSON, _ := json.Marshal(subscribedFields)
	_, err := store.db.Pool().Exec(ctx, `
		update public.meta_integrations
		set is_connected = true,
		    page_name = $3,
		    page_picture_url = $4,
		    access_token = $5,
		    instagram_business_account_id = $6,
		    instagram_username = $7,
		    integration_type = $8,
		    token_status = 'active',
		    health_status = 'healthy',
		    last_error = null,
		    last_validated_at = now(),
		    webhook_subscribed_at = now(),
		    subscribed_fields = $9::jsonb,
		    subscription_reconciled_at = now(),
		    updated_at = now()
		where organization_id = $1::uuid and page_id = $2
	`, pgx.QueryExecModeExec, organizationID, page.ID, page.Name, oauthNullable(page.PictureURL), page.AccessToken, oauthNullable(page.InstagramBusinessAccountID), oauthNullable(page.InstagramUsername), integrationType, string(subscribedFieldsJSON))
	if err != nil {
		return newOAuthFailure("meta_integration_write_failed", http.StatusInternalServerError, err)
	}
	return nil
}

func (store oauthPostgresStore) deleteIntegration(ctx context.Context, organizationID string, pageID string) error {
	command, err := store.db.Pool().Exec(ctx, `
		delete from public.meta_integrations
		where organization_id = $1::uuid and page_id = $2
	`, organizationID, pageID)
	if err != nil || command.RowsAffected() != 1 {
		return newOAuthFailure("meta_integration_delete_failed", http.StatusInternalServerError, err)
	}
	return nil
}

func (store oauthPostgresStore) integrationJSON(ctx context.Context, query string, arguments ...any) (map[string]any, error) {
	var raw []byte
	secureArguments := make([]any, 0, len(arguments)+1)
	secureArguments = append(secureArguments, pgx.QueryExecModeExec)
	secureArguments = append(secureArguments, arguments...)
	err := store.db.Pool().QueryRow(ctx, query, secureArguments...).Scan(&raw)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var value map[string]any
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil, err
	}
	return value, nil
}

func oauthNullable(value *string) any {
	if value == nil || strings.TrimSpace(*value) == "" {
		return nil
	}
	return strings.TrimSpace(*value)
}

func oauthNullableString(value string) any {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return value
}

func oauthNullableTime(value *time.Time) any {
	if value == nil {
		return nil
	}
	return value.UTC()
}

func firstOAuthString(values []string) string {
	if len(values) == 0 {
		return ""
	}
	return values[0]
}
