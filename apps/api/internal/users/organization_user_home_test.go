package users

import (
	"encoding/json"
	"fmt"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
)

type organizationUserFixtureRow struct {
	membership string
	home       string
	withHome   bool
}

func (row organizationUserFixtureRow) Scan(dest ...any) error {
	want := 10
	if row.withHome {
		want++
	}
	if len(dest) != want {
		return fmt.Errorf("scanner destinations = %d, want %d", len(dest), want)
	}
	*dest[0].(*string) = "30000000-0000-4000-8000-000000000003"
	if err := dest[1].(*pgtype.UUID).Scan(row.membership); err != nil {
		return err
	}
	*dest[2].(*string) = "Synthetic member"
	*dest[3].(*string) = "member@example.test"
	*dest[4].(*string) = "user"
	*dest[6].(*bool) = true
	*dest[8].(*string) = "2026-10-12T00:00:00Z"
	*dest[9].(*string) = "2026-10-12T00:00:00Z"
	if row.withHome && row.home != "" {
		return dest[10].(*pgtype.UUID).Scan(row.home)
	}
	return nil
}

func TestOrganizationUserHomeProjection(t *testing.T) {
	const organizationA = "10000000-0000-4000-8000-000000000001"
	const organizationB = "20000000-0000-4000-8000-000000000002"
	for _, home := range []string{organizationA, organizationB, ""} {
		t.Run("home_"+home, func(t *testing.T) {
			user, err := scanOrganizationUser(organizationUserFixtureRow{membership: organizationB, home: home, withHome: true})
			if err != nil {
				t.Fatal(err)
			}
			if user.OrganizationID == nil || *user.OrganizationID != organizationB {
				t.Fatal("the CRM catalogue changed the membership organization")
			}
			if home == "" {
				if user.HomeOrganizationID != nil {
					t.Fatal("an unknown original organization must not inherit the membership")
				}
			} else if user.HomeOrganizationID == nil || *user.HomeOrganizationID != home {
				t.Fatal("the original organization was replaced by the active membership")
			}
			encoded, err := json.Marshal(user)
			if err != nil {
				t.Fatal(err)
			}
			var public map[string]any
			if err := json.Unmarshal(encoded, &public); err != nil {
				t.Fatal(err)
			}
			if home != "" && public["home_organization_id"] != home {
				t.Fatal("the authorized public catalogue omitted its home organization")
			}
		})
	}
}

func TestOtherUserProjectionsRemainCompatible(t *testing.T) {
	user, err := scanUser(organizationUserFixtureRow{membership: "20000000-0000-4000-8000-000000000002"})
	if err != nil {
		t.Fatal(err)
	}
	if user.HomeOrganizationID != nil {
		t.Fatal("other user endpoints must not invent a home organization")
	}
}
