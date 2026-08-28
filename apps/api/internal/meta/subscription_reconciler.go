package meta

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const (
	metaWebhookSubscriptionReconcileBatch         = 10
	metaWebhookSubscriptionReconcileStaleAfter    = "6 hours"
	metaWebhookSubscriptionReconcileRetryCooldown = "1 minute"

	metaWebhookSubscriptionReconcileFailed    = "meta_webhook_subscription_reconcile_failed"
	metaWebhookMessagingAuthorizationRequired = "meta_messaging_authorization_required"
)

var errMetaWebhookSubscriptionReconcile = errors.New("Meta webhook subscription reconciliation failed")

var (
	metaLeadgenSubscribedFields   = []string{"leadgen"}
	metaMessagingSubscribedFields = []string{
		"leadgen",
		"messages",
		"messaging_postbacks",
	}
)

type webhookSubscriptionTarget struct {
	IntegrationID           string
	OrganizationID          string
	PageID                  string
	PageToken               string
	MessagingModulesEnabled bool
	MessagingAuthorized     bool
}

const loadWebhookSubscriptionTargetsQuery = `
	with eligibility as (
		select
		  integration.id::text as integration_id,
		  integration.organization_id::text as organization_id,
		  btrim(integration.page_id) as page_id,
		  page_secret.decrypted_secret as page_token,
		  integration.subscribed_fields,
		  integration.subscription_reconciled_at,
		  integration.last_error,
		  integration.updated_at,
		  (
		    exists (
		      select 1
		      from public.organization_modules as campaigns_module
		      where campaigns_module.organization_id = integration.organization_id
		        and lower(btrim(campaigns_module.module_name)) = 'campaigns'
		        and campaigns_module.is_enabled = true
		    )
		    and exists (
		      select 1
		      from public.organization_modules as whatsapp_module
		      where whatsapp_module.organization_id = integration.organization_id
		        and lower(btrim(whatsapp_module.module_name)) = 'whatsapp'
		        and whatsapp_module.is_enabled = true
		    )
		  ) as messaging_modules_enabled,
		  (
		    exists (
		      select 1
		      from unnest(coalesce(integration.granted_scopes, array[]::text[])) as granted_scope(value)
		      where lower(btrim(granted_scope.value)) = 'pages_messaging'
		    )
		    and (
		      nullif(btrim(integration.instagram_business_account_id), '') is null
		      or exists (
		        select 1
		        from unnest(coalesce(integration.granted_scopes, array[]::text[])) as instagram_scope(value)
		        where lower(btrim(instagram_scope.value)) = 'instagram_manage_messages'
		      )
		    )
		  ) as messaging_authorized
		from public.meta_integrations as integration
		join vault.decrypted_secrets as page_secret
		  on page_secret.id = integration.access_token_secret_ref
		where coalesce(integration.is_connected, false) = true
		  and coalesce(integration.token_status, 'active') = 'active'
		  and nullif(btrim(integration.page_id), '') is not null
		  and nullif(page_secret.decrypted_secret, '') is not null
	), candidates as (
		select eligibility.*,
		  case
		    when messaging_modules_enabled and messaging_authorized
		      then '["leadgen", "messages", "messaging_postbacks"]'::jsonb
		    else '["leadgen"]'::jsonb
		  end as desired_fields
		from eligibility
	)
	select
	  integration_id,
	  organization_id,
	  page_id,
	  page_token,
	  messaging_modules_enabled,
	  messaging_authorized
	from candidates
	where (
	  subscribed_fields is distinct from desired_fields
	  or subscription_reconciled_at is null
	  or subscription_reconciled_at < now() - $2::interval
	  or (
	    messaging_modules_enabled
	    and not messaging_authorized
	    and last_error is distinct from $5
	  )
	  or (
	    not messaging_modules_enabled
	    and last_error = $5
	  )
	)
	and (
	  last_error is distinct from $4
	  or updated_at < now() - $3::interval
	)
	order by
	  (subscribed_fields is distinct from desired_fields) desc,
	  subscription_reconciled_at asc nulls first,
	  integration_id
	limit $1
`

// ReconcileWebhookSubscriptions keeps the provider subscription aligned with
// current module entitlements without running OAuth again. Page credentials
// are decrypted only inside the backend database connection and never written
// to logs, error columns, or request URLs.
func (repo Repository) ReconcileWebhookSubscriptions(ctx context.Context) error {
	if repo.db == nil || strings.TrimSpace(repo.config.AppSecret) == "" {
		return errMetaWebhookSubscriptionReconcile
	}

	targets, err := repo.loadWebhookSubscriptionTargets(ctx)
	if err != nil {
		return errMetaWebhookSubscriptionReconcile
	}

	hadFailure := false
	for _, target := range targets {
		if err := ctx.Err(); err != nil {
			return err
		}

		fields, authorizationRequired := desiredWebhookSubscribedFields(target)
		if err := repo.subscribeWebhookFields(ctx, target.PageID, target.PageToken, fields); err != nil {
			hadFailure = true
			if updateErr := repo.markWebhookSubscriptionReconcileFailed(ctx, target); updateErr != nil {
				hadFailure = true
			}
			continue
		}
		if err := repo.finishWebhookSubscriptionReconcile(ctx, target, fields, authorizationRequired); err != nil {
			hadFailure = true
		}
	}

	if hadFailure {
		return errMetaWebhookSubscriptionReconcile
	}
	return nil
}

func (repo Repository) loadWebhookSubscriptionTargets(ctx context.Context) ([]webhookSubscriptionTarget, error) {
	rows, err := repo.db.Pool().Query(
		ctx,
		loadWebhookSubscriptionTargetsQuery,
		metaWebhookSubscriptionReconcileBatch,
		metaWebhookSubscriptionReconcileStaleAfter,
		metaWebhookSubscriptionReconcileRetryCooldown,
		metaWebhookSubscriptionReconcileFailed,
		metaWebhookMessagingAuthorizationRequired,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	targets := make([]webhookSubscriptionTarget, 0, metaWebhookSubscriptionReconcileBatch)
	for rows.Next() {
		var target webhookSubscriptionTarget
		if err := rows.Scan(
			&target.IntegrationID,
			&target.OrganizationID,
			&target.PageID,
			&target.PageToken,
			&target.MessagingModulesEnabled,
			&target.MessagingAuthorized,
		); err != nil {
			return nil, err
		}
		targets = append(targets, target)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return targets, nil
}

func desiredWebhookSubscribedFields(target webhookSubscriptionTarget) ([]string, bool) {
	if !target.MessagingModulesEnabled {
		return append([]string(nil), metaLeadgenSubscribedFields...), false
	}
	if !target.MessagingAuthorized {
		return append([]string(nil), metaLeadgenSubscribedFields...), true
	}
	return append([]string(nil), metaMessagingSubscribedFields...), false
}

func (repo Repository) subscribeWebhookFields(ctx context.Context, pageID string, pageToken string, fields []string) error {
	pageID = strings.TrimSpace(pageID)
	pageToken = strings.TrimSpace(pageToken)
	appSecret := strings.TrimSpace(repo.config.AppSecret)
	if pageID == "" || pageToken == "" || appSecret == "" || len(fields) == 0 {
		return errMetaWebhookSubscriptionReconcile
	}

	graphBaseURL := strings.TrimSpace(repo.config.GraphBaseURL)
	if graphBaseURL == "" {
		graphBaseURL = oauthDefaultGraphURL
	}
	graphBase, err := validateOAuthProviderURL(graphBaseURL, true)
	if err != nil || (!isOAuthLoopbackHost(graphBase.Hostname()) && !strings.EqualFold(graphBase.Hostname(), "graph.facebook.com")) {
		return errMetaWebhookSubscriptionReconcile
	}
	graphVersion := strings.TrimSpace(repo.config.GraphVersion)
	if graphVersion == "" {
		graphVersion = oauthDefaultGraphVersion
	}
	if !oauthGraphVersionPattern.MatchString(graphVersion) {
		return errMetaWebhookSubscriptionReconcile
	}

	httpClient := repo.client
	if httpClient == nil {
		httpClient = &http.Client{
			Timeout: 15 * time.Second,
			CheckRedirect: func(*http.Request, []*http.Request) error {
				return http.ErrUseLastResponse
			},
		}
	}
	graph := oauthGraphClient{
		appSecret:      appSecret,
		graphVersion:   graphVersion,
		graphBaseURL:   graphBase,
		httpClient:     httpClient,
		requestTimeout: httpClient.Timeout,
	}
	payload, err := graph.graphRequest(
		ctx,
		http.MethodPost,
		pageID+"/subscribed_apps",
		pageToken,
		nil,
		url.Values{"subscribed_fields": []string{strings.Join(fields, ",")}},
	)
	if err != nil || payload["success"] != true {
		return errMetaWebhookSubscriptionReconcile
	}
	return nil
}

func (repo Repository) finishWebhookSubscriptionReconcile(
	ctx context.Context,
	target webhookSubscriptionTarget,
	fields []string,
	authorizationRequired bool,
) error {
	fieldsJSON, err := json.Marshal(fields)
	if err != nil {
		return err
	}
	_, err = repo.db.Pool().Exec(ctx, `
		update public.meta_integrations
		set subscribed_fields = $4::jsonb,
		    subscription_reconciled_at = now(),
		    webhook_subscribed_at = now(),
		    last_error = case
		      when $5 then $6
		      when last_error in (
		        $7,
		        $6
		      ) then null
		      else last_error
		    end,
		    updated_at = now()
		where id = $1::uuid
		  and organization_id = $2::uuid
		  and page_id = $3
		  and coalesce(is_connected, false) = true
	`,
		target.IntegrationID,
		target.OrganizationID,
		target.PageID,
		string(fieldsJSON),
		authorizationRequired,
		metaWebhookMessagingAuthorizationRequired,
		metaWebhookSubscriptionReconcileFailed,
	)
	return err
}

func (repo Repository) markWebhookSubscriptionReconcileFailed(ctx context.Context, target webhookSubscriptionTarget) error {
	_, err := repo.db.Pool().Exec(ctx, `
		update public.meta_integrations
		set last_error = $4,
		    updated_at = now()
		where id = $1::uuid
		  and organization_id = $2::uuid
		  and page_id = $3
		  and coalesce(is_connected, false) = true
	`, target.IntegrationID, target.OrganizationID, target.PageID, metaWebhookSubscriptionReconcileFailed)
	return err
}
