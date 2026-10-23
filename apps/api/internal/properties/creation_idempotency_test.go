package properties

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestPropertyCreationFingerprintStableAndExact(t *testing.T) {
	first := propertyRequest{"title": "Apartamento teste", "metadata": `{"b":2,"a":9007199254740993}`}
	second := propertyRequest{"metadata": `{"a":9007199254740993,"b":2}`, "title": "Apartamento teste"}
	a, err := propertyCreationFingerprint(first)
	if err != nil {
		t.Fatal(err)
	}
	b, err := propertyCreationFingerprint(second)
	if err != nil || a != b {
		t.Fatalf("equivalent payloads differ: %s %s %v", a, b, err)
	}
	second["metadata"] = `{"a":9007199254740992,"b":2}`
	b, err = propertyCreationFingerprint(second)
	if err != nil || a == b {
		t.Fatalf("different exact metadata numbers collided: %v", err)
	}
	second = propertyRequest{"title": "Outro imóvel", "metadata": first["metadata"]}
	b, _ = propertyCreationFingerprint(second)
	if a == b {
		t.Fatal("different body must conflict")
	}
}

func TestPropertyCreationRejectsClientLedgerAndScrubsResponses(t *testing.T) {
	_, err := sanitizePayload(propertyRequest{"metadata": map[string]any{propertyCreationLedgerKey: map[string]any{"key_hash": "forged"}}})
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("client ledger accepted: %v", err)
	}
	property := Property{"metadata": map[string]any{"public_setting": "keep", propertyCreationLedgerKey: map[string]string{"request_hash": "private"}}}
	scrubCreationLedger(property)
	metadata := property["metadata"].(map[string]any)
	if _, found := metadata[propertyCreationLedgerKey]; found || metadata["public_setting"] != "keep" {
		t.Fatalf("bad scrub: %#v", metadata)
	}
}

func TestPropertyCreationRejectsInvalidKeysBeforeDatabase(t *testing.T) {
	repo := Repository{}
	actor := tenant.Context{OrganizationID: "10000000-0000-4000-8000-000000000001", UserID: "20000000-0000-4000-8000-000000000001", MemberRole: "admin"}
	for _, key := range []string{" ", "not-a-uuid", "aaaaaaaa-aaaa-aaaa-aaaa-xxxxxxxxxxxx"} {
		_, _, err := repo.CreateIdempotent(context.Background(), actor, propertyRequest{}, key)
		if !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("key %q: %v", key, err)
		}
	}
	actor.MemberRole = "user"
	_, _, err := repo.CreateIdempotent(context.Background(), actor, propertyRequest{}, "30000000-0000-4000-8000-000000000001")
	if !errors.Is(err, tenant.ErrOrganizationAccessDenied) {
		t.Fatalf("non-manager: %v", err)
	}
}

func TestPropertyCreationReceiptNeverRecreatesRemovedResources(t *testing.T) {
	for _, test := range []struct {
		name, stored, requested, state string
		exists                         bool
		want                           error
	}{
		{name: "live replay", stored: "same", requested: "same", state: "created", exists: true},
		{name: "deleted tombstone", stored: "same", requested: "same", state: "removed", want: ErrPropertyCreationResourceRemoved},
		{name: "missing resource", stored: "same", requested: "same", state: "created", want: ErrPropertyCreationResourceRemoved},
		{name: "changed deleted body", stored: "first", requested: "second", state: "removed", want: ErrPropertyCreationKeyConflict},
	} {
		t.Run(test.name, func(t *testing.T) {
			err := validatePropertyCreationReplay(test.stored, test.requested, test.state, test.exists)
			if !errors.Is(err, test.want) {
				t.Fatalf("replay decision = %v; want %v", err, test.want)
			}
		})
	}
	for _, inconsistent := range []struct {
		state  string
		exists bool
	}{{"unknown", false}, {"removed", true}} {
		err := validatePropertyCreationReplay("same", "same", inconsistent.state, inconsistent.exists)
		if err == nil || errors.Is(err, ErrPropertyCreationResourceRemoved) {
			t.Fatalf("corrupt receipt was treated as proof of deletion: %v", err)
		}
	}
}

func TestPropertyCreationRemovedResourceRespondsWithExplicitGoneProof(t *testing.T) {
	response := httptest.NewRecorder()
	writePropertyError(response, httptest.NewRequest(http.MethodPost, "/v1/properties", nil), ErrPropertyCreationResourceRemoved)
	if response.Code != http.StatusGone || !strings.Contains(response.Body.String(), `"code":"property_creation_resource_removed"`) {
		t.Fatalf("removed create replay = %d %s", response.Code, response.Body.String())
	}
}
