package meta

import (
	"context"
	"encoding/json"
	"errors"
	"net/url"
	"os"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

// META_OAUTH_TEST_DATABASE_URL must point to a disposable loopback Supabase
// database with the Marketing foundation migration applied.
func TestOAuthPostgresSingleUseAndVaultContract(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("META_OAUTH_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("set META_OAUTH_TEST_DATABASE_URL to run the PostgreSQL/Vault contract test")
	}
	parsed, err := url.Parse(databaseURL)
	if err != nil || !isOAuthLoopbackHost(parsed.Hostname()) {
		t.Fatalf("META_OAUTH_TEST_DATABASE_URL must use a loopback host")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	database, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, HealthTimeout: 3 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	store := oauthPostgresStore{db: database}

	var organizationID string
	var userID string
	err = database.Pool().QueryRow(ctx, `
		select membership.organization_id::text, membership.user_id::text
		from public.organization_members as membership
		join public.organizations as organization on organization.id = membership.organization_id
		join public.users as profile on profile.id = membership.user_id
		where coalesce(membership.is_active, true) = true
		  and coalesce(organization.is_active, true) = true
		  and coalesce(profile.is_active, true) = true
		limit 1
	`).Scan(&organizationID, &userID)
	if err != nil {
		t.Fatalf("local fixture lookup: %v", err)
	}

	flowID, err := randomOAuthUUID()
	if err != nil {
		t.Fatal(err)
	}
	pageID := strconv.FormatInt(time.Now().UTC().UnixNano(), 10)
	accountID := "act_" + pageID
	auth := oauthAuthContext{OrganizationID: organizationID, UserID: userID}
	flow := oauthFlow{
		ID: flowID, OrganizationID: organizationID, UserID: userID,
		NonceHash: hashOAuthNonce(strings.Repeat("a", 43)),
		ReturnURL: "http://localhost:3000/integrations",
		ExpiresAt: time.Now().UTC().Add(10 * time.Minute),
	}
	if err := store.createFlow(ctx, flow); err != nil {
		t.Fatal(err)
	}
	defer func() {
		_, _ = database.Pool().Exec(context.Background(), `delete from public.meta_oauth_flows where id = $1::uuid`, flowID)
	}()
	payload := oauthFlowPayload{
		Success:        true,
		UserToken:      "integration-user-token-123456789",
		FacebookUserID: pageID,
		Pages:          []map[string]any{{"id": pageID, "name": "OAuth integration test"}},
		AdAccounts:     []oauthAdAccount{{ID: accountID, AccountID: pageID}},
	}
	if err := store.claimCallback(ctx, flow); err != nil {
		t.Fatal(err)
	}
	if err := store.finishCallbackSuccess(ctx, flow, payload); err != nil {
		t.Fatal(err)
	}
	var plaintextInPayload bool
	var referenceInPayload bool
	var tokenAbsentFromJSON bool
	var transientVaultTokenMatches bool
	if err := database.Pool().QueryRow(ctx, `
		select
		  flow.payload ? 'user_token',
		  flow.payload ? 'user_token_secret_ref',
		  position($2 in flow.payload::text) = 0,
		  exists (
		    select 1
		    from vault.decrypted_secrets as secret
		    where secret.id = private.meta_oauth_flow_transient_secret_id(flow.payload)
		      and secret.name = 'meta-oauth-flow:' || flow.id::text
		      and secret.decrypted_secret = $2
		  )
		from public.meta_oauth_flows as flow
		where flow.id = $1::uuid
	`, flowID, payload.UserToken).Scan(
		&plaintextInPayload,
		&referenceInPayload,
		&tokenAbsentFromJSON,
		&transientVaultTokenMatches,
	); err != nil || plaintextInPayload || !referenceInPayload || !tokenAbsentFromJSON || !transientVaultTokenMatches {
		t.Fatalf(
			"transient callback storage = plaintext:%v ref:%v token_absent:%v vault_match:%v, %v",
			plaintextInPayload,
			referenceInPayload,
			tokenAbsentFromJSON,
			transientVaultTokenMatches,
			err,
		)
	}

	claimed, err := store.claimConnectFlow(ctx, auth, flowID, pageID, []string{accountID})
	if err != nil || claimed.UserToken != payload.UserToken {
		var postgresError *pgconn.PgError
		_ = errors.As(err, &postgresError)
		t.Fatalf("claim result = %#v, %v (cause: %#v)", claimed, err, postgresError)
	}
	if _, err := store.claimConnectFlow(ctx, auth, flowID, pageID, []string{accountID}); oauthErrorCode(err) != "oauth_flow_not_available" {
		t.Fatalf("replay error = %v", err)
	}
	var consumed bool
	var payloadWiped bool
	if err := database.Pool().QueryRow(ctx, `
		select consumed_at is not null, payload = '{"consumed": true}'::jsonb
		from public.meta_oauth_flows where id = $1::uuid
	`, flowID).Scan(&consumed, &payloadWiped); err != nil || !consumed || !payloadWiped {
		t.Fatalf("flow single-use state = (%v, %v), %v", consumed, payloadWiped, err)
	}
	var transientSecretRemains bool
	if err := database.Pool().QueryRow(ctx, `
		select exists (
		  select 1 from vault.secrets
		  where name = 'meta-oauth-flow:' || $1::text
		)
	`, flowID).Scan(&transientSecretRemains); err != nil || transientSecretRemains {
		t.Fatalf("consumed flow retained transient Vault secret: %v, %v", transientSecretRemains, err)
	}

	createVaultBackedFlow := func(label string) oauthFlow {
		t.Helper()
		id, randomErr := randomOAuthUUID()
		if randomErr != nil {
			t.Fatal(randomErr)
		}
		candidate := oauthFlow{
			ID: id, OrganizationID: organizationID, UserID: userID,
			NonceHash: hashOAuthNonce(strings.Repeat(label, 43)[:43]),
			ReturnURL: "http://localhost:3000/integrations",
			ExpiresAt: time.Now().UTC().Add(10 * time.Minute),
		}
		if createErr := store.createFlow(ctx, candidate); createErr != nil {
			t.Fatal(createErr)
		}
		t.Cleanup(func() {
			_, _ = database.Pool().Exec(context.Background(), `delete from public.meta_oauth_flows where id = $1::uuid`, candidate.ID)
		})
		if claimErr := store.claimCallback(ctx, candidate); claimErr != nil {
			t.Fatal(claimErr)
		}
		if finishErr := store.finishCallbackSuccess(ctx, candidate, payload); finishErr != nil {
			t.Fatal(finishErr)
		}
		return candidate
	}

	errorFlow := createVaultBackedFlow("b")
	if _, err := database.Pool().Exec(ctx, `
		update public.meta_oauth_flows
		set status = 'error', error_message = 'oauth_callback_processing'
		where id = $1::uuid
	`, errorFlow.ID); err != nil {
		t.Fatal(err)
	}
	if err := store.finishCallbackError(ctx, errorFlow, "oauth_access_denied"); err != nil {
		t.Fatal(err)
	}
	assertOAuthFlowSecretCleared(t, ctx, database, errorFlow.ID, "error callback")

	expiredFlow := createVaultBackedFlow("c")
	if _, err := database.Pool().Exec(ctx, `
		update public.meta_oauth_flows
		set expires_at = now() - interval '1 minute'
		where id = $1::uuid
	`, expiredFlow.ID); err != nil {
		t.Fatal(err)
	}
	store.purgeUserFlowPayloads(ctx, auth)
	assertOAuthFlowSecretCleared(t, ctx, database, expiredFlow.ID, "expired-flow cleanup")

	cronFlow := createVaultBackedFlow("d")
	if _, err := database.Pool().Exec(ctx, `
		update public.meta_oauth_flows
		set expires_at = now() - interval '1 minute'
		where id = $1::uuid
	`, cronFlow.ID); err != nil {
		t.Fatal(err)
	}
	var cronCleaned int
	if err := database.Pool().QueryRow(ctx, `
		select private.purge_expired_meta_oauth_flows(now())
	`).Scan(&cronCleaned); err != nil || cronCleaned < 1 {
		t.Fatalf("scheduled cleanup result = %d, %v", cronCleaned, err)
	}
	assertOAuthFlowSecretCleared(t, ctx, database, cronFlow.ID, "scheduled cleanup")

	page := oauthPage{ID: pageID, Name: "OAuth integration test", AccessToken: "integration-page-token-123456789"}
	identity := oauthIdentity{ID: pageID}
	debug := oauthTokenDebug{UserID: pageID, Scopes: OAuthScopes()}
	defer func() {
		_ = store.deleteIntegration(context.Background(), organizationID, pageID)
	}()
	public, err := store.persistConnectedIntegration(
		ctx,
		auth,
		page,
		identity,
		debug,
		payload.UserToken,
		[]string{accountID},
		oauthConnectionOptions{DefaultStatus: "novo"},
		false,
	)
	if err != nil {
		t.Fatal(err)
	}
	publicJSON, _ := json.Marshal(public)
	if strings.Contains(string(publicJSON), "integration-page-token") || strings.Contains(string(publicJSON), "integration-user-token") {
		t.Fatalf("public integration leaked credentials: %s", publicJSON)
	}
	stored, err := store.getIntegration(ctx, organizationID, pageID)
	if err != nil {
		t.Fatal(err)
	}
	if stored.PageToken != page.AccessToken || stored.UserToken != payload.UserToken {
		t.Fatalf("Vault round trip did not preserve distinct credentials")
	}
	if err := store.deleteIntegration(ctx, organizationID, pageID); err != nil {
		t.Fatal(err)
	}
}

func assertOAuthFlowSecretCleared(
	t *testing.T,
	ctx context.Context,
	database *dbpkg.Postgres,
	flowID string,
	path string,
) {
	t.Helper()
	var payloadCleared bool
	var secretRemains bool
	if err := database.Pool().QueryRow(ctx, `
		select
		  flow.payload is null,
		  exists (
		    select 1 from vault.secrets
		    where name = 'meta-oauth-flow:' || flow.id::text
		  )
		from public.meta_oauth_flows as flow
		where flow.id = $1::uuid
	`, flowID).Scan(&payloadCleared, &secretRemains); err != nil || !payloadCleared || secretRemains {
		t.Fatalf(
			"%s cleanup = payload_cleared:%v secret_remains:%v, %v",
			path,
			payloadCleared,
			secretRemains,
			err,
		)
	}
}
