package schedule

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

type schedulePropertyScopeQueryer struct {
	queries []string
	args    [][]any
	exists  bool
}

func (queryer *schedulePropertyScopeQueryer) QueryRow(_ context.Context, query string, args ...any) pgx.Row {
	queryer.queries = append(queryer.queries, query)
	queryer.args = append(queryer.args, args)
	return schedulePropertyScopeRow{exists: queryer.exists}
}

type schedulePropertyScopeRow struct {
	exists bool
}

func (row schedulePropertyScopeRow) Scan(destinations ...any) error {
	if len(destinations) != 1 {
		return errors.New("unexpected schedule property-scope scan")
	}
	destination, ok := destinations[0].(*bool)
	if !ok {
		return errors.New("unexpected schedule property-scope destination")
	}
	*destination = row.exists
	return nil
}

func TestValidateSchedulePropertyUsesCanonicalOwnTeamAllScope(t *testing.T) {
	queryer := &schedulePropertyScopeQueryer{exists: true}
	propertyID := "30000000-0000-4000-8000-000000000001"
	tenantContext := tenant.Context{
		OrganizationID: "10000000-0000-4000-8000-000000000001",
		UserID:         "20000000-0000-4000-8000-000000000001",
		MemberRole:     "user",
		Permissions:    []string{permissions.PropertyView},
		IsTeamLeader:   true,
	}

	if err := (Repository{}).validateProperty(context.Background(), queryer, tenantContext, &propertyID); err != nil {
		t.Fatalf("validate visible schedule property: %v", err)
	}
	if len(queryer.queries) != 1 {
		t.Fatalf("property validation queries = %d, want 1", len(queryer.queries))
	}
	canonical := propertyscope.VisibilitySQL("p", "$3", "$4", "$5")
	if !strings.Contains(queryer.queries[0], canonical) {
		t.Fatalf("property validation does not use canonical scope: %s", queryer.queries[0])
	}
	wantArgs := []any{tenantContext.OrganizationID, propertyID, false, tenantContext.UserID, true}
	if len(queryer.args[0]) != len(wantArgs) {
		t.Fatalf("property validation args = %#v, want %#v", queryer.args[0], wantArgs)
	}
	for index := range wantArgs {
		if queryer.args[0][index] != wantArgs[index] {
			t.Fatalf("property validation arg %d = %#v, want %#v", index, queryer.args[0][index], wantArgs[index])
		}
	}
}

func TestValidateSchedulePropertyRejectsMissingScopeOrInvisibleReference(t *testing.T) {
	propertyID := "30000000-0000-4000-8000-000000000001"

	withoutPermission := &schedulePropertyScopeQueryer{exists: true}
	err := (Repository{}).validateProperty(context.Background(), withoutPermission, tenant.Context{
		OrganizationID: "10000000-0000-4000-8000-000000000001",
		UserID:         "20000000-0000-4000-8000-000000000001",
	}, &propertyID)
	if !errors.Is(err, tenant.ErrOrganizationAccessDenied) {
		t.Fatalf("property validation without property access error = %v, want access denied", err)
	}
	if len(withoutPermission.queries) != 0 {
		t.Fatalf("property lookup ran without property access: %#v", withoutPermission.queries)
	}

	invisible := &schedulePropertyScopeQueryer{exists: false}
	err = (Repository{}).validateProperty(context.Background(), invisible, tenant.Context{
		OrganizationID: "10000000-0000-4000-8000-000000000001",
		UserID:         "20000000-0000-4000-8000-000000000001",
		Permissions:    []string{permissions.PropertyView},
	}, &propertyID)
	if !errors.Is(err, ErrInvalidReference) {
		t.Fatalf("invisible property validation error = %v, want ErrInvalidReference", err)
	}
}

func TestSchedulePropertyProjectionRedactsIDAndReferenceOutsideCanonicalScope(t *testing.T) {
	query := scheduleEventsQuery("true")
	canonical := propertyscope.VisibilitySQL("p", "$8", "$9", "$10")
	for _, required := range []string{
		"case when v.is_masked or p.id is null then null else v.property_id::text end",
		"p.organization_id = v.organization_id",
		"and $7::boolean",
		canonical,
	} {
		if !strings.Contains(query, required) {
			t.Fatalf("schedule property projection is missing %q: %s", required, query)
		}
	}
}

func TestScheduleCreateAndPatchValidatePropertyBeforeMutation(t *testing.T) {
	raw, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatalf("read schedule repository source: %v", err)
	}
	source := string(raw)

	createStart := strings.Index(source, "func (repo Repository) Create(")
	updateStart := strings.Index(source, "func (repo Repository) Update(")
	if createStart < 0 || updateStart <= createStart {
		t.Fatal("could not isolate schedule Create")
	}
	create := source[createStart:updateStart]
	createValidation := strings.Index(create, "repo.validateProperty(ctx, tx, tenantContext, input.PropertyID)")
	createMutation := strings.Index(create, "insert into public.schedule_events")
	if createValidation < 0 || createMutation <= createValidation {
		t.Fatalf("Create property validation/mutation order is unsafe: validation=%d mutation=%d", createValidation, createMutation)
	}

	updateEnd := strings.Index(source[updateStart:], "func (repo Repository) recordScheduleGamification")
	if updateEnd < 0 {
		t.Fatal("could not isolate schedule Update")
	}
	update := source[updateStart : updateStart+updateEnd]
	updateValidation := strings.Index(update, "repo.validateProperty(ctx, tx, tenantContext, input.PropertyID.Value)")
	updateMutation := strings.Index(update, "update public.schedule_events")
	if updateValidation < 0 || updateMutation <= updateValidation {
		t.Fatalf("Update property validation/mutation order is unsafe: validation=%d mutation=%d", updateValidation, updateMutation)
	}
}

func TestValidateScheduleTeamRequiresActiveTeamInOrganization(t *testing.T) {
	queryer := &schedulePropertyScopeQueryer{exists: true}
	teamID := "30000000-0000-4000-8000-000000000001"
	organizationID := "10000000-0000-4000-8000-000000000001"

	if err := (Repository{}).validateTeam(context.Background(), queryer, organizationID, &teamID); err != nil {
		t.Fatalf("validate active schedule team: %v", err)
	}
	if len(queryer.queries) != 1 || !strings.Contains(queryer.queries[0], "t.organization_id = $1::uuid") || !strings.Contains(queryer.queries[0], "coalesce(t.is_active, true) = true") {
		t.Fatalf("team validation is not tenant/active scoped: %#v", queryer.queries)
	}
	if len(queryer.args[0]) != 2 || queryer.args[0][0] != organizationID || queryer.args[0][1] != teamID {
		t.Fatalf("team validation args = %#v", queryer.args[0])
	}
}
