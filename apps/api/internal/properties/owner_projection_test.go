package properties

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestInlineOwnerMutationUsesAllContactFields(t *testing.T) {
	owner := OwnerInput{
		Name:             "Antes",
		PhoneResidential: "1111",
		NotifyEmail:      true,
	}
	applyInlineOwnerMutation(&owner, propertyRequest{
		"owner_name":              "Maria",
		"owner_phone_residential": nil,
		"owner_phone_commercial":  "2222",
		"owner_cellphone":         "3333",
		"owner_email":             "maria@example.com",
		"origin_media":            "Indicacao",
		"owner_notify_email":      false,
	})

	if owner.Name != "Maria" || owner.PhoneResidential != "" || owner.PhoneCommercial != "2222" ||
		owner.Cellphone != "3333" || owner.Email != "maria@example.com" ||
		owner.MediaSource != "Indicacao" || owner.NotifyEmail {
		t.Fatalf("inline owner mutation = %#v", owner)
	}
	if !hasPropertyOwnerContact(owner) {
		t.Fatal("owner with a contact must be recognized")
	}
}

func TestInlineOwnerIdentityRequiresExactDetails(t *testing.T) {
	base := OwnerInput{
		Name:             "Maria Silva",
		PhoneResidential: "1111",
		Cellphone:        "9999",
		Email:            "maria@example.com",
		NotifyEmail:      true,
	}
	same := base
	same.Name = " maria silva "
	same.Email = "MARIA@example.com"
	if !sameInlineOwner(base, same) {
		t.Fatal("case-only name/email differences should be the same identity")
	}
	different := base
	different.PhoneResidential = "2222"
	if sameInlineOwner(base, different) {
		t.Fatal("a different contact detail must not be silently reused")
	}
}

func TestNormalizedOwnerCannotBeEditedThroughUnboundInlineFields(t *testing.T) {
	_, _, err := resolvePropertyOwnerForMutation(
		context.Background(),
		nil,
		tenant.Context{},
		propertyRequest{"owner_name": "Outro nome"},
		&propertySnapshot{OwnerID: "00000000-0000-0000-0000-000000000001"},
	)
	if !errors.Is(err, ErrPropertyOwnerIdentityConflict) {
		t.Fatalf("error = %v, want ErrPropertyOwnerIdentityConflict", err)
	}
}

func TestUnchangedSelectedOwnerDoesNotRewriteOwnershipLedger(t *testing.T) {
	current := propertySnapshot{
		OwnerID:          "00000000-0000-0000-0000-000000000001",
		OwnerName:        "Maria Silva",
		OwnerCellphone:   "11999990000",
		OwnerEmail:       "maria@example.com",
		OwnerMediaSource: "Indicacao",
		OwnerNotifyEmail: true,
	}
	ownerID, changed, err := resolvePropertyOwnerForMutation(
		context.Background(),
		nil,
		tenant.Context{},
		propertyRequest{
			"owner_id":                current.OwnerID,
			"owner_name":              current.OwnerName,
			"owner_phone_residential": "",
			"owner_phone_commercial":  "",
			"owner_cellphone":         current.OwnerCellphone,
			"owner_email":             current.OwnerEmail,
			"origin_media":            current.OwnerMediaSource,
			"owner_notify_email":      current.OwnerNotifyEmail,
		},
		&current,
	)
	if err != nil || changed || ownerID != current.OwnerID {
		t.Fatalf("ownerID = %q, changed = %v, error = %v; want unchanged projection", ownerID, changed, err)
	}
}

func TestSelectedOwnerRejectsInlineContactDrift(t *testing.T) {
	current := propertySnapshot{
		OwnerID:        "00000000-0000-0000-0000-000000000001",
		OwnerName:      "Maria Silva",
		OwnerCellphone: "11999990000",
	}
	_, _, err := resolvePropertyOwnerForMutation(
		context.Background(),
		nil,
		tenant.Context{},
		propertyRequest{
			"owner_id":        current.OwnerID,
			"owner_name":      current.OwnerName,
			"owner_cellphone": "11988880000",
		},
		&current,
	)
	if !errors.Is(err, ErrPropertyOwnerIdentityConflict) {
		t.Fatalf("error = %v, want ErrPropertyOwnerIdentityConflict", err)
	}
}

func TestPropertyOwnerFilterIncludesActiveNormalizedOwnerships(t *testing.T) {
	clause := propertyOwnerFilterClause()
	for _, fragment := range []string{
		"p.owner_id = $%[1]d::uuid",
		"from public.property_ownerships",
		"filtered_ownership.owner_id = $%[1]d::uuid",
		"filtered_ownership.valid_from <= current_date",
		"current_date < filtered_ownership.valid_to",
	} {
		if !strings.Contains(clause, fragment) {
			t.Fatalf("owner filter is missing %q: %s", fragment, clause)
		}
	}
}
