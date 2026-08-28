package attention

import (
	"errors"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestManualResolutionRequiresExplicitAdministrativeOverride(t *testing.T) {
	note := "Exceção aprovada após auditoria operacional."
	request := ResolveRequest{
		Reason:                 "Exceção operacional",
		Note:                   &note,
		AdministrativeOverride: true,
	}

	regular := tenant.Context{UserID: "user-1", MemberRole: "user"}
	if _, err := normalizeAdministrativeOverride(regular, request); !errors.Is(err, ErrForbidden) {
		t.Fatalf("regular override error = %v", err)
	}

	admin := tenant.Context{UserID: "admin-1", MemberRole: "admin"}
	withoutFlag := request
	withoutFlag.AdministrativeOverride = false
	if _, err := normalizeAdministrativeOverride(admin, withoutFlag); !errors.Is(err, ErrForbidden) {
		t.Fatalf("implicit admin override error = %v", err)
	}

	withoutJustification := request
	withoutJustification.Note = nil
	if _, err := normalizeAdministrativeOverride(admin, withoutJustification); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("missing justification error = %v", err)
	}

	normalized, err := normalizeAdministrativeOverride(admin, request)
	if err != nil {
		t.Fatalf("valid administrative override: %v", err)
	}
	if normalized.Note == nil || *normalized.Note != note {
		t.Fatalf("normalized request = %#v", normalized)
	}
}
