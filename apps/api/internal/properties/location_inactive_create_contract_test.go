package properties

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestLocationCreateIgnoresInactiveRowsAndNormalizesInsertConflicts(t *testing.T) {
	sourceBytes, err := os.ReadFile("locations.go")
	if err != nil {
		t.Fatalf("read locations.go: %v", err)
	}
	source := string(sourceBytes)
	tests := []struct {
		name        string
		startMarker string
		endMarker   string
		activeGuard string
	}{
		{
			name:        "city",
			startMarker: "func (repo Repository) CreateCity(",
			endMarker:   "func (repo Repository) UpdateCity(",
			activeGuard: "and coalesce(c.is_active, true)",
		},
		{
			name:        "neighborhood",
			startMarker: "func (repo Repository) CreateNeighborhood(",
			endMarker:   "func (repo Repository) UpdateNeighborhood(",
			activeGuard: "and coalesce(n.is_active, true)",
		},
		{
			name:        "condominium",
			startMarker: "func (repo Repository) CreateCondominium(",
			endMarker:   "func (repo Repository) UpdateCondominium(",
			activeGuard: "and coalesce(co.is_active, true)",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			body := sourceSection(t, source, test.startMarker, test.endMarker)
			if !strings.Contains(body, test.activeGuard) {
				t.Fatalf("create %s must return only active catalog rows", test.name)
			}
			if !strings.Contains(body, "return nil, normalizeWorkspaceDatabaseError(err)") {
				t.Fatalf("create %s must normalize insert constraint errors", test.name)
			}
		})
	}
}

func TestLocationIdentityUniqueViolationsUseStableConflictContract(t *testing.T) {
	constraints := []string{
		"property_cities_organization_id_name_uf_key",
		"property_neighborhoods_organization_id_city_id_name_key",
		"property_condominiums_active_locality_name_uidx",
	}
	const expectedMessage = "J\u00e1 existe uma cidade, bairro ou condom\u00ednio com os mesmos dados, possivelmente desativado. Reative o cadastro existente ou use dados diferentes."

	for _, constraint := range constraints {
		t.Run(constraint, func(t *testing.T) {
			databaseError := &pgconn.PgError{Code: "23505", ConstraintName: constraint}
			normalized := normalizeWorkspaceDatabaseError(databaseError)
			if !errors.Is(normalized, ErrPropertyLocationIdentityConflict) {
				t.Fatalf("normalized error = %v, want ErrPropertyLocationIdentityConflict", normalized)
			}
			if errors.Is(normalized, ErrPropertyWorkspaceConflict) {
				t.Fatal("location identity collision must not use the generic workspace conflict")
			}

			request := httptest.NewRequest(http.MethodPost, "/v1/property-locations", nil)
			response := httptest.NewRecorder()
			writePropertyError(response, request, databaseError)
			if response.Code != http.StatusConflict {
				t.Fatalf("status = %d, want %d", response.Code, http.StatusConflict)
			}
			var payload struct {
				Error struct {
					Code    string `json:"code"`
					Message string `json:"message"`
				} `json:"error"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			if payload.Error.Code != "property_location_identity_conflict" {
				t.Fatalf("error code = %q, want property_location_identity_conflict", payload.Error.Code)
			}
			if payload.Error.Message != expectedMessage {
				t.Fatalf("error message = %q, want %q", payload.Error.Message, expectedMessage)
			}
		})
	}
}

func TestUnrelatedUniqueViolationKeepsGenericWorkspaceConflict(t *testing.T) {
	normalized := normalizeWorkspaceDatabaseError(&pgconn.PgError{
		Code:           "23505",
		ConstraintName: "unrelated_unique_constraint",
	})
	if !errors.Is(normalized, ErrPropertyWorkspaceConflict) {
		t.Fatalf("normalized error = %v, want ErrPropertyWorkspaceConflict", normalized)
	}
	if errors.Is(normalized, ErrPropertyLocationIdentityConflict) {
		t.Fatal("unrelated unique violation must not use the location identity contract")
	}
}

func sourceSection(t *testing.T, source string, startMarker string, endMarker string) string {
	t.Helper()
	start := strings.Index(source, startMarker)
	if start < 0 {
		t.Fatalf("missing source marker %q", startMarker)
	}
	endOffset := strings.Index(source[start:], endMarker)
	if endOffset < 0 {
		t.Fatalf("missing source marker %q", endMarker)
	}
	return source[start : start+endOffset]
}
