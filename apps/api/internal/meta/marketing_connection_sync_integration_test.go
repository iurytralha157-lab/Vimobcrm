package meta

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// The connection path must import facts with no integration and leave the lead
// intake table alone. It runs against a migrated database and a fake Graph API.
func TestSyncConnectionWritesFactsAndLeavesMetaIntegrationsAlone(t *testing.T) {
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
	var organizationID, userID string
	if err := pool.QueryRow(ctx, `
		select (select id::text from public.organizations order by id limit 1),
		       (select id::text from public.users order by id limit 1)
	`).Scan(&organizationID, &userID); err != nil {
		t.Fatalf("load tenant: %v", err)
	}

	methods := []string{}
	graph := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		methods = append(methods, r.Method+" "+r.URL.Path)
		switch {
		case strings.HasSuffix(r.URL.Path, "/act_999"):
			_, _ = io.WriteString(w, `{"id":"act_999","account_id":"999","name":"Conta teste","account_status":1,"currency":"BRL","timezone_name":"America/Sao_Paulo"}`)
		case strings.HasSuffix(r.URL.Path, "/insights") && r.URL.Query().Get("level") == "campaign":
			_, _ = io.WriteString(w, `{"data":[{"date_start":"2026-10-05","date_stop":"2026-10-05","account_id":"999","campaign_id":"c1","campaign_name":"Campanha teste","spend":"120.50","impressions":"1000","reach":"800","clicks":"40","inline_link_clicks":"30","actions":[{"action_type":"lead","value":"5"}]}]}`)
		default:
			_, _ = io.WriteString(w, `{"data":[]}`)
		}
	}))
	defer graph.Close()

	service := newMarketingSyncService(pool, Config{AppSecret: "secret-value", GraphVersion: "v25.0", GraphBaseURL: graph.URL}, graph.Client())
	service.graphBaseURL = graph.URL
	result, err := service.SyncConnection(ctx, MarketingConnectionSyncRequest{
		MarketingSyncRequest: MarketingSyncRequest{
			OrganizationID: organizationID, UserID: userID, DateFrom: "2026-10-05", DateTo: "2026-10-05",
		},
		AccessToken: "connection-token",
		AdAccounts:  []string{"999", "act_999"},
	})
	if err != nil {
		t.Fatalf("sync: %v (%+v)", err, result)
	}
	if result.Synced == 0 {
		t.Fatalf("no facts imported: %+v, calls %v", result, methods)
	}
	for _, call := range methods {
		if !strings.HasPrefix(call, http.MethodGet+" ") || strings.Contains(call, "subscribed_apps") {
			t.Errorf("unexpected Graph call %s", call)
		}
	}
	var facts, linked, runs int
	if err := pool.QueryRow(ctx, `
		select
		  (select count(*)::int from public.marketing_performance_daily where organization_id = $1::uuid and external_account_id = 'act_999'),
		  (select count(*)::int from public.marketing_performance_daily where organization_id = $1::uuid and external_account_id = 'act_999' and integration_id is not null),
		  (select count(*)::int from public.marketing_sync_runs where organization_id = $1::uuid and integration_id is null and status <> 'running')
	`, organizationID).Scan(&facts, &linked, &runs); err != nil {
		t.Fatalf("read facts: %v", err)
	}
	if facts == 0 || linked != 0 || runs == 0 {
		t.Fatalf("facts=%d linked=%d finished runs=%d", facts, linked, runs)
	}
	var integrations int
	var changed int
	if err := pool.QueryRow(ctx, `
		select count(*)::int, count(*) filter (where last_sync_at is not null or health_status is not null)::int
		from public.meta_integrations where organization_id = $1::uuid
	`, organizationID).Scan(&integrations, &changed); err != nil {
		t.Fatalf("read integrations: %v", err)
	}
	if changed != 0 {
		t.Fatalf("a meta integration was changed: %d of %d", changed, integrations)
	}
}
