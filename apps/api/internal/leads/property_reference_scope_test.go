package leads

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/propertyscope"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type propertyReferenceScopeTx struct {
	pgx.Tx
	queries []string
	args    [][]any
	exists  bool
}

func (tx *propertyReferenceScopeTx) QueryRow(_ context.Context, query string, args ...any) pgx.Row {
	tx.queries = append(tx.queries, query)
	tx.args = append(tx.args, args)
	return propertyReferenceScopeRow{exists: tx.exists}
}

type propertyReferenceScopeRow struct {
	exists bool
}

func (row propertyReferenceScopeRow) Scan(destinations ...any) error {
	if len(destinations) != 1 {
		return errors.New("unexpected property-reference scan")
	}
	destination, ok := destinations[0].(*bool)
	if !ok {
		return errors.New("unexpected property-reference destination")
	}
	*destination = row.exists
	return nil
}

func TestValidatePropertyUsesCanonicalViewerScopeAndTenantCapabilities(t *testing.T) {
	tx := &propertyReferenceScopeTx{exists: true}
	propertyID := "30000000-0000-4000-8000-000000000001"
	tenantContext := tenant.Context{
		OrganizationID: "10000000-0000-4000-8000-000000000001",
		UserID:         "20000000-0000-4000-8000-000000000001",
		MemberRole:     "user",
		Permissions:    []string{permissions.PropertyView},
		IsTeamLeader:   true,
	}

	if err := (Repository{}).validateProperty(context.Background(), tx, tenantContext, &propertyID); err != nil {
		t.Fatalf("validate visible property: %v", err)
	}
	if len(tx.queries) != 1 {
		t.Fatalf("property validation queries = %d, want 1", len(tx.queries))
	}
	canonical := propertyscope.VisibilitySQL("property", "$3", "$4", "$5")
	if !strings.Contains(tx.queries[0], canonical) {
		t.Fatalf("property validation does not use canonical scope: %s", tx.queries[0])
	}
	if len(tx.args[0]) != 5 || tx.args[0][0] != tenantContext.OrganizationID || tx.args[0][1] != propertyID || tx.args[0][2] != false || tx.args[0][3] != tenantContext.UserID || tx.args[0][4] != true {
		t.Fatalf("property validation args = %#v", tx.args[0])
	}
}

func TestValidatePropertyRejectsCallerWithoutPropertyAccessBeforeQuery(t *testing.T) {
	tx := &propertyReferenceScopeTx{exists: true}
	propertyID := "30000000-0000-4000-8000-000000000001"
	err := (Repository{}).validateProperty(context.Background(), tx, tenant.Context{
		OrganizationID: "10000000-0000-4000-8000-000000000001",
		UserID:         "20000000-0000-4000-8000-000000000001",
		Permissions:    []string{permissions.LeadOperate},
	}, &propertyID)
	if !errors.Is(err, ErrInvalidReference) {
		t.Fatalf("settings without property access error = %v, want ErrInvalidReference", err)
	}
	if len(tx.queries) != 0 {
		t.Fatalf("property lookup ran without property access: %#v", tx.queries)
	}
}

func TestUpdateAuthorizesPropertyBeforeReadingCommercialValues(t *testing.T) {
	raw, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatalf("read repository source: %v", err)
	}
	source := string(raw)
	start := strings.Index(source, "func (repo Repository) Update(")
	end := strings.Index(source, "func (repo Repository) dispatchDealStatusSideEffects")
	if start < 0 || end <= start {
		t.Fatal("could not isolate lead Update")
	}
	update := source[start:end]
	validation := strings.Index(update, "repo.validateUpdatePropertyReferences(ctx, tx, tenantContext, input)")
	commercialRead := strings.Index(update, "repo.applySelectedPropertyCommercialValues(ctx, tx, tenantContext, current, &input)")
	reservation := strings.Index(update, "repo.lockWonLeadPropertyForUpdate")
	leadMutation := strings.Index(update, "update public.leads")
	if validation < 0 || commercialRead <= validation || reservation <= commercialRead || leadMutation <= reservation {
		t.Fatalf("property authorization/read/reservation/mutation order is unsafe: validation=%d commercial=%d reservation=%d mutation=%d", validation, commercialRead, reservation, leadMutation)
	}
}
