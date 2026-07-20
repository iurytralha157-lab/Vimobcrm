package leads

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"
)

type teamAssignmentQueryer struct {
	member  bool
	queries int
}

func (queryer *teamAssignmentQueryer) QueryRow(context.Context, string, ...any) pgx.Row {
	queryer.queries++
	return boolRow{value: queryer.member}
}

type boolRow struct {
	value bool
	err   error
}

func (row boolRow) Scan(dest ...any) error {
	if row.err != nil {
		return row.err
	}
	*(dest[0].(*bool)) = row.value
	return nil
}

func TestValidateRoundRobinAssigneeTeamSkipsPersonalLead(t *testing.T) {
	queryer := &teamAssignmentQueryer{}
	assignedUserID := "22222222-2222-4222-8222-222222222222"

	err := (Repository{}).validateRoundRobinAssigneeTeam(context.Background(), queryer, "11111111-1111-4111-8111-111111111111", "", &assignedUserID)
	if err != nil {
		t.Fatalf("validate personal lead: %v", err)
	}
	if queryer.queries != 0 {
		t.Fatalf("queries = %d, want 0", queryer.queries)
	}
}

func TestValidateRoundRobinAssigneeTeamAllowsUnassign(t *testing.T) {
	queryer := &teamAssignmentQueryer{}

	err := (Repository{}).validateRoundRobinAssigneeTeam(context.Background(), queryer, "11111111-1111-4111-8111-111111111111", "33333333-3333-4333-8333-333333333333", nil)
	if err != nil {
		t.Fatalf("validate unassign: %v", err)
	}
	if queryer.queries != 0 {
		t.Fatalf("queries = %d, want 0", queryer.queries)
	}
}

func TestValidateRoundRobinAssigneeTeamAllowsActiveMember(t *testing.T) {
	queryer := &teamAssignmentQueryer{member: true}
	assignedUserID := "22222222-2222-4222-8222-222222222222"

	err := (Repository{}).validateRoundRobinAssigneeTeam(context.Background(), queryer, "11111111-1111-4111-8111-111111111111", "33333333-3333-4333-8333-333333333333", &assignedUserID)
	if err != nil {
		t.Fatalf("validate active member: %v", err)
	}
}

func TestValidateRoundRobinAssigneeTeamRejectsNonMember(t *testing.T) {
	queryer := &teamAssignmentQueryer{member: false}
	assignedUserID := "22222222-2222-4222-8222-222222222222"

	err := (Repository{}).validateRoundRobinAssigneeTeam(context.Background(), queryer, "11111111-1111-4111-8111-111111111111", "33333333-3333-4333-8333-333333333333", &assignedUserID)
	if !errors.Is(err, ErrInvalidReference) {
		t.Fatalf("error = %v, want ErrInvalidReference", err)
	}
}
