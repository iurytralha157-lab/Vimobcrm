package propertyscope_test

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/financial"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/integrations"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/webhooks"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func TestPropertyConsumersShareCanonicalVisibilityAgainstLocalPostgres(t *testing.T) {
	if os.Getenv("VIMOB_RUN_DB_TESTS") != "1" {
		t.Skip("set VIMOB_RUN_DB_TESTS=1 to run database integration tests")
	}
	databaseURL := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	parsedURL, err := url.Parse(databaseURL)
	if err != nil || databaseURL == "" {
		t.Fatalf("valid DATABASE_URL is required: %v", err)
	}
	switch strings.ToLower(parsedURL.Hostname()) {
	case "localhost", "127.0.0.1", "::1":
	default:
		t.Fatalf("consumer scope integration requires loopback PostgreSQL, got %q", parsedURL.Hostname())
	}

	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{
		URL: databaseURL, MaxConns: 3, MinConns: 0, HealthTimeout: 5 * time.Second,
	})
	if err != nil {
		t.Fatalf("connect local PostgreSQL: %v", err)
	}
	t.Cleanup(postgres.Close)

	organizationID, actorID, otherID := existingOrganizationWithTwoMembers(t, ctx, postgres)
	suffix := fmt.Sprintf("%d", time.Now().UnixNano())

	type fixture struct {
		propertyID   string
		contractID   string
		entryID      string
		commissionID string
		webhookID    string
		code         string
	}
	createFixture := func(ownerID string, label string) fixture {
		t.Helper()
		item := fixture{code: "SCOPE-" + label + "-" + suffix}
		if err := postgres.Pool().QueryRow(ctx, `
			insert into public.properties (
				organization_id, code, title, tipo_de_negocio, finalidade,
				created_by, responsible_user_id, status
			) values ($1::uuid, $2, $3, 'Venda', 'venda', $4::uuid, $4::uuid, 'active')
			returning id::text
		`, organizationID, item.code, "Imovel "+label+" "+suffix, ownerID).Scan(&item.propertyID); err != nil {
			t.Fatalf("insert %s property: %v", label, err)
		}
		if err := postgres.Pool().QueryRow(ctx, `
			insert into public.contracts (
				organization_id, property_id, contract_number, contract_type, status, value, created_by
			) values ($1::uuid, $2::uuid, $3, 'sale', 'draft', 100000, $4::uuid)
			returning id::text
		`, organizationID, item.propertyID, "CTR-"+label+"-"+suffix, actorID).Scan(&item.contractID); err != nil {
			t.Fatalf("insert %s contract: %v", label, err)
		}
		if err := postgres.Pool().QueryRow(ctx, `
			insert into public.financial_entries (
				organization_id, contract_id, type, description, amount, created_by
			) values ($1::uuid, $2::uuid, 'income', $3, 1000, $4::uuid)
			returning id::text
		`, organizationID, item.contractID, "entry-"+label+"-"+suffix, actorID).Scan(&item.entryID); err != nil {
			t.Fatalf("insert %s entry: %v", label, err)
		}
		if err := postgres.Pool().QueryRow(ctx, `
			insert into public.commissions (
				organization_id, contract_id, property_id, user_id, amount, base_value, calculated_value
			) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, 5000, 100000, 5000)
			returning id::text
		`, organizationID, item.contractID, item.propertyID, actorID).Scan(&item.commissionID); err != nil {
			t.Fatalf("insert %s commission: %v", label, err)
		}
		if err := postgres.Pool().QueryRow(ctx, `
			insert into public.webhooks_integrations (
				organization_id, name, type, target_property_id, field_mapping, created_by
			) values (
				$1::uuid, $2, 'incoming', $3::uuid,
				jsonb_build_object('interest_property_id', $3::text, 'name', 'name'), $4::uuid
			)
			returning id::text
		`, organizationID, "webhook-"+label+"-"+suffix, item.propertyID, actorID).Scan(&item.webhookID); err != nil {
			t.Fatalf("insert %s webhook: %v", label, err)
		}
		return item
	}

	own := createFixture(actorID, "own")
	hidden := createFixture(otherID, "hidden")
	if _, err := postgres.Pool().Exec(ctx, `
		update public.webhooks_integrations
		set target_property_id = null
		where organization_id = $1::uuid and id in ($2::uuid, $3::uuid)
	`, organizationID, own.webhookID, hidden.webhookID); err != nil {
		t.Fatalf("move webhook property fixtures to legacy field mapping: %v", err)
	}
	var metaIntegrationID string
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.meta_integrations (organization_id, page_id, page_name, is_connected)
		values ($1::uuid, $2, $3, false)
		returning id::text
	`, organizationID, "scope-page-"+suffix, "Scope page "+suffix).Scan(&metaIntegrationID); err != nil {
		t.Fatalf("insert Meta integration: %v", err)
	}
	metaFormIDs := []string{"scope-own-" + suffix, "scope-hidden-" + suffix}
	if _, err := postgres.Pool().Exec(ctx, `
		insert into public.meta_form_configs (
			organization_id, integration_id, form_id, form_name, property_id, default_values, created_by
		) values
			($1::uuid, $2::uuid, $3, 'Own form', $4::uuid, jsonb_build_object('property_id', $4::text), $6::uuid),
			($1::uuid, $2::uuid, $5, 'Hidden form', $7::uuid, jsonb_build_object('interest_property_id', $7::text), $6::uuid)
	`, organizationID, metaIntegrationID, metaFormIDs[0], own.propertyID, metaFormIDs[1], actorID, hidden.propertyID); err != nil {
		t.Fatalf("insert Meta form configs: %v", err)
	}

	t.Cleanup(func() {
		cleanupContext, cleanupCancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cleanupCancel()
		_, _ = postgres.Pool().Exec(cleanupContext, `delete from public.meta_form_configs where organization_id = $1::uuid and integration_id = $2::uuid`, organizationID, metaIntegrationID)
		_, _ = postgres.Pool().Exec(cleanupContext, `delete from public.meta_integrations where organization_id = $1::uuid and id = $2::uuid`, organizationID, metaIntegrationID)
		for _, item := range []fixture{own, hidden} {
			_, _ = postgres.Pool().Exec(cleanupContext, `delete from public.webhooks_integrations where organization_id = $1::uuid and id = $2::uuid`, organizationID, item.webhookID)
			_, _ = postgres.Pool().Exec(cleanupContext, `delete from public.commissions where organization_id = $1::uuid and id = $2::uuid`, organizationID, item.commissionID)
			_, _ = postgres.Pool().Exec(cleanupContext, `delete from public.financial_entries where organization_id = $1::uuid and id = $2::uuid`, organizationID, item.entryID)
			_, _ = postgres.Pool().Exec(cleanupContext, `delete from public.contracts where organization_id = $1::uuid and id = $2::uuid`, organizationID, item.contractID)
			_, _ = postgres.Pool().Exec(cleanupContext, `delete from public.properties where organization_id = $1::uuid and id = $2::uuid`, organizationID, item.propertyID)
		}
	})

	viewer := tenant.Context{
		OrganizationID: organizationID,
		UserID:         actorID,
		MemberRole:     "user",
		Permissions:    []string{permissions.FinancialView, permissions.PropertyView},
	}
	manager := viewer
	manager.Permissions = []string{permissions.FinancialManage, permissions.PropertyManage}
	withoutPropertyAccess := viewer
	withoutPropertyAccess.Permissions = []string{permissions.FinancialView, permissions.SettingsIntegrations}

	financialRepo := financial.NewRepository(postgres, financial.StorageConfig{})
	assertFinancialPropertyProjection(t, mustListContracts(t, ctx, financialRepo, viewer), own.contractID, own.code, hidden.contractID, hidden.code, true, false)
	assertFinancialPropertyProjection(t, mustListContracts(t, ctx, financialRepo, manager), own.contractID, own.code, hidden.contractID, hidden.code, true, true)
	assertFinancialPropertyProjection(t, mustListContracts(t, ctx, financialRepo, withoutPropertyAccess), own.contractID, own.code, hidden.contractID, hidden.code, false, false)
	financialOwnManager := viewer
	financialOwnManager.Permissions = []string{permissions.FinancialManage, permissions.PropertyView}
	if _, err := financialRepo.CreateContract(ctx, financialOwnManager, map[string]any{
		"contract_type": "sale",
		"client_name":   "Blocked hidden property",
		"value":         100.0,
		"down_payment":  0.0,
		"installments":  1,
		"property_id":   hidden.propertyID,
	}); !errors.Is(err, tenant.ErrOrganizationAccessDenied) {
		t.Fatalf("hidden financial property error = %v, want tenant access denied", err)
	}

	entries, err := financialRepo.ListEntries(ctx, viewer, url.Values{})
	if err != nil {
		t.Fatalf("list scoped entries: %v", err)
	}
	assertConsumerProperty(t, findItemByID(t, entries, own.entryID), true, own.code)
	assertConsumerProperty(t, findItemByID(t, entries, hidden.entryID), false, hidden.code)
	commissions, err := financialRepo.ListCommissions(ctx, viewer, url.Values{})
	if err != nil {
		t.Fatalf("list scoped commissions: %v", err)
	}
	assertConsumerProperty(t, findItemByID(t, commissions, own.commissionID), true, own.code)
	assertConsumerProperty(t, findItemByID(t, commissions, hidden.commissionID), false, hidden.code)

	webhookRepo := webhooks.NewRepository(postgres)
	viewerWebhooks, err := webhookRepo.List(ctx, viewer)
	if err != nil {
		t.Fatalf("list scoped webhooks: %v", err)
	}
	assertWebhookProperty(t, findItemByID(t, viewerWebhooks, own.webhookID), true, own.propertyID)
	assertWebhookProperty(t, findItemByID(t, viewerWebhooks, hidden.webhookID), false, hidden.propertyID)
	settingsOnlyWebhooks, err := webhookRepo.List(ctx, withoutPropertyAccess)
	if err != nil {
		t.Fatalf("list webhooks without property access: %v", err)
	}
	assertWebhookProperty(t, findItemByID(t, settingsOnlyWebhooks, own.webhookID), false, own.propertyID)

	hiddenPropertyID := hidden.propertyID
	webhookName := "blocked-hidden-" + suffix
	webhookType := "incoming"
	if _, err := webhookRepo.Create(ctx, viewer, webhooks.WebhookRequest{
		Name: &webhookName, Type: &webhookType, TargetPropertyID: &hiddenPropertyID,
	}); !errors.Is(err, webhooks.ErrInvalidInput) {
		t.Fatalf("hidden webhook property error = %v, want invalid input", err)
	}

	metaRepo := integrations.NewRepository(postgres, integrations.ExternalConfig{})
	viewerForms, err := metaRepo.ListMetaFormConfigs(ctx, viewer, metaIntegrationID)
	if err != nil {
		t.Fatalf("list scoped Meta forms: %v", err)
	}
	assertMetaFormProperty(t, findItemByField(t, viewerForms, "form_id", metaFormIDs[0]), true, own.propertyID)
	assertMetaFormProperty(t, findItemByField(t, viewerForms, "form_id", metaFormIDs[1]), false, hidden.propertyID)
	settingsOnlyForms, err := metaRepo.ListMetaFormConfigs(ctx, withoutPropertyAccess, metaIntegrationID)
	if err != nil {
		t.Fatalf("list Meta forms without property access: %v", err)
	}
	assertMetaFormProperty(t, findItemByField(t, settingsOnlyForms, "form_id", metaFormIDs[0]), false, own.propertyID)
	if _, err := metaRepo.SaveMetaFormConfig(ctx, viewer, integrations.MetaFormConfigRequest{
		IntegrationID: metaIntegrationID,
		FormID:        "blocked-hidden-" + suffix,
		PropertyID:    &hiddenPropertyID,
	}); !errors.Is(err, integrations.ErrInvalidInput) {
		t.Fatalf("hidden Meta form property error = %v, want invalid input", err)
	}
	if _, err := metaRepo.SaveMetaFormConfig(ctx, viewer, integrations.MetaFormConfigRequest{
		IntegrationID: metaIntegrationID,
		FormID:        "blocked-hidden-default-" + suffix,
		DefaultValues: map[string]any{"interest_property_id": hidden.propertyID},
	}); !errors.Is(err, integrations.ErrInvalidInput) {
		t.Fatalf("hidden Meta default property error = %v, want invalid input", err)
	}
}

func existingOrganizationWithTwoMembers(t *testing.T, ctx context.Context, postgres *dbpkg.Postgres) (string, string, string) {
	t.Helper()
	rows, err := postgres.Pool().Query(ctx, `
		select member.organization_id::text, member.user_id::text
		from public.organization_members member
		join public.users app_user on app_user.id = member.user_id
		where member.is_active = true and coalesce(app_user.is_active, true) = true
		order by member.organization_id, member.created_at, member.user_id
	`)
	if err != nil {
		t.Fatalf("query active members: %v", err)
	}
	defer rows.Close()
	organizationID := ""
	userIDs := []string{}
	for rows.Next() {
		var candidateOrganizationID, userID string
		if err := rows.Scan(&candidateOrganizationID, &userID); err != nil {
			t.Fatalf("scan active member: %v", err)
		}
		if organizationID == "" {
			organizationID = candidateOrganizationID
		}
		if candidateOrganizationID == organizationID && len(userIDs) < 2 {
			userIDs = append(userIDs, userID)
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate active members: %v", err)
	}
	if len(userIDs) < 2 {
		t.Skip("an organization with two active users is required")
	}
	return organizationID, userIDs[0], userIDs[1]
}

func mustListContracts(t *testing.T, ctx context.Context, repo financial.Repository, tenantContext tenant.Context) []map[string]any {
	t.Helper()
	items, err := repo.ListContracts(ctx, tenantContext, url.Values{})
	if err != nil {
		t.Fatalf("list contracts: %v", err)
	}
	return items
}

func assertFinancialPropertyProjection(
	t *testing.T,
	items []map[string]any,
	ownContractID string,
	ownCode string,
	hiddenContractID string,
	hiddenCode string,
	ownVisible bool,
	hiddenVisible bool,
) {
	t.Helper()
	assertConsumerProperty(t, findItemByID(t, items, ownContractID), ownVisible, ownCode)
	assertConsumerProperty(t, findItemByID(t, items, hiddenContractID), hiddenVisible, hiddenCode)
}

func assertConsumerProperty(t *testing.T, item map[string]any, visible bool, code string) {
	t.Helper()
	property, _ := item["property"].(map[string]any)
	rawPropertyID, hasPropertyID := item["property_id"]
	propertyID := strings.TrimSpace(fmt.Sprint(rawPropertyID))
	if visible {
		if property == nil || property["code"] != code || (hasPropertyID && (propertyID == "" || propertyID == "<nil>")) {
			t.Fatalf("visible property projection incomplete: %#v", item)
		}
		return
	}
	if property != nil || (hasPropertyID && propertyID != "" && propertyID != "<nil>") {
		t.Fatalf("hidden property projection leaked: %#v", item)
	}
}

func assertWebhookProperty(t *testing.T, item map[string]any, visible bool, propertyID string) {
	t.Helper()
	property, _ := item["property"].(map[string]any)
	projectedID := strings.TrimSpace(fmt.Sprint(item["target_property_id"]))
	mapping, _ := item["field_mapping"].(map[string]any)
	_, mappingLeaksID := mapping["interest_property_id"]
	if visible {
		if property == nil || projectedID != propertyID || !mappingLeaksID {
			t.Fatalf("visible webhook property projection incomplete: %#v", item)
		}
		return
	}
	if property != nil || (projectedID != "" && projectedID != "<nil>") || mappingLeaksID {
		t.Fatalf("hidden webhook property projection leaked: %#v", item)
	}
}

func assertMetaFormProperty(t *testing.T, item map[string]any, visible bool, propertyID string) {
	t.Helper()
	projectedID := strings.TrimSpace(fmt.Sprint(item["property_id"]))
	defaults, _ := item["default_values"].(map[string]any)
	defaultID := ""
	if defaults != nil {
		defaultID = strings.TrimSpace(fmt.Sprint(defaults["property_id"]))
		if defaultID == "" || defaultID == "<nil>" {
			defaultID = strings.TrimSpace(fmt.Sprint(defaults["interest_property_id"]))
		}
	}
	if visible && (projectedID != propertyID || defaultID != propertyID) {
		t.Fatalf("visible Meta form property projection is incomplete: %#v", item)
	}
	if !visible && ((projectedID != "" && projectedID != "<nil>") || (defaultID != "" && defaultID != "<nil>")) {
		t.Fatalf("hidden Meta form property id leaked: %#v", item)
	}
}

func findItemByID(t *testing.T, items []map[string]any, id string) map[string]any {
	return findItemByField(t, items, "id", id)
}

func findItemByField(t *testing.T, items []map[string]any, field string, value string) map[string]any {
	t.Helper()
	for _, item := range items {
		if fmt.Sprint(item[field]) == value {
			return item
		}
	}
	t.Fatalf("item %s=%s not found", field, value)
	return nil
}
