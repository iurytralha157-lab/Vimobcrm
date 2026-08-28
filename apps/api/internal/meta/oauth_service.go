package meta

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"net/http"
	"slices"
	"strings"
	"time"

	"golang.org/x/sync/errgroup"
)

type oauthService struct {
	store          oauthPostgresStore
	graph          *oauthGraphClient
	allowedOrigins map[string]struct{}
	flowTTL        time.Duration
}

type oauthCallbackResult struct {
	ReturnURL string
	FlowID    string
	Status    string
	Error     string
}

func newOAuthService(store oauthPostgresStore, graph *oauthGraphClient, config OAuthConfig) (*oauthService, error) {
	allowed := make(map[string]struct{})
	for _, value := range config.AllowedOrigins {
		if origin, ok := normalizeOAuthOrigin(value); ok {
			allowed[origin] = struct{}{}
		}
	}
	if len(allowed) == 0 {
		return nil, newOAuthFailure("meta_oauth_not_configured", http.StatusServiceUnavailable)
	}
	flowTTL := config.FlowTTL
	if flowTTL <= 0 || flowTTL > 15*time.Minute {
		flowTTL = 10 * time.Minute
	}
	return &oauthService{
		store:          store,
		graph:          graph,
		allowedOrigins: allowed,
		flowTTL:        flowTTL,
	}, nil
}

func (service *oauthService) createAuthURL(ctx context.Context, auth oauthAuthContext, body map[string]any) (map[string]any, error) {
	returnURL, ok := body["return_url"].(string)
	if !ok {
		return nil, newOAuthFailure("return_url_not_allowed", http.StatusBadRequest)
	}
	validatedReturnURL, err := validateOAuthReturnURL(returnURL, service.allowedOrigins)
	if err != nil {
		return nil, err
	}
	service.store.purgeUserFlowPayloads(ctx, auth)
	flowID, err := randomOAuthUUID()
	if err != nil {
		return nil, err
	}
	nonce, err := randomOAuthNonce()
	if err != nil {
		return nil, err
	}
	state, err := EncodeOAuthState(flowID, nonce)
	if err != nil {
		return nil, err
	}
	flow := oauthFlow{
		ID:             flowID,
		OrganizationID: auth.OrganizationID,
		UserID:         auth.UserID,
		NonceHash:      hashOAuthNonce(nonce),
		ReturnURL:      validatedReturnURL,
		Status:         "pending",
		ExpiresAt:      time.Now().UTC().Add(service.flowTTL),
	}
	if err := service.store.createFlow(ctx, flow); err != nil {
		return nil, err
	}
	return map[string]any{
		"success":  true,
		"auth_url": service.graph.authorizationURL(state),
	}, nil
}

func (service *oauthService) completeCallback(ctx context.Context, state string, code string, providerError string) (result oauthCallbackResult, err error) {
	flowID, nonce, err := DecodeOAuthState(state)
	if err != nil {
		return result, err
	}
	result.FlowID = flowID
	flow, err := service.store.loadFlow(ctx, flowID, hashOAuthNonce(nonce))
	if err != nil {
		return result, err
	}
	returnURL, err := validateOAuthReturnURL(flow.ReturnURL, service.allowedOrigins)
	if err != nil {
		return result, err
	}
	result.ReturnURL = returnURL
	if err := service.store.claimCallback(ctx, flow); err != nil {
		return result, err
	}
	claimed := true
	defer func() {
		if err == nil || !claimed {
			return
		}
		safeCode := oauthErrorCode(err)
		cleanupContext, cleanupCancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cleanupCancel()
		_ = service.store.finishCallbackError(cleanupContext, flow, safeCode)
		result.Status = "error"
		result.Error = safeCode
	}()

	if strings.TrimSpace(providerError) != "" {
		err = newOAuthFailure("oauth_access_denied", http.StatusBadRequest)
		return result, err
	}
	code = strings.TrimSpace(code)
	if code == "" || len(code) > 4096 || containsOAuthControl(code, true) {
		err = newOAuthFailure("oauth_code_missing", http.StatusBadRequest)
		return result, err
	}

	userToken, exchangedExpiry, err := service.graph.exchangeAuthorizationCode(ctx, code)
	if err != nil {
		return result, err
	}
	marketingEnabled, err := service.store.moduleEnabled(ctx, flow.OrganizationID, "campaigns")
	if err != nil {
		return result, newOAuthFailure("meta_module_lookup_failed", http.StatusServiceUnavailable, err)
	}
	debug, identity, pages, accounts, err := service.loadOAuthPortfolio(ctx, userToken, marketingEnabled)
	if err != nil {
		return result, err
	}
	if debug.UserID != identity.ID {
		err = newOAuthFailure("oauth_identity_mismatch", http.StatusForbidden)
		return result, err
	}
	if len(pages) == 0 {
		err = newOAuthFailure("meta_no_managed_pages", http.StatusBadRequest)
		return result, err
	}
	tokenExpiry := debug.ExpiresAt
	if tokenExpiry == nil {
		tokenExpiry = exchangedExpiry
	}
	payload := buildOAuthFlowPayload(userToken, tokenExpiry, debug.Scopes, identity, pages, accounts)
	if err := service.store.finishCallbackSuccess(ctx, flow, payload); err != nil {
		return result, err
	}
	claimed = false
	result.Status = "success"
	return result, nil
}

func (service *oauthService) connectPage(ctx context.Context, auth oauthAuthContext, body map[string]any) (map[string]any, error) {
	flowID, err := oauthRequiredUUID(body["flow_id"], "invalid_oauth_flow_id")
	if err != nil {
		return nil, err
	}
	pageID, err := oauthRequiredPageID(body["page_id"])
	if err != nil {
		return nil, err
	}
	options, err := parseOAuthConnectionOptions(body)
	if err != nil {
		return nil, err
	}
	if err := service.store.validateDestination(ctx, auth.OrganizationID, options); err != nil {
		return nil, err
	}
	selected, selectionSet, err := parseOAuthSelectedAccounts(body["selected_ad_accounts"], false)
	if err != nil {
		return nil, err
	}
	if !selectionSet {
		if fallback, ok := NormalizeOAuthAdAccountID(oauthString(body["ad_account_id"])); ok {
			selected = []string{fallback}
		}
	}
	marketingEnabled, err := service.store.moduleEnabled(ctx, auth.OrganizationID, "campaigns")
	if err != nil {
		return nil, newOAuthFailure("meta_module_lookup_failed", http.StatusServiceUnavailable, err)
	}
	// Lead Forms are available to every organization. Never persist an
	// advanced ad-account selection while the Marketing module is disabled,
	// even when a crafted request includes account ids.
	if !marketingEnabled {
		selected = nil
	}
	payload, err := service.store.claimConnectFlow(ctx, auth, flowID, pageID, selected)
	if err != nil {
		return nil, err
	}
	connectClaimed := true
	defer func() {
		if !connectClaimed {
			return
		}
		releaseContext, releaseCancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer releaseCancel()
		_ = service.store.releaseConnectFlow(releaseContext, auth, flowID)
	}()
	userToken, err := oauthRequiredUserToken(payload.UserToken)
	if err != nil {
		return nil, newOAuthFailure("oauth_flow_payload_invalid", http.StatusConflict)
	}
	debug, identity, pages, accounts, err := service.loadOAuthPortfolio(ctx, userToken, marketingEnabled)
	if err != nil {
		return nil, err
	}
	if debug.UserID != identity.ID || (payload.FacebookUserID != "" && payload.FacebookUserID != identity.ID) {
		return nil, newOAuthFailure("oauth_identity_mismatch", http.StatusForbidden)
	}
	page, found := findOAuthPage(pages, pageID)
	if !found {
		return nil, newOAuthFailure("meta_page_not_accessible", http.StatusForbidden)
	}
	accessible := make(map[string]struct{}, len(accounts))
	for _, account := range accounts {
		accessible[account.ID] = struct{}{}
	}
	for _, accountID := range selected {
		if _, ok := accessible[accountID]; !ok {
			return nil, newOAuthFailure("ad_account_not_accessible", http.StatusForbidden)
		}
	}
	conversationsEnabled, err := service.store.moduleEnabled(ctx, auth.OrganizationID, "whatsapp")
	if err != nil {
		return nil, newOAuthFailure("meta_module_lookup_failed", http.StatusServiceUnavailable, err)
	}
	messengerActive, err := service.graph.subscribePageWebhook(ctx, page, marketingEnabled && conversationsEnabled)
	if err != nil {
		return nil, err
	}
	integration, err := service.store.persistConnectedIntegration(
		ctx,
		auth,
		page,
		identity,
		debug,
		userToken,
		selected,
		options,
		messengerActive,
	)
	if err != nil {
		// Never unsubscribe a page that already has a connected row. A failed
		// credential rotation must not silently stop lead delivery for the old
		// healthy integration; only compensate a genuinely new subscription.
		cleanupContext, cleanupCancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cleanupCancel()
		if connected, stateErr := service.store.integrationConnected(cleanupContext, auth.OrganizationID, page.ID); stateErr == nil && !connected {
			_ = service.graph.unsubscribePageWebhook(cleanupContext, page.ID, page.AccessToken)
		}
		return nil, err
	}
	if err := service.store.finishConnectFlow(ctx, auth, flowID); err != nil {
		return nil, err
	}
	connectClaimed = false
	return map[string]any{
		"success":             true,
		"marketing_active":    marketingEnabled,
		"messenger_active":    messengerActive,
		"integration":         integration,
		"missing_permissions": oauthMissingScopes(debug.Scopes, service.graph.loginScopes()),
	}, nil
}

func (service *oauthService) updatePage(ctx context.Context, auth oauthAuthContext, body map[string]any) (map[string]any, error) {
	pageID, err := oauthRequiredPageID(body["page_id"])
	if err != nil {
		return nil, err
	}
	options, err := parseOAuthConnectionOptions(body)
	if err != nil {
		return nil, err
	}
	if err := service.store.validateDestination(ctx, auth.OrganizationID, options); err != nil {
		return nil, err
	}
	selected, selectionSet, err := parseOAuthSelectedAccounts(body["selected_ad_accounts"], false)
	if err != nil {
		return nil, err
	}
	if selectionSet {
		marketingEnabled, moduleErr := service.store.moduleEnabled(ctx, auth.OrganizationID, "campaigns")
		if moduleErr != nil {
			return nil, newOAuthFailure("meta_module_lookup_failed", http.StatusServiceUnavailable, moduleErr)
		}
		if !marketingEnabled {
			selected = nil
			selectionSet = false
		}
	}
	integration, err := service.store.getIntegration(ctx, auth.OrganizationID, pageID)
	if err != nil {
		return nil, err
	}
	if selectionSet {
		userToken, err := oauthRequiredStoredToken(integration.UserToken)
		if err != nil {
			return nil, err
		}
		if err := service.graph.validateSelectedAccounts(ctx, userToken, selected); err != nil {
			return nil, err
		}
	}
	updated, err := service.store.updateIntegrationOptions(ctx, auth.OrganizationID, pageID, options, selected, selectionSet)
	if err != nil {
		return nil, err
	}
	return map[string]any{"success": true, "integration": updated}, nil
}

func (service *oauthService) disconnectPage(ctx context.Context, auth oauthAuthContext, body map[string]any) (map[string]any, error) {
	pageID, err := oauthRequiredPageID(body["page_id"])
	if err != nil {
		return nil, err
	}
	integration, err := service.store.getIntegration(ctx, auth.OrganizationID, pageID)
	if err != nil {
		return nil, err
	}
	if err := service.store.setIntegrationState(ctx, auth.OrganizationID, pageID, map[string]any{
		"is_connected":  false,
		"health_status": "disconnecting",
	}); err != nil {
		return nil, err
	}
	page, err := service.resolveIntegrationPage(ctx, integration)
	if err != nil {
		_ = service.store.setIntegrationState(ctx, auth.OrganizationID, pageID, map[string]any{
			"is_connected":  false,
			"health_status": "disconnect_pending",
			"last_error":    "meta_webhook_unsubscribe_failed",
		})
		return nil, newOAuthFailure("meta_webhook_unsubscribe_failed", http.StatusBadGateway)
	}
	if !service.graph.unsubscribePageWebhook(ctx, pageID, page.AccessToken) {
		_ = service.store.setIntegrationState(ctx, auth.OrganizationID, pageID, map[string]any{
			"is_connected":  false,
			"health_status": "disconnect_pending",
			"last_error":    "meta_webhook_unsubscribe_failed",
		})
		return nil, newOAuthFailure("meta_webhook_unsubscribe_failed", http.StatusBadGateway)
	}
	if err := service.store.deleteIntegration(ctx, auth.OrganizationID, pageID); err != nil {
		cleanupContext, cleanupCancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cleanupCancel()
		_ = service.store.setIntegrationState(cleanupContext, auth.OrganizationID, pageID, map[string]any{
			"is_connected":  false,
			"health_status": "disconnect_pending",
			"last_error":    "meta_integration_delete_failed",
		})
		return nil, err
	}
	return map[string]any{"success": true, "webhook_unsubscribed": true}, nil
}

func (service *oauthService) togglePage(ctx context.Context, auth oauthAuthContext, body map[string]any) (map[string]any, error) {
	pageID, err := oauthRequiredPageID(body["page_id"])
	if err != nil {
		return nil, err
	}
	enabled, ok := body["is_active"].(bool)
	if !ok {
		return nil, newOAuthFailure("invalid_toggle_state", http.StatusBadRequest)
	}
	integration, err := service.store.getIntegration(ctx, auth.OrganizationID, pageID)
	if err != nil {
		return nil, err
	}
	if !enabled {
		// Persist the paused state before touching the provider. A database
		// failure must never leave a row marked healthy after its webhook was
		// removed.
		if err := service.store.setIntegrationState(ctx, auth.OrganizationID, pageID, map[string]any{
			"is_connected":  false,
			"health_status": "paused",
		}); err != nil {
			return nil, err
		}
		unsubscribed := false
		if page, pageErr := service.resolveIntegrationPage(ctx, integration); pageErr == nil {
			unsubscribed = service.graph.unsubscribePageWebhook(ctx, pageID, page.AccessToken)
		}
		return map[string]any{
			"success":              true,
			"is_active":            false,
			"webhook_unsubscribed": unsubscribed,
		}, nil
	}

	userToken, err := oauthRequiredStoredToken(integration.UserToken)
	if err != nil {
		return nil, err
	}
	pages, err := service.graph.fetchManagedPages(ctx, userToken)
	if err != nil {
		_ = service.markIntegrationError(auth, pageID, err)
		return nil, err
	}
	page, found := findOAuthPage(pages, pageID)
	if !found {
		err := newOAuthFailure("meta_page_not_accessible", http.StatusForbidden)
		_ = service.markIntegrationError(auth, pageID, err)
		return nil, err
	}
	marketingEnabled, err := service.store.moduleEnabled(ctx, auth.OrganizationID, "campaigns")
	if err != nil {
		_ = service.markIntegrationError(auth, pageID, err)
		return nil, newOAuthFailure("meta_module_lookup_failed", http.StatusServiceUnavailable, err)
	}
	conversationsEnabled, err := service.store.moduleEnabled(ctx, auth.OrganizationID, "whatsapp")
	if err != nil {
		_ = service.markIntegrationError(auth, pageID, err)
		return nil, newOAuthFailure("meta_module_lookup_failed", http.StatusServiceUnavailable, err)
	}
	messengerActive, err := service.graph.subscribePageWebhook(ctx, page, marketingEnabled && conversationsEnabled)
	if err != nil {
		_ = service.markIntegrationError(auth, pageID, err)
		return nil, err
	}
	if err := service.store.refreshIntegrationMetadata(ctx, auth.OrganizationID, page, messengerActive); err != nil {
		_ = service.markIntegrationError(auth, pageID, err)
		cleanupContext, cleanupCancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cleanupCancel()
		if connected, stateErr := service.store.integrationConnected(cleanupContext, auth.OrganizationID, pageID); stateErr == nil && !connected {
			_ = service.graph.unsubscribePageWebhook(cleanupContext, page.ID, page.AccessToken)
		}
		return nil, err
	}
	return map[string]any{
		"success":          true,
		"is_active":        true,
		"messenger_active": messengerActive,
	}, nil
}

func (service *oauthService) updateAdAccounts(ctx context.Context, auth oauthAuthContext, body map[string]any) (map[string]any, error) {
	pageID, err := oauthRequiredPageID(body["page_id"])
	if err != nil {
		return nil, err
	}
	selected, _, err := parseOAuthSelectedAccounts(body["selected_ad_accounts"], true)
	if err != nil {
		return nil, err
	}
	marketingEnabled, err := service.store.moduleEnabled(ctx, auth.OrganizationID, "campaigns")
	if err != nil {
		return nil, newOAuthFailure("meta_module_lookup_failed", http.StatusServiceUnavailable, err)
	}
	if !marketingEnabled {
		return nil, newOAuthFailure("meta_marketing_module_required", http.StatusForbidden)
	}
	integration, err := service.store.getIntegration(ctx, auth.OrganizationID, pageID)
	if err != nil {
		return nil, err
	}
	userToken, err := oauthRequiredStoredToken(integration.UserToken)
	if err != nil {
		return nil, err
	}
	if err := service.graph.validateSelectedAccounts(ctx, userToken, selected); err != nil {
		return nil, err
	}
	updated, err := service.store.updateSelectedAccounts(ctx, auth.OrganizationID, pageID, selected)
	if err != nil {
		return nil, err
	}
	return map[string]any{"success": true, "integration": updated}, nil
}

func (service *oauthService) listAdAccounts(ctx context.Context, auth oauthAuthContext, body map[string]any) (map[string]any, error) {
	pageID, err := oauthRequiredPageID(body["page_id"])
	if err != nil {
		return nil, err
	}
	marketingEnabled, err := service.store.moduleEnabled(ctx, auth.OrganizationID, "campaigns")
	if err != nil {
		return nil, newOAuthFailure("meta_module_lookup_failed", http.StatusServiceUnavailable, err)
	}
	if !marketingEnabled {
		return nil, newOAuthFailure("meta_marketing_module_required", http.StatusForbidden)
	}
	integration, err := service.store.getIntegration(ctx, auth.OrganizationID, pageID)
	if err != nil {
		return nil, err
	}
	userToken, err := oauthRequiredStoredToken(integration.UserToken)
	if err != nil {
		return nil, err
	}
	accounts, err := service.graph.fetchAdAccounts(ctx, userToken)
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"success":     true,
		"ad_accounts": accounts,
	}, nil
}

func (service *oauthService) loadOAuthPortfolio(ctx context.Context, userToken string, includeAdAccounts bool) (oauthTokenDebug, oauthIdentity, []oauthPage, []oauthAdAccount, error) {
	var debug oauthTokenDebug
	var identity oauthIdentity
	var pages []oauthPage
	var accounts []oauthAdAccount
	group, groupContext := errgroup.WithContext(ctx)
	group.Go(func() error {
		var err error
		debug, err = service.graph.debugUserToken(groupContext, userToken)
		return err
	})
	group.Go(func() error {
		var err error
		identity, err = service.graph.fetchIdentity(groupContext, userToken)
		return err
	})
	group.Go(func() error {
		var err error
		pages, err = service.graph.fetchManagedPages(groupContext, userToken)
		return err
	})
	if includeAdAccounts {
		group.Go(func() error {
			var err error
			accounts, err = service.graph.fetchAdAccounts(groupContext, userToken)
			return err
		})
	}
	if err := group.Wait(); err != nil {
		return oauthTokenDebug{}, oauthIdentity{}, nil, nil, err
	}
	return debug, identity, pages, accounts, nil
}

func (service *oauthService) resolveIntegrationPage(ctx context.Context, integration oauthIntegration) (oauthPage, error) {
	if userToken, err := oauthRequiredStoredToken(integration.UserToken); err == nil {
		if pages, fetchErr := service.graph.fetchManagedPages(ctx, userToken); fetchErr == nil {
			if page, found := findOAuthPage(pages, integration.PageID); found {
				return page, nil
			}
		}
	}
	pageToken, err := oauthRequiredStoredToken(integration.PageToken)
	if err != nil {
		return oauthPage{}, err
	}
	name := integration.PageID
	if integration.PageName != nil && strings.TrimSpace(*integration.PageName) != "" {
		name = strings.TrimSpace(*integration.PageName)
	}
	return oauthPage{ID: integration.PageID, Name: name, AccessToken: pageToken}, nil
}

func (service *oauthService) markIntegrationError(auth oauthAuthContext, pageID string, cause error) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return service.store.setIntegrationState(ctx, auth.OrganizationID, pageID, map[string]any{
		"is_connected":  false,
		"health_status": "error",
		"last_error":    oauthErrorCode(cause),
	})
}

func buildOAuthFlowPayload(
	userToken string,
	expiresAt *time.Time,
	grantedScopes []string,
	identity oauthIdentity,
	pages []oauthPage,
	accounts []oauthAdAccount,
) oauthFlowPayload {
	safePages := make([]map[string]any, 0, len(pages))
	for _, page := range pages {
		item := map[string]any{
			"id":                 page.ID,
			"name":               page.Name,
			"facebook_user_id":   identity.ID,
			"facebook_user_name": identity.Name,
		}
		if page.PictureURL != nil {
			item["picture"] = map[string]any{"data": map[string]any{"url": *page.PictureURL}}
		}
		if page.InstagramBusinessAccountID != nil {
			item["instagram_business_account"] = map[string]any{
				"id":       *page.InstagramBusinessAccountID,
				"username": page.InstagramUsername,
			}
		}
		safePages = append(safePages, item)
	}
	var firstAccount *string
	if len(accounts) > 0 {
		value := accounts[0].ID
		firstAccount = &value
	}
	return oauthFlowPayload{
		Success:          true,
		UserToken:        userToken,
		TokenExpiresAt:   expiresAt,
		GrantedScopes:    append([]string(nil), grantedScopes...),
		FacebookUserID:   identity.ID,
		FacebookUserName: identity.Name,
		Pages:            safePages,
		AdAccounts:       append([]oauthAdAccount(nil), accounts...),
		AdAccountID:      firstAccount,
	}
}

func parseOAuthConnectionOptions(body map[string]any) (oauthConnectionOptions, error) {
	pipelineID, err := oauthOptionalUUID(body["pipeline_id"], "invalid_pipeline_id")
	if err != nil {
		return oauthConnectionOptions{}, err
	}
	stageID, err := oauthOptionalUUID(body["stage_id"], "invalid_stage_id")
	if err != nil {
		return oauthConnectionOptions{}, err
	}
	status, err := oauthOptionalString(body["default_status"], 64, "invalid_default_status")
	if err != nil {
		return oauthConnectionOptions{}, err
	}
	defaultStatus := "novo"
	if status != nil {
		defaultStatus = *status
	}
	return oauthConnectionOptions{PipelineID: pipelineID, StageID: stageID, DefaultStatus: defaultStatus}, nil
}

func oauthRequiredStoredToken(value string) (string, error) {
	token, err := oauthRequiredUserToken(value)
	if err != nil {
		return "", newOAuthFailure("meta_reconnect_required", http.StatusConflict)
	}
	return token, nil
}

func findOAuthPage(pages []oauthPage, pageID string) (oauthPage, bool) {
	index := slices.IndexFunc(pages, func(page oauthPage) bool { return page.ID == pageID })
	if index < 0 {
		return oauthPage{}, false
	}
	return pages[index], true
}

func randomOAuthUUID() (string, error) {
	raw := make([]byte, 16)
	if _, err := rand.Read(raw); err != nil {
		return "", newOAuthFailure("oauth_random_failed", http.StatusInternalServerError, err)
	}
	raw[6] = (raw[6] & 0x0f) | 0x40
	raw[8] = (raw[8] & 0x3f) | 0x80
	encoded := hex.EncodeToString(raw)
	return encoded[0:8] + "-" + encoded[8:12] + "-" + encoded[12:16] + "-" + encoded[16:20] + "-" + encoded[20:32], nil
}
