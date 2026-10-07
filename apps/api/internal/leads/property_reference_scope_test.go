package leads

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
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

type reopenPropertyStatusTx struct {
	pgx.Tx
	status  string
	missing bool
	queries []string
	args    [][]any
}

func (tx *reopenPropertyStatusTx) QueryRow(_ context.Context, query string, args ...any) pgx.Row {
	tx.queries = append(tx.queries, query)
	tx.args = append(tx.args, args)
	if strings.Contains(query, "to_regclass('public.events')") {
		return propertyReferenceScopeRow{exists: false}
	}
	return reopenPropertyStatusRow{status: tx.status, missing: tx.missing}
}

type reopenPropertyStatusRow struct {
	status  string
	missing bool
}

func (row reopenPropertyStatusRow) Scan(destinations ...any) error {
	if row.missing {
		return pgx.ErrNoRows
	}
	if len(destinations) != 6 {
		return errors.New("unexpected reopen property scan")
	}
	status, ok := destinations[2].(*string)
	if !ok {
		return errors.New("unexpected reopen property destination")
	}
	*destinations[0].(*string) = "Imovel"
	*destinations[1].(*string) = "TEST"
	*status = row.status
	*destinations[3].(*string) = ""
	*destinations[4].(*pgtype.Bool) = pgtype.Bool{Bool: false, Valid: true}
	*destinations[5].(*pgtype.Bool) = pgtype.Bool{Bool: false, Valid: true}
	return nil
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

func TestUnchangedLeadPropertyDoesNotRequireNewPropertyAccess(t *testing.T) {
	propertyID := "30000000-0000-4000-8000-000000000001"
	tenantContext := tenant.Context{
		OrganizationID: "10000000-0000-4000-8000-000000000001",
		UserID:         "20000000-0000-4000-8000-000000000001",
		Permissions:    []string{permissions.LeadOperate},
	}
	input := updateInput{PropertyID: patchString{Set: true, Value: &propertyID}}
	current := leadSnapshot{PropertyID: propertyID}

	tx := &propertyReferenceScopeTx{exists: true}
	if err := (Repository{}).validateUpdatePropertyReferences(context.Background(), tx, tenantContext, current, input); err != nil {
		t.Fatalf("unchanged property link rejected: %v", err)
	}
	if len(tx.queries) != 1 || strings.Contains(tx.queries[0], propertyscope.VisibilitySQL("property", "$3", "$4", "$5")) {
		t.Fatalf("unchanged property should check only tenant existence, queries: %#v", tx.queries)
	}

	missing := &propertyReferenceScopeTx{exists: false}
	if err := (Repository{}).validateUpdatePropertyReferences(context.Background(), missing, tenantContext, current, input); !errors.Is(err, ErrInvalidReference) {
		t.Fatalf("missing unchanged property error = %v, want ErrInvalidReference", err)
	}

	newLink := &propertyReferenceScopeTx{exists: true}
	if err := (Repository{}).validateUpdatePropertyReferences(context.Background(), newLink, tenantContext, leadSnapshot{}, input); !errors.Is(err, ErrInvalidReference) {
		t.Fatalf("new hidden property link error = %v, want ErrInvalidReference", err)
	}
	if len(newLink.queries) != 0 {
		t.Fatalf("new hidden property was queried without property access: %#v", newLink.queries)
	}
}

func TestWonLeadRejectsPropertyRelinkEvenDuringReopen(t *testing.T) {
	linked := "30000000-0000-4000-8000-000000000001"
	other := "30000000-0000-4000-8000-000000000002"
	current := leadSnapshot{PropertyID: linked, DealStatus: "won"}
	if leadPropertyLinkChanged(current, updateInput{PropertyID: patchString{Set: true, Value: &linked}}) {
		t.Fatal("unchanged link was classified as a relink")
	}
	if !leadPropertyLinkChanged(current, updateInput{PropertyID: patchString{Set: true, Value: &other}}) {
		t.Fatal("changing a won lead's property must be rejected")
	}
	if !leadPropertyLinkChanged(current, updateInput{PropertyID: patchString{Set: true}}) {
		t.Fatal("clearing a won lead's property must be rejected")
	}
}

func TestReopeningLeadLeavesUnchangedHiddenPropertyAlone(t *testing.T) {
	propertyID := "30000000-0000-4000-8000-000000000001"
	organizationID := "10000000-0000-4000-8000-000000000001"
	open := "open"
	current := leadSnapshot{DealStatus: "lost", InterestPropertyID: propertyID}
	input := updateInput{DealStatus: patchString{Set: true, Value: &open}}
	actor := tenant.Context{OrganizationID: organizationID, Permissions: []string{permissions.LeadOperate}}

	for _, status := range []string{"active", "inactive"} {
		t.Run(status, func(t *testing.T) {
			tx := &reopenPropertyStatusTx{status: status}
			if err := (Repository{}).releaseReopenedLeadProperty(context.Background(), tx, actor, current, input); err != nil {
				t.Fatalf("reopen with unchanged hidden property: %v", err)
			}
			if len(tx.queries) != 1 || len(tx.args[0]) != 3 || tx.args[0][0] != organizationID || tx.args[0][1] != propertyID || tx.args[0][2] != activeWonLeadReservationEventIDKey {
				t.Fatalf("reopen queried outside linked tenant property: queries=%#v args=%#v", tx.queries, tx.args)
			}
		})
	}

	reserved := &reopenPropertyStatusTx{status: "reserved"}
	if err := (Repository{}).releaseReopenedLeadProperty(context.Background(), reserved, actor, current, input); err != nil {
		t.Fatalf("reserved property without this lost lead's reservation must remain untouched: %v", err)
	}
	wonCurrent := current
	wonCurrent.DealStatus = "won"
	if err := (Repository{}).releaseReopenedLeadProperty(context.Background(), &reopenPropertyStatusTx{status: "reserved"}, actor, wonCurrent, input); !errors.Is(err, ErrLeadReservationUnverified) {
		t.Fatalf("unproven won reservation error = %v, want explicit conflict", err)
	}
	missing := &reopenPropertyStatusTx{missing: true}
	if err := (Repository{}).releaseReopenedLeadProperty(context.Background(), missing, actor, current, input); !errors.Is(err, ErrInvalidReference) {
		t.Fatalf("missing tenant property error = %v, want ErrInvalidReference", err)
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
	validation := strings.Index(update, "repo.validateUpdatePropertyReferences(ctx, tx, tenantContext, current, input)")
	commercialRead := strings.Index(update, "repo.applySelectedPropertyCommercialValues(ctx, tx, tenantContext, current, &input)")
	reservation := strings.Index(update, "repo.lockWonLeadPropertyForUpdate")
	leadMutation := strings.Index(update, "update public.leads")
	if validation < 0 || commercialRead <= validation || reservation <= commercialRead || leadMutation <= reservation {
		t.Fatalf("property authorization/read/reservation/mutation order is unsafe: validation=%d commercial=%d reservation=%d mutation=%d", validation, commercialRead, reservation, leadMutation)
	}
}
