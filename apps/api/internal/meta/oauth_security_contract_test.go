package meta

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func TestOAuthConnectClaimIsTenantBoundPageScopedAndFinalizedOnlyAfterSuccess(t *testing.T) {
	source := readOAuthSource(t, "oauth_postgres.go")
	claim := oauthSourceSection(t, source, "func (store oauthPostgresStore) claimConnectFlow", "func (store oauthPostgresStore) finishConnectFlow")
	normalized := strings.Join(strings.Fields(claim), " ")
	for _, required := range []string{
		"store.db.Pool().Begin(ctx)",
		"flow.organization_id = $1::uuid",
		"flow.user_id = $3::uuid",
		"flow.status = 'success'",
		"flow.consumed_at is null",
		"flow.expires_at > now()",
		"vault.decrypted_secrets as secret",
		"private.meta_oauth_flow_transient_secret_id(flow.payload)",
		"secret.name = 'meta-oauth-flow:' || flow.id::text",
		"flow.payload - $6",
		"not (flow.payload ? 'user_token')",
		"page->>'id' = $4",
		"flow.payload->'connected_page_ids'",
		"connected.page_id = $4",
		"from jsonb_array_elements_text($5::jsonb) as requested(account_id)",
		"error_message = 'oauth_connect_processing'",
		"tx.Commit(ctx)",
	} {
		if !strings.Contains(normalized, required) {
			t.Fatalf("atomic OAuth claim is missing %q", required)
		}
	}
	finalize := oauthSourceSection(t, source, "func (store oauthPostgresStore) finishConnectFlow", "func (store oauthPostgresStore) releaseConnectFlow")
	for _, required := range []string{
		"deleteOAuthFlowTransientSecret",
		"remainingPages > 0",
		"'{connected_page_ids}'",
		"status = 'success'",
		"set consumed_at = now()",
		"status = 'consumed'",
		"payload = jsonb_build_object('consumed', true)",
		"error_message = 'oauth_connect_processing'",
	} {
		if !strings.Contains(finalize, required) {
			t.Fatalf("OAuth finalization is missing %q", required)
		}
	}
	serviceSource := readOAuthSource(t, "oauth_service.go")
	connect := oauthSourceSection(t, serviceSource, "func (service *oauthService) connectPage", "func (service *oauthService) updatePage")
	persist := strings.Index(connect, "persistConnectedIntegration(")
	finalizeAt := strings.Index(connect, "finishConnectFlow(ctx, auth, flowID, page.ID)")
	if persist < 0 || finalizeAt < persist {
		t.Fatal("OAuth flow must be consumed only after the integration is durably persisted")
	}
}

func TestOAuthConnectRejectsTokenWithoutLeadRetrievalBeforeProviderMutation(t *testing.T) {
	source := readOAuthSource(t, "oauth_service.go")
	connect := oauthSourceSection(t, source, "func (service *oauthService) connectPage", "func (service *oauthService) updatePage")

	requiredScope := strings.Index(connect, `slices.Contains(debug.Scopes, "leads_retrieval")`)
	subscribe := strings.Index(connect, "subscribePageWebhook(")
	persist := strings.Index(connect, "persistConnectedIntegration(")
	if requiredScope < 0 || subscribe <= requiredScope || persist <= requiredScope {
		t.Fatal("connect must reject a token without leads_retrieval before subscribing or persisting the Page")
	}
	if !strings.Contains(connect, `newOAuthFailure("meta_leads_retrieval_required", http.StatusForbidden)`) {
		t.Fatal("connect must return the stable meta_leads_retrieval_required error")
	}
}

func TestOAuthCallbackStoresTransientUserTokenOnlyInVault(t *testing.T) {
	postgresSource := readOAuthSource(t, "oauth_postgres.go")
	finish := oauthSourceSection(t, postgresSource, "func (store oauthPostgresStore) finishCallbackSuccess", "func (store oauthPostgresStore) claimConnectFlow")
	for _, required := range []string{
		"vault.create_secret($1, $2, $3)",
		"pgx.QueryExecModeExec",
		"newOAuthStoredFlowPayload(payload, secretRef)",
		"json.Marshal(storedPayload)",
		"tx.Commit(ctx)",
	} {
		if !strings.Contains(finish, required) {
			t.Fatalf("transient Vault persistence is missing %q", required)
		}
	}
	if strings.Contains(finish, "json.Marshal(payload)") {
		t.Fatal("callback must never serialize the token-bearing OAuth payload")
	}

	typesSource := readOAuthSource(t, "oauth_types.go")
	if !strings.Contains(typesSource, "UserToken        string           `json:\"-\"`") {
		t.Fatal("the in-memory OAuth user token must be impossible to JSON-serialize")
	}
	raw, err := json.Marshal(oauthFlowPayload{Success: true, UserToken: "must-never-serialize"})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "must-never-serialize") || strings.Contains(string(raw), "user_token") {
		t.Fatalf("token-bearing in-memory payload serialized credentials: %s", raw)
	}
}

func TestOAuthRequestsInstagramMessagingPermission(t *testing.T) {
	found := false
	for _, scope := range OAuthScopes() {
		if scope == "instagram_manage_messages" {
			found = true
			break
		}
	}
	if !found {
		t.Fatal("Instagram DM backend requires instagram_manage_messages")
	}
}

func TestOAuthPersistenceUsesSeparateVaultBackedPageAndUserCredentials(t *testing.T) {
	source := readOAuthSource(t, "oauth_postgres.go")
	for _, required := range []string{
		"access_token = $5",
		"user_access_token = $6",
		"vault.decrypted_secrets as page_secret",
		"vault.decrypted_secrets as user_secret",
		"integration.access_token_secret_ref",
		"integration.user_access_token_secret_ref",
	} {
		if !strings.Contains(source, required) {
			t.Fatalf("Vault persistence contract is missing %q", required)
		}
	}
	projection := oauthSourceSection(t, source, "const oauthPublicIntegrationJSON", "func (store oauthPostgresStore) createFlow")
	for _, forbidden := range []string{
		"access_token'",
		"user_access_token'",
		"access_token_secret_ref'",
		"user_access_token_secret_ref'",
	} {
		if strings.Contains(projection, forbidden) {
			t.Fatalf("browser-facing integration projection exposes %q", forbidden)
		}
	}
}

func TestOAuthHandlerNeverAcceptsProviderCredentialInputs(t *testing.T) {
	source := readOAuthSource(t, "oauth_handler.go")
	validation := oauthSourceSection(t, source, "func validateOAuthAction", "func validateOAuthActionOrganization")
	for _, credential := range []string{
		`"code"`, `"access_token"`, `"accessToken"`, `"user_token"`, `"userToken"`, `"page_token"`,
	} {
		if !strings.Contains(validation, credential) {
			t.Fatalf("credential denylist is missing %s", credential)
		}
	}
	if !strings.Contains(source, `"success": false`) || !strings.Contains(source, `"error":`) {
		t.Fatal("OAuth handler must return the direct, code-only JSON contract")
	}
	actionContract := oauthSourceSection(t, source, "var oauthActionKeys", "// OAuthHandler owns")
	for _, browserIdentity := range []string{`"facebook_user_id"`, `"facebook_user_name"`, `"page_picture_url"`} {
		if strings.Contains(actionContract, browserIdentity) {
			t.Fatalf("connect action must derive provider identity server-side, found %s", browserIdentity)
		}
	}
}

func TestOAuthAdvancedAssetsFailClosedWhenMarketingModuleIsDisabled(t *testing.T) {
	source := readOAuthSource(t, "oauth_service.go")
	connect := oauthSourceSection(t, source, "func (service *oauthService) connectPage", "func (service *oauthService) updatePage")
	moduleCheck := strings.Index(connect, `moduleEnabled(ctx, auth.OrganizationID, "campaigns")`)
	selectionClear := strings.Index(connect, "selected = nil")
	claim := strings.Index(connect, "claimConnectFlow(")
	persist := strings.Index(connect, "persistConnectedIntegration(")
	if moduleCheck < 0 || selectionClear < moduleCheck || claim < selectionClear || persist < claim {
		t.Fatal("connect must clear advanced ad-account selection before claiming or persisting the OAuth flow")
	}

	updateAccounts := oauthSourceSection(t, source, "func (service *oauthService) updateAdAccounts", "func (service *oauthService) loadOAuthPortfolio")
	for _, required := range []string{
		`moduleEnabled(ctx, auth.OrganizationID, "campaigns")`,
		`"meta_marketing_module_required"`,
		"http.StatusForbidden",
	} {
		if !strings.Contains(updateAccounts, required) {
			t.Fatalf("ad-account update module gate is missing %q", required)
		}
	}

	listAccounts := oauthSourceSection(t, source, "func (service *oauthService) listAdAccounts", "func (service *oauthService) loadOAuthPortfolio")
	for _, required := range []string{
		`moduleEnabled(ctx, auth.OrganizationID, "campaigns")`,
		"getIntegration(ctx, auth.OrganizationID, pageID)",
		"oauthRequiredStoredToken(integration.UserToken)",
		"service.graph.fetchAdAccounts(ctx, userToken)",
	} {
		if !strings.Contains(listAccounts, required) {
			t.Fatalf("stored-token ad-account discovery is missing %q", required)
		}
	}
}

func TestOAuthWebhookCompensationNeverBreaksAHealthyIntegration(t *testing.T) {
	source := readOAuthSource(t, "oauth_service.go")
	connect := oauthSourceSection(t, source, "func (service *oauthService) connectPage", "func (service *oauthService) updatePage")
	providerState := strings.Index(connect, "pageSubscriptionState(")
	providerSubscribe := strings.Index(connect, "subscribePageWebhook(")
	if providerState < 0 || providerSubscribe < providerState {
		t.Fatal("connect must inspect the shared Page subscription before mutating the provider")
	}
	if !strings.Contains(connect, "providerState.ConnectedCount == 0 || (requestedMessaging && !providerMessagingSubscribed)") {
		t.Fatal("connect may only create the first Page subscription or perform a monotonic messaging upgrade")
	}
	persist := strings.Index(connect, "persistConnectedIntegration(")
	stateCheck := strings.Index(connect, "connectedPageIntegrationCount(")
	compensate := strings.LastIndex(connect, "unsubscribePageWebhook(")
	if persist < 0 || stateCheck < persist || compensate < stateCheck {
		t.Fatal("connect compensation must check every tenant connection for the Page before unsubscribing")
	}
	if !strings.Contains(connect, "acquireMetaPageSubscriptionLock(") {
		t.Fatal("connect must serialize provider subscription mutations across tenants")
	}

	disconnect := oauthSourceSection(t, source, "func (service *oauthService) disconnectPage", "func (service *oauthService) togglePage")
	disconnecting := strings.Index(disconnect, `"health_status": "disconnecting"`)
	sharedStateCheck := strings.Index(disconnect, "connectedPageIntegrationCount(")
	unsubscribe := strings.Index(disconnect, "unsubscribePageWebhook(")
	if disconnecting < 0 || sharedStateCheck < disconnecting || unsubscribe < sharedStateCheck {
		t.Fatal("disconnect must persist state and check every tenant connection before removing the provider webhook")
	}
	if !strings.Contains(disconnect, `"webhook_preserved_for_shared_page": connectedCount > 0`) {
		t.Fatal("disconnect must report that a shared Page subscription was preserved")
	}

	toggle := oauthSourceSection(t, source, "func (service *oauthService) togglePage", "func (service *oauthService) updateAdAccounts")
	paused := strings.Index(toggle, `"health_status": "paused"`)
	toggleSharedStateCheck := strings.Index(toggle, "connectedPageIntegrationCount(")
	toggleUnsubscribe := strings.Index(toggle, "unsubscribePageWebhook(")
	if paused < 0 || toggleSharedStateCheck < paused || toggleUnsubscribe < toggleSharedStateCheck {
		t.Fatal("pause must be durable and shared-Page-aware before removing the provider webhook")
	}
	if !strings.Contains(toggle, "acquireMetaPageSubscriptionLock(") {
		t.Fatal("toggle must serialize provider subscription mutations across tenants")
	}
}

func TestOAuthSharedPageStateIsGlobalAndCredentialFree(t *testing.T) {
	source := readOAuthSource(t, "oauth_postgres.go")
	state := oauthSourceSection(
		t,
		source,
		"type oauthPageSubscriptionState struct",
		"func (store oauthPostgresStore) persistConnectedIntegration",
	)
	normalized := strings.Join(strings.Fields(state), " ")
	for _, required := range []string{
		"count(*)::bigint",
		"bool_or(",
		`coalesce(subscribed_fields, '[]'::jsonb) @> '["messages"]'::jsonb`,
		"btrim(page_id) = btrim($1)",
		"coalesce(is_connected, false) = true",
	} {
		if !strings.Contains(normalized, required) {
			t.Fatalf("shared Page provider state is missing %q", required)
		}
	}
	for _, forbidden := range []string{
		"organization_id =",
		"access_token",
		"user_access_token",
	} {
		if strings.Contains(normalized, forbidden) {
			t.Fatalf("shared Page provider state must be global and credential-free; found %q", forbidden)
		}
	}
}

func TestMetaPageProviderMutationLockIsProcessSafeAndDoesNotHoldATransaction(t *testing.T) {
	source := readOAuthSource(t, "page_subscription_lock.go")
	for _, required := range []string{
		"pg_advisory_lock(",
		"meta-page-subscription:",
		"pg_advisory_unlock(",
		"connection.Hijack()",
		"underlying.Close(closeContext)",
		"sync.Once",
		"pool.Config().MaxConns",
		"acquireMetaPageSubscriptionPoolSlot(ctx, pool)",
		"defer releasePoolSlot()",
	} {
		if !strings.Contains(source, required) {
			t.Fatalf("Page subscription lock is missing %q", required)
		}
	}
	for _, forbidden := range []string{
		"pg_advisory_xact_lock",
		"connection.Begin(",
	} {
		if strings.Contains(source, forbidden) {
			t.Fatalf("provider HTTP coordination must not hold a database transaction: found %q", forbidden)
		}
	}
}

func readOAuthSource(t *testing.T, name string) string {
	t.Helper()
	raw, err := os.ReadFile(name)
	if err != nil {
		t.Fatalf("read %s: %v", name, err)
	}
	return string(raw)
}

func oauthSourceSection(t *testing.T, source string, startMarker string, endMarker string) string {
	t.Helper()
	start := strings.Index(source, startMarker)
	if start < 0 {
		t.Fatalf("missing source marker %q", startMarker)
	}
	end := strings.Index(source[start:], endMarker)
	if end < 0 {
		t.Fatalf("missing source marker %q after %q", endMarker, startMarker)
	}
	return source[start : start+end]
}
