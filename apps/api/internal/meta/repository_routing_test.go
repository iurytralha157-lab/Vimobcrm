package meta

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
)

func TestRequireUniqueLeadgenRoute(t *testing.T) {
	t.Run("keeps a unique page and form route routable", func(t *testing.T) {
		if err := requireUniqueLeadgenRoute("page-123", "form-456", 1); err != nil {
			t.Fatalf("requireUniqueLeadgenRoute() error = %v, want nil", err)
		}
	})

	t.Run("fails closed when the same provider form has two tenant routes", func(t *testing.T) {
		err := requireUniqueLeadgenRoute("page-123", "form-456", 2)
		if !errors.Is(err, ErrAmbiguousLeadgenRoute) {
			t.Fatalf("requireUniqueLeadgenRoute() error = %v, want ErrAmbiguousLeadgenRoute", err)
		}
		if !strings.Contains(err.Error(), "page-123") || !strings.Contains(err.Error(), "form-456") || !strings.Contains(err.Error(), "2 active routes") {
			t.Fatalf("requireUniqueLeadgenRoute() error = %q, want page, form and match count context", err)
		}
	})
}

func TestFindLeadgenRouteQueryScopesByPageAndFormBeforeChoosingCandidate(t *testing.T) {
	normalizedQuery := strings.Join(strings.Fields(findLeadgenRouteQuery), " ")
	for _, contract := range []string{
		"form_config.organization_id = integration.organization_id",
		"form_config.integration_id = integration.id",
		"btrim(integration.page_id) = btrim($1)",
		"btrim(form_config.form_id) = btrim($2)",
		"coalesce(integration.is_connected, false) = true",
		"coalesce(form_config.is_active, true) = true",
		"count(*)::bigint as matching_routes",
		"where route_decision.matching_routes = 1",
		"secret.decrypted_secret",
		"limit 1",
	} {
		if !strings.Contains(normalizedQuery, contract) {
			t.Fatalf("findLeadgenRouteQuery must contain %q; query = %q", contract, normalizedQuery)
		}
	}
	if strings.Contains(normalizedQuery, "organization_id = $") {
		t.Fatalf("provider webhook routing must never accept a tenant id from the payload: %q", normalizedQuery)
	}
}

func TestLegacyMetaLeadRecoveryRemainsTenantAndRouteScoped(t *testing.T) {
	normalizedQuery := strings.Join(strings.Fields(claimPendingWebhookEventsQuery), " ")
	for _, contract := range []string{
		"coalesce(received_at, created_at, now()) >= now() - interval '7 days'",
		"form_config.organization_id = meta_webhook_events.organization_id",
		"btrim(form_config.form_id) = btrim(meta_webhook_events.form_id)",
		"btrim(integration.page_id) = btrim(meta_webhook_events.page_id)",
		"coalesce(form_config.is_active, true) = true",
		"coalesce(integration.is_connected, false) = true",
		"for update skip locked",
	} {
		if !strings.Contains(normalizedQuery, contract) {
			t.Fatalf("legacy recovery must contain %q; query = %q", contract, normalizedQuery)
		}
	}
}

func TestResolveLeadgenRouteReturnsTheTenantBoundIntegrationAndForm(t *testing.T) {
	queryer := &stubLeadgenRouteQueryer{
		count: 1,
		integration: []byte(`{
			"id":"00000000-0000-4000-8000-000000000011",
			"organization_id":"00000000-0000-4000-8000-000000000001",
			"page_id":"page-123",
			"access_token":"page-token"
		}`),
		formConfig: []byte(`{
			"id":"00000000-0000-4000-8000-000000000021",
			"organization_id":"00000000-0000-4000-8000-000000000001",
			"integration_id":"00000000-0000-4000-8000-000000000011",
			"form_id":"form-456"
		}`),
	}

	integration, formConfig, err := resolveLeadgenRoute(t.Context(), queryer, "page-123", "form-456")
	if err != nil {
		t.Fatalf("resolveLeadgenRoute() error = %v", err)
	}
	if integration.OrganizationID != "00000000-0000-4000-8000-000000000001" ||
		formConfig.OrganizationID != integration.OrganizationID ||
		formConfig.IntegrationID != integration.ID ||
		formConfig.FormID != "form-456" {
		t.Fatalf("resolved route is not tenant-bound: integration=%#v form=%#v", integration, formConfig)
	}
	if len(queryer.arguments) != 2 || queryer.arguments[0] != "page-123" || queryer.arguments[1] != "form-456" {
		t.Fatalf("provider route arguments = %#v", queryer.arguments)
	}
}

func TestResolveLeadgenRouteFailsClosedWithoutAUniqueFormRoute(t *testing.T) {
	t.Run("missing route", func(t *testing.T) {
		_, _, err := resolveLeadgenRoute(t.Context(), &stubLeadgenRouteQueryer{
			count:       0,
			integration: []byte(`{}`),
			formConfig:  []byte(`{}`),
		}, "page-123", "form-missing")
		if !errors.Is(err, pgx.ErrNoRows) {
			t.Fatalf("resolveLeadgenRoute() error = %v, want pgx.ErrNoRows", err)
		}
	})

	t.Run("ambiguous route", func(t *testing.T) {
		_, _, err := resolveLeadgenRoute(t.Context(), &stubLeadgenRouteQueryer{
			count:       2,
			integration: []byte(`{}`),
			formConfig:  []byte(`{}`),
		}, "page-123", "form-conflict")
		if !errors.Is(err, ErrAmbiguousLeadgenRoute) {
			t.Fatalf("resolveLeadgenRoute() error = %v, want ErrAmbiguousLeadgenRoute", err)
		}
	})
}

type stubLeadgenRouteQueryer struct {
	count       int64
	integration []byte
	formConfig  []byte
	arguments   []any
}

func (stub *stubLeadgenRouteQueryer) QueryRow(_ context.Context, _ string, arguments ...any) pgx.Row {
	stub.arguments = append([]any(nil), arguments...)
	return stubLeadgenRouteRow{
		count:       stub.count,
		integration: stub.integration,
		formConfig:  stub.formConfig,
	}
}

type stubLeadgenRouteRow struct {
	count       int64
	integration []byte
	formConfig  []byte
}

func (row stubLeadgenRouteRow) Scan(destinations ...any) error {
	*(destinations[0].(*int64)) = row.count
	*(destinations[1].(*[]byte)) = row.integration
	*(destinations[2].(*[]byte)) = row.formConfig
	return nil
}
