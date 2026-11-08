package marketing

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestPostgresStoreIsolatesTenantsAndCleansSecrets(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("MARKETING_CONNECTIONS_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("set MARKETING_CONNECTIONS_TEST_DATABASE_URL to run the PostgreSQL contract test")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	defer pool.Close()

	var organizationA, organizationB, userID string
	if err := pool.QueryRow(ctx, `
		select
		  (select id::text from public.organizations order by id limit 1),
		  (select id::text from public.organizations order by id offset 1 limit 1),
		  (select id::text from public.users order by id limit 1)
	`).Scan(&organizationA, &organizationB, &userID); err != nil {
		t.Fatalf("load two organizations and a user: %v", err)
	}
	store := NewPostgresStore(pool)
	externalUser := "test-" + time.Now().Format("150405.000000")
	input := SaveConnectionInput{
		OrganizationID: organizationA, UserID: userID, Provider: ProviderMeta,
		ExternalUserID: externalUser, ExternalUserName: "Pessoa", GrantedScopes: []string{"ads_read"},
		AccessToken: "first-" + externalUser,
		Assets: []DiscoveredAsset{
			{Type: AssetAdAccount, ExternalID: "1", Name: "Conta", Metadata: map[string]any{"currency": "BRL"}},
			{Type: AssetPage, ExternalID: "2", Name: "Pagina", Metadata: map[string]any{}},
		},
	}
	connectionID, err := store.SaveConnection(ctx, input)
	if err != nil {
		t.Fatalf("save: %v", err)
	}
	t.Cleanup(func() { _ = store.DeleteConnection(context.Background(), organizationA, connectionID) })

	listed, err := store.ListConnections(ctx, organizationB)
	if err != nil {
		t.Fatalf("list other tenant: %v", err)
	}
	for _, connection := range listed {
		if connection.ID == connectionID {
			t.Fatal("another organization can see this connection")
		}
	}
	mine := findConnection(t, store, organizationA, connectionID)
	if len(mine.Assets) != 2 {
		t.Fatalf("assets = %+v", mine.Assets)
	}
	assetID := mine.Assets[0].ID

	if err := store.UpdateSelection(ctx, organizationB, connectionID, []string{assetID}); err == nil {
		t.Fatal("another organization changed the selection")
	}
	if err := store.UpdateSelection(ctx, organizationA, connectionID, []string{"00000000-0000-4000-8000-000000000000"}); err == nil {
		t.Fatal("unknown asset accepted")
	}
	if err := store.UpdateSelection(ctx, organizationA, connectionID, []string{assetID}); err != nil {
		t.Fatalf("select: %v", err)
	}

	// Reconnecting keeps earlier choices, drops lost assets and rotates the secret.
	input.AccessToken = "second-" + externalUser
	input.Assets = input.Assets[:1]
	again, err := store.SaveConnection(ctx, input)
	if err != nil || again != connectionID {
		t.Fatalf("reconnect: %q %v", again, err)
	}
	mine = findConnection(t, store, organizationA, connectionID)
	if len(mine.Assets) != 1 || !mine.Assets[0].IsSelected {
		t.Fatalf("assets after reconnect = %+v", mine.Assets)
	}
	if count := countSecrets(t, pool, input.AccessToken); count != 1 {
		t.Fatalf("new secret count = %d", count)
	}
	if count := countSecrets(t, pool, "first-"+externalUser); count != 0 {
		t.Fatalf("old secret survived: %d", count)
	}

	if err := store.DeleteConnection(ctx, organizationB, connectionID); err == nil {
		t.Fatal("another organization deleted the connection")
	}
	if err := store.DeleteConnection(ctx, organizationA, connectionID); err != nil {
		t.Fatalf("delete: %v", err)
	}
	if count := countSecrets(t, pool, input.AccessToken); count != 0 {
		t.Fatalf("secret survived disconnect: %d", count)
	}

	flow := Flow{
		OrganizationID: organizationA, UserID: userID, Provider: ProviderMeta,
		NonceHash: "hash-" + externalUser, ReturnURL: "https://crm.example.com", ExpiresAt: time.Now().Add(time.Minute),
	}
	flowID, err := store.CreateFlow(ctx, flow)
	if err != nil {
		t.Fatalf("create flow: %v", err)
	}
	if _, err := store.ConsumeFlow(ctx, flowID, "wrong"); err == nil {
		t.Fatal("wrong nonce accepted")
	}
	if _, err := store.ConsumeFlow(ctx, flowID, flow.NonceHash); err != nil {
		t.Fatalf("consume: %v", err)
	}
	if _, err := store.ConsumeFlow(ctx, flowID, flow.NonceHash); err == nil {
		t.Fatal("flow consumed twice")
	}
	flow.NonceHash += "-expired"
	flow.ExpiresAt = time.Now().Add(-time.Minute)
	expiredID, err := store.CreateFlow(ctx, flow)
	if err != nil {
		t.Fatalf("create expired flow: %v", err)
	}
	if _, err := store.ConsumeFlow(ctx, expiredID, flow.NonceHash); err == nil {
		t.Fatal("expired flow accepted")
	}
}

func findConnection(t *testing.T, store *PostgresStore, organizationID string, connectionID string) Connection {
	t.Helper()
	connections, err := store.ListConnections(context.Background(), organizationID)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	for _, connection := range connections {
		if connection.ID == connectionID {
			return connection
		}
	}
	t.Fatal("connection not found")
	return Connection{}
}

func countSecrets(t *testing.T, pool *pgxpool.Pool, value string) int {
	t.Helper()
	var count int
	if err := pool.QueryRow(context.Background(), `
		select count(*)::int from vault.decrypted_secrets where decrypted_secret = $1
	`, value).Scan(&count); err != nil {
		t.Fatalf("count secrets: %v", err)
	}
	return count
}
