package integrations

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

func TestIsMetaFormRouteConflictOnlyMatchesTheProviderRouteIndex(t *testing.T) {
	t.Run("matches the active provider route index", func(t *testing.T) {
		err := &pgconn.PgError{
			Code:           "23505",
			ConstraintName: "uq_meta_form_configs_active_provider_route",
		}
		if !isMetaFormRouteConflict(err) {
			t.Fatal("expected the Meta Form provider route conflict to be recognized")
		}
	})

	t.Run("does not relabel another tenant constraint", func(t *testing.T) {
		err := &pgconn.PgError{
			Code:           "23505",
			ConstraintName: "meta_form_configs_org_form_unique",
		}
		if isMetaFormRouteConflict(err) {
			t.Fatal("an unrelated unique violation must keep its original error path")
		}
	})

	t.Run("does not relabel wrapped non-Postgres errors", func(t *testing.T) {
		if isMetaFormRouteConflict(errors.New("unavailable")) {
			t.Fatal("a non-Postgres error must not be classified as a route conflict")
		}
	})
}

func TestMetaFormWritesMapTheCrossTenantRouteConstraint(t *testing.T) {
	source, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatal(err)
	}
	text := string(source)
	saveStart := strings.Index(text, "func (repo Repository) SaveMetaFormConfig")
	toggleStart := strings.Index(text, "func (repo Repository) ToggleMetaFormConfig")
	deleteStart := strings.Index(text, "func (repo Repository) DeleteMetaFormConfig")
	if saveStart < 0 || toggleStart <= saveStart || deleteStart <= toggleStart {
		t.Fatal("Meta Form write functions were not found in the expected order")
	}
	for name, section := range map[string]string{
		"save":   text[saveStart:toggleStart],
		"toggle": text[toggleStart:deleteStart],
	} {
		if !strings.Contains(section, "isMetaFormRouteConflict(err)") ||
			!strings.Contains(section, "ErrMetaFormRouteConflict") {
			t.Fatalf("%s must map the provider route unique violation", name)
		}
	}
}

func TestMetaFormRouteConflictReturnsASanitizedConflict(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "/api/integrations/meta/forms", nil)
	response := httptest.NewRecorder()

	writeIntegrationError(response, request, ErrMetaFormRouteConflict)

	if response.Code != http.StatusConflict {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusConflict)
	}
	var envelope struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	if envelope.Error.Code != "meta_form_route_conflict" {
		t.Fatalf("error code = %q", envelope.Error.Code)
	}
	for _, forbidden := range []string{"organization_id", "integration_id", "constraint", "23505"} {
		if strings.Contains(strings.ToLower(response.Body.String()), forbidden) {
			t.Fatalf("cross-tenant conflict response leaked %q: %s", forbidden, response.Body.String())
		}
	}
}
