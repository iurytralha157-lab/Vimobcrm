package properties

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestUpsertPropertyOfferInputValidation(t *testing.T) {
	positivePrice := 350000.0
	monthly := "monthly"
	valid := UpsertPropertyOfferInput{
		Status:      "active",
		Price:       &positivePrice,
		Currency:    "brl",
		PricePeriod: &monthly,
	}
	if err := valid.Validate("rent"); err != nil {
		t.Fatalf("expected valid rental offer, got %v", err)
	}
	if valid.Currency != "BRL" || valid.PricePeriod == nil || *valid.PricePeriod != "monthly" {
		t.Fatalf("expected normalized offer, got %#v", valid)
	}

	zero := 0.0
	invalidActive := UpsertPropertyOfferInput{Status: "active", Price: &zero}
	if err := invalidActive.Validate("sale"); err == nil {
		t.Fatal("expected an active zero-price offer to fail")
	}

	invalidSalePeriod := UpsertPropertyOfferInput{Status: "draft", Price: &positivePrice, PricePeriod: &monthly}
	if err := invalidSalePeriod.Validate("sale"); err == nil {
		t.Fatal("expected a monthly sale offer to fail")
	}

	from, until := "2026-08-10", "2026-08-01"
	invalidDates := UpsertPropertyOfferInput{Status: "draft", AvailableFrom: &from, AvailableUntil: &until}
	if err := invalidDates.Validate("seasonal"); err == nil {
		t.Fatal("expected reversed availability dates to fail")
	}

	invalidCurrency := UpsertPropertyOfferInput{Status: "draft", Currency: "R$!"}
	if err := invalidCurrency.Validate("sale"); err == nil {
		t.Fatal("expected a non-ISO-shaped currency to fail")
	}
}

func TestPropertyKeyMovementValidation(t *testing.T) {
	withoutHolder := PropertyKeyMovementInput{
		MovementType:   "checkout",
		IdempotencyKey: "movement-1",
	}
	if err := withoutHolder.Validate(); err == nil {
		t.Fatal("expected checkout without holder to fail")
	}

	holder := "Maria Corretora"
	checkout := PropertyKeyMovementInput{
		MovementType:   "checkout",
		HolderName:     &holder,
		IdempotencyKey: "movement-2",
	}
	if err := checkout.Validate(); err != nil {
		t.Fatalf("expected checkout with holder to pass, got %v", err)
	}

	locationChange := PropertyKeyMovementInput{
		MovementType:   "location_change",
		IdempotencyKey: "movement-3",
	}
	if err := locationChange.Validate(); err == nil {
		t.Fatal("expected location change without destination to fail")
	}
}

func TestBuildWorkspaceSummary(t *testing.T) {
	workspace := PropertyWorkspace{
		Property: Property{
			"title":               "Apartamento com varanda",
			"tipo_de_imovel":      "Apartamento",
			"bairro":              "Centro",
			"cidade":              "Florianopolis",
			"uf":                  "SC",
			"descricao_site":      "Descricao pronta",
			"responsible_user_id": "00000000-0000-0000-0000-000000000001",
			"owner_id":            "00000000-0000-0000-0000-000000000002",
			"status":              "active",
		},
		Offers: []map[string]any{{"status": "active", "price": 950000.0}},
		Assets: []map[string]any{{"asset_type": "photo", "visibility": "public"}},
	}

	summary := buildWorkspaceSummary(workspace)
	if !summary.PublicationReady || summary.CompletenessScore != 100 {
		t.Fatalf("expected publication-ready workspace, got %#v", summary)
	}

	workspace.Offers = nil
	summary = buildWorkspaceSummary(workspace)
	if summary.PublicationReady || summary.CompletenessScore >= 100 {
		t.Fatalf("expected missing offer to block publication, got %#v", summary)
	}
}

func TestNormalizeWorkspaceDatabaseErrorMapsExclusionViolation(t *testing.T) {
	err := normalizeWorkspaceDatabaseError(&pgconn.PgError{Code: "23P01"})
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("exclusion violation normalized to %v, want invalid input", err)
	}
}

func TestNormalizeWorkspaceDatabaseErrorExplainsOwnershipRules(t *testing.T) {
	tests := []struct {
		name        string
		databaseErr *pgconn.PgError
		want        string
	}{
		{
			name:        "allocation",
			databaseErr: &pgconn.PgError{Code: "23514", Message: "property_ownership_allocation_exceeds_100"},
			want:        "exceed 100%",
		},
		{
			name:        "owner overlap from exclusion constraint",
			databaseErr: &pgconn.PgError{Code: "23P01", Message: "conflicting key value violates exclusion constraint", ConstraintName: "property_ownerships_owner_period_excl"},
			want:        "owner already has",
		},
		{
			name:        "primary overlap",
			databaseErr: &pgconn.PgError{Code: "23514", Message: "property_ownership_primary_period_overlap"},
			want:        "another primary owner",
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := normalizeWorkspaceDatabaseError(test.databaseErr)
			if !errors.Is(err, ErrInvalidInput) {
				t.Fatalf("expected invalid input, got %v", err)
			}
			if !strings.Contains(err.Error(), test.want) {
				t.Fatalf("expected actionable message containing %q, got %q", test.want, err.Error())
			}
		})
	}
}

func TestBuildWorkspaceSummaryIgnoresFutureAndHalfOpenEndedOwners(t *testing.T) {
	today := time.Now().UTC()
	workspace := PropertyWorkspace{Ownerships: []map[string]any{
		{
			"owner_id":   "11111111-1111-4111-8111-111111111111",
			"valid_from": today.AddDate(0, 0, 1).Format("2006-01-02"),
			"valid_to":   nil,
		},
		{
			"owner_id":   "22222222-2222-4222-8222-222222222222",
			"valid_from": today.AddDate(0, 0, -10).Format("2006-01-02"),
			"valid_to":   today.Format("2006-01-02"),
		},
	}}
	summary := buildWorkspaceSummary(workspace)
	if summary.Counts.Owners != 0 {
		t.Fatalf("current owner count = %d, want 0 for future/ended links", summary.Counts.Owners)
	}
}

func TestUnavailableNormalizedWorkspaceResourceIsStrict(t *testing.T) {
	tables := map[string]string{
		"property_offers":        "offers",
		"property_ownerships":    "ownerships",
		"property_assets":        "assets",
		"property_keys":          "keys",
		"property_key_movements": "key_history",
	}
	for table, wantResource := range tables {
		t.Run(table, func(t *testing.T) {
			databaseErr := &pgconn.PgError{
				Code:    "42P01",
				Message: fmt.Sprintf(`relation "public.%s" does not exist`, table),
			}
			resource, ok := unavailableNormalizedWorkspaceResource(fmt.Errorf("load workspace: %w", databaseErr))
			if !ok || resource != wantResource {
				t.Fatalf("classified resource = %q, %t; want %q, true", resource, ok, wantResource)
			}
		})
	}

	tests := []struct {
		name string
		err  error
	}{
		{name: "different SQLSTATE", err: &pgconn.PgError{Code: "42703", Message: `relation "public.property_offers" does not exist`}},
		{name: "unrelated table", err: &pgconn.PgError{Code: "42P01", Message: `relation "public.property_owners" does not exist`}},
		{name: "different schema", err: &pgconn.PgError{Code: "42P01", SchemaName: "private", TableName: "property_offers"}},
		{name: "non exact message", err: &pgconn.PgError{Code: "42P01", Message: `query failed because relation "public.property_offers" does not exist`}},
		{name: "plain application error", err: errors.New("property_offers does not exist")},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if resource, ok := unavailableNormalizedWorkspaceResource(test.err); ok {
				t.Fatalf("unexpected fallback classification for %q", resource)
			}
		})
	}
}

func TestBuildLegacyWorkspaceResponseIsSafeAndExplicitlyDegraded(t *testing.T) {
	raw := `{
		"id":"22222222-2222-4222-8222-222222222222",
		"organization_id":"11111111-1111-4111-8111-111111111111",
		"title":"Apartamento legado",
		"status":"active",
		"owner_id":"44444444-4444-4444-8444-444444444444",
		"owner_name":"Maria Proprietaria",
		"owner_email":"maria@example.com",
		"comentarios_internos":"nao expor",
		"imagem_principal":"https://images.example.test/property.jpg"
	}`

	response, err := buildLegacyWorkspaceResponse(raw, false, false)
	if err != nil {
		t.Fatalf("build legacy workspace: %v", err)
	}
	if response.Meta.NormalizedResourcesAvailable == nil || *response.Meta.NormalizedResourcesAvailable {
		t.Fatal("legacy fallback must report normalized resources as unavailable")
	}
	if got, want := strings.Join(response.Meta.UnavailableResources, ","), "offers,ownerships,assets,keys,key_history"; got != want {
		t.Fatalf("unavailable resources = %q, want %q", got, want)
	}
	if response.Meta.CanManage || response.Meta.CanViewOwnerContacts || response.Meta.CanViewConfidential {
		t.Fatalf("fallback elevated capabilities: %#v", response.Meta)
	}
	if _, exposed := response.Data.Property["owner_email"]; exposed {
		t.Fatal("fallback exposed a protected owner contact")
	}
	if _, exposed := response.Data.Property["comentarios_internos"]; exposed {
		t.Fatal("fallback exposed an internal property field")
	}
	if response.Data.Offers == nil || response.Data.Ownerships == nil || response.Data.Assets == nil ||
		response.Data.Keys == nil || response.Data.RecentKeyMovements == nil {
		t.Fatal("fallback collections must be initialized as empty arrays")
	}
	if response.Data.Summary.Counts.Owners != 1 || len(response.Data.Summary.Checklist) == 0 {
		t.Fatalf("fallback summary is not valid for legacy fields: %#v", response.Data.Summary)
	}
	photoResolved := false
	for _, check := range response.Data.Summary.Checklist {
		if check.Code == "photo" {
			photoResolved = check.Resolved
		}
	}
	if !photoResolved {
		t.Fatalf("legacy primary photo was not reflected in the summary: %#v", response.Data.Summary)
	}

	payload, err := json.Marshal(response)
	if err != nil {
		t.Fatalf("marshal fallback response: %v", err)
	}
	for _, collection := range []string{`"offers":[]`, `"ownerships":[]`, `"assets":[]`, `"keys":[]`, `"recent_key_movements":[]`} {
		if !strings.Contains(string(payload), collection) {
			t.Fatalf("fallback payload omitted empty collection %s: %s", collection, payload)
		}
	}
}

func TestWorkspaceMetaKeepsTheNormalizedResponseWireCompatible(t *testing.T) {
	payload, err := json.Marshal(WorkspaceMeta{
		CanManage:            true,
		CanViewOwnerContacts: true,
		CanViewConfidential:  true,
	})
	if err != nil {
		t.Fatalf("marshal normalized workspace meta: %v", err)
	}
	if strings.Contains(string(payload), "normalized_resources_available") || strings.Contains(string(payload), "unavailable_resources") {
		t.Fatalf("normalized meta changed the legacy wire contract: %s", payload)
	}
}
