package leads

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type contactPropertyTestTx struct {
	contactPageTestTx
	pageQuery string
	pageArgs  []any
}

func (tx *contactPropertyTestTx) Query(_ context.Context, query string, args ...any) (pgx.Rows, error) {
	tx.pageQuery, tx.pageArgs = query, args
	return contactPageEmptyRows{}, nil
}

func TestContactsPropertyProjectionUsesCanonicalScopeInBothModesAndTenants(t *testing.T) {
	for _, organizationID := range []string{importDistributionOrganizationID, "99999999-9999-4999-8999-999999999999"} {
		viewer := tenant.Context{OrganizationID: organizationID, UserID: importDistributionActorID, Permissions: []string{permissions.LeadViewOwn, permissions.LeadExport}}
		for _, mode := range []string{"compact", "full"} {
			tx := &contactPropertyTestTx{contactPageTestTx: contactPageTestTx{version: strings.Repeat("a", 64)}}
			filter := ContactListFilter{Mode: mode, Page: 1, Limit: 500}
			if _, err := (Repository{}).readContactsPageInSnapshot(context.Background(), tx, viewer, filter); err != nil {
				t.Fatal(err)
			}
			for _, column := range []string{"property_id", "interest_property_id"} {
				if !strings.Contains(tx.pageQuery, "visible_property.id = l."+column) || strings.Contains(tx.pageQuery, "\n\t\t\tl."+column+"::text,") {
					t.Fatalf("%s selects unprojected property reference %s", mode, column)
				}
			}
			if tx.pageArgs[0] != organizationID || !reflect.DeepEqual(tx.pageArgs[4:7], []any{false, nil, false}) {
				t.Fatalf("no-property-read scope was not denied: %#v", tx.pageArgs)
			}
			if !strings.Contains(tx.pageQuery, "visible_property.organization_id = l.organization_id") {
				t.Fatal("property projection crossed tenants")
			}
			if mode == "full" && (!strings.Contains(tx.pageQuery, "jsonb_array_elements_text(l.metadata->'interestPropertyIds')") || !strings.Contains(tx.query, "'visible_property_metadata'")) {
				t.Fatal("raw/expanded metadata or its version bypassed property projection")
			}
		}
	}
}

func TestContactsExportVersionBindsPropertyPermissionsAndVisibleReferences(t *testing.T) {
	viewer := tenant.Context{OrganizationID: importDistributionOrganizationID, UserID: importDistributionActorID, Permissions: []string{permissions.LeadViewOwn, permissions.LeadExport}}
	filter := ContactListFilter{Mode: "full", Page: 1, Limit: 500}
	first, err := (Repository{}).readContactsPageInSnapshot(context.Background(), &contactPageTestTx{version: strings.Repeat("a", 64)}, viewer, filter)
	if err != nil {
		t.Fatal(err)
	}
	viewer.Permissions = append(viewer.Permissions, permissions.PropertyView)
	filter.ExpectedExportVersion = first.ExportVersion
	if _, err := (Repository{}).readContactsPageInSnapshot(context.Background(), &contactPageTestTx{version: strings.Repeat("a", 64)}, viewer, filter); !errors.Is(err, ErrContactsExportChanged) {
		t.Fatalf("property scope changed but export version stayed valid: %v", err)
	}
	query := contactExportSetQuery([]string{"l.organization_id=$1::uuid"}, "PROPERTY_SCOPE_MARKER")
	for _, expected := range []string{"'visible_property_id'", "'visible_interest_property_id'", "'visible_property_metadata'", "PROPERTY_SCOPE_MARKER", "visible_property.organization_id = l.organization_id"} {
		if !strings.Contains(query, expected) {
			t.Fatalf("fingerprint omitted %q", expected)
		}
	}
}
