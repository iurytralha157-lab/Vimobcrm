package portals

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestChavesNaMaoRepositoryFailsClosedWithoutHomologationGate(t *testing.T) {
	repo := NewRepository(nil)
	tenantContext := tenant.Context{MemberRole: "admin"}
	checks := []struct {
		name string
		run  func() error
	}{
		{"get", func() error { _, err := repo.GetChavesNaMao(t.Context(), tenantContext); return err }},
		{"save", func() error {
			_, err := repo.SaveChavesNaMao(t.Context(), tenantContext, ChavesNaMaoSettingsRequest{})
			return err
		}},
		{"activate", func() error { _, err := repo.ActivateChavesNaMao(t.Context(), tenantContext); return err }},
		{"pause", func() error { _, err := repo.PauseChavesNaMao(t.Context(), tenantContext); return err }},
		{"regenerate feed token", func() error { _, err := repo.RegenerateChavesNaMaoFeedToken(t.Context(), tenantContext); return err }},
		{"list publications", func() error { _, err := repo.ListChavesNaMaoPublications(t.Context(), tenantContext); return err }},
		{"upsert publications", func() error {
			_, err := repo.UpsertChavesNaMaoPublications(t.Context(), tenantContext, UpsertPublicationsRequest{})
			return err
		}},
		{"public feed", func() error { _, err := repo.BuildChavesNaMaoFeed(t.Context(), "token"); return err }},
	}
	for _, check := range checks {
		t.Run(check.name, func(t *testing.T) {
			if err := check.run(); !errors.Is(err, ErrChavesNaMaoHomologation) {
				t.Fatalf("expected homologation gate, got %v", err)
			}
		})
	}
}

func TestChavesNaMaoHomologationGateRequiresExplicitEnable(t *testing.T) {
	if err := NewRepository(nil, Config{ChavesNaMaoEnabled: true}).requireChavesNaMaoHomologation(); err != nil {
		t.Fatalf("explicitly enabled gate should pass: %v", err)
	}
	if err := NewRepository(nil, Config{}).requireChavesNaMaoHomologation(); !errors.Is(err, ErrChavesNaMaoHomologation) {
		t.Fatalf("default gate should fail closed: %v", err)
	}
}

func TestChavesNaMaoHomologationGateReturnsServiceUnavailable(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/v1/public/integrations/portals/chaves-na-mao/feed/token", nil)
	response := httptest.NewRecorder()
	writePortalError(response, request, ErrChavesNaMaoHomologation)
	if response.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusServiceUnavailable)
	}
	if body := response.Body.String(); !containsAll(body, "chaves_na_mao_homologation_required") {
		t.Fatalf("unexpected response body: %s", body)
	}
}

func containsAll(value string, parts ...string) bool {
	for _, part := range parts {
		if !stringsContains(value, part) {
			return false
		}
	}
	return true
}

func stringsContains(value string, part string) bool {
	for index := 0; index+len(part) <= len(value); index++ {
		if value[index:index+len(part)] == part {
			return true
		}
	}
	return false
}
