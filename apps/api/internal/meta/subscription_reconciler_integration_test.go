package meta

import (
	"context"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

// META_SUBSCRIPTION_TEST_DATABASE_URL must point to a disposable loopback
// Supabase database with the Marketing foundation migration applied.
func TestWebhookSubscriptionTargetQueryAgainstPostgres(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("META_SUBSCRIPTION_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("set META_SUBSCRIPTION_TEST_DATABASE_URL to run the PostgreSQL/Vault query contract test")
	}
	parsed, err := url.Parse(databaseURL)
	if err != nil || !isOAuthLoopbackHost(parsed.Hostname()) {
		t.Fatalf("META_SUBSCRIPTION_TEST_DATABASE_URL must use a loopback host")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	database, err := dbpkg.NewPostgres(ctx, dbpkg.Config{
		URL:           databaseURL,
		HealthTimeout: 3 * time.Second,
	})
	if err != nil {
		t.Fatalf("connect PostgreSQL: %v", err)
	}
	defer database.Close()

	repository := NewRepository(database, Config{AppSecret: "local-contract-app-secret"})
	targets, err := repository.loadWebhookSubscriptionTargets(ctx)
	if err != nil {
		t.Fatalf("load webhook subscription targets: %v", err)
	}
	for _, target := range targets {
		if strings.TrimSpace(target.IntegrationID) == "" ||
			strings.TrimSpace(target.OrganizationID) == "" ||
			strings.TrimSpace(target.PageID) == "" ||
			strings.TrimSpace(target.PageToken) == "" {
			t.Fatal("reconciliation query returned an incomplete target")
		}
	}
}
