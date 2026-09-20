package roundrobin

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const (
	testScopeOrganizationID = "11111111-1111-4111-8111-111111111111"
	testScopeQueueID        = "22222222-2222-4222-8222-222222222222"
	testScopeLeaderID       = "33333333-3333-4333-8333-333333333333"
	testScopeTeamID         = "44444444-4444-4444-8444-444444444444"
	testScopeUserID         = "55555555-5555-4555-8555-555555555555"
	testScopePipelineID     = "66666666-6666-4666-8666-666666666666"
	testOutsideTeamID       = "77777777-7777-4777-8777-777777777777"
	testOutsidePipelineID   = "88888888-8888-4888-8888-888888888888"
)

func TestCanManageRoundRobinsKeepsLeadersScoped(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		context    tenant.Context
		canOperate bool
		canManage  bool
	}{
		{
			name: "admin has organization-wide access",
			context: tenant.Context{
				MemberRole:   "admin",
				IsTeamLeader: true,
			},
			canOperate: true,
			canManage:  true,
		},
		{
			name: "non-leader with grant has organization-wide access",
			context: tenant.Context{
				MemberRole:  "user",
				Permissions: []string{permissions.DistributionManage},
			},
			canOperate: true,
			canManage:  true,
		},
		{
			name: "leader with grant can operate only in leadership scope",
			context: tenant.Context{
				MemberRole:   "user",
				Permissions:  []string{permissions.DistributionManage},
				IsTeamLeader: true,
			},
			canOperate: true,
			canManage:  false,
		},
		{
			name: "ordinary user cannot operate queues",
			context: tenant.Context{
				MemberRole: "user",
			},
			canOperate: false,
			canManage:  false,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			if got := canManageRoundRobinScope(test.context); got != test.canOperate {
				t.Fatalf("canManageRoundRobinScope() = %t, want %t", got, test.canOperate)
			}
			if got := canManageRoundRobins(test.context); got != test.canManage {
				t.Fatalf("canManageRoundRobins() = %t, want %t", got, test.canManage)
			}
		})
	}
}

func TestLeaderWithDistributionGrantCannotWriteOutsideLeadershipScope(t *testing.T) {
	t.Parallel()

	leader := tenant.Context{
		MemberRole:     "user",
		Permissions:    []string{permissions.DistributionManage},
		IsTeamLeader:   true,
		LedTeamIDs:     []string{testScopeTeamID},
		LedUserIDs:     []string{testScopeUserID},
		LedPipelineIDs: []string{testScopePipelineID},
	}
	member := memberInput{
		UserID: stringPointer(testScopeUserID),
		TeamID: stringPointer(testScopeTeamID),
		Type:   "user",
		Weight: 10,
	}

	if err := ensureRoundRobinInputInScope(
		leader,
		stringPointer(testScopePipelineID),
		[]memberInput{member},
		true,
		true,
	); err != nil {
		t.Fatalf("in-scope input rejected: %v", err)
	}

	if err := ensureRoundRobinInputInScope(
		leader,
		stringPointer(testOutsidePipelineID),
		[]memberInput{member},
		true,
		true,
	); !errors.Is(err, tenant.ErrOrganizationAccessDenied) {
		t.Fatalf("outside pipeline error = %v, want access denied", err)
	}

	outsideMember := member
	outsideMember.TeamID = stringPointer(testOutsideTeamID)
	if err := ensureRoundRobinInputInScope(
		leader,
		stringPointer(testScopePipelineID),
		[]memberInput{outsideMember},
		true,
		true,
	); !errors.Is(err, tenant.ErrOrganizationAccessDenied) {
		t.Fatalf("outside member error = %v, want access denied", err)
	}
}

func TestLeaderWithDistributionGrantCannotReadOutsideLeadershipScope(t *testing.T) {
	t.Parallel()

	leader := tenant.Context{
		UserID:         testScopeLeaderID,
		OrganizationID: testScopeOrganizationID,
		MemberRole:     "user",
		Permissions:    []string{permissions.DistributionManage},
		IsTeamLeader:   true,
		LedTeamIDs:     []string{testScopeTeamID},
		LedUserIDs:     []string{testScopeUserID},
		LedPipelineIDs: []string{testScopePipelineID},
	}
	queryer := &scopeQueryer{exists: false}

	err := (Repository{}).ensureRoundRobinVisible(
		context.Background(),
		queryer,
		leader,
		testScopeQueueID,
	)
	if !errors.Is(err, ErrRoundRobinNotFound) {
		t.Fatalf("outside queue error = %v, want not found", err)
	}

	for _, fragment := range []string{
		"rr.organization_id = $1::uuid",
		"rr.id = $2::uuid",
		"rr.deleted_at is null",
		"rr.created_by = $3::uuid",
		"rr.pipeline_id in ($4::uuid)",
		"scoped_rrm.team_id in ($5::uuid)",
		"scoped_rrm.user_id in ($6::uuid)",
	} {
		if !strings.Contains(queryer.query, fragment) {
			t.Errorf("scoped visibility query does not contain %q", fragment)
		}
	}
	wantArgs := []any{
		testScopeOrganizationID,
		testScopeQueueID,
		testScopeLeaderID,
		testScopePipelineID,
		testScopeTeamID,
		testScopeUserID,
	}
	if len(queryer.args) != len(wantArgs) {
		t.Fatalf("query args = %#v, want %#v", queryer.args, wantArgs)
	}
	for index := range wantArgs {
		if queryer.args[index] != wantArgs[index] {
			t.Errorf("query arg %d = %v, want %v", index, queryer.args[index], wantArgs[index])
		}
	}
}

func stringPointer(value string) *string {
	return &value
}

type scopeQueryer struct {
	exists bool
	query  string
	args   []any
}

func (queryer *scopeQueryer) QueryRow(_ context.Context, query string, args ...any) pgx.Row {
	queryer.query = query
	queryer.args = append([]any(nil), args...)
	return scopeRow{exists: queryer.exists}
}

func (*scopeQueryer) Query(context.Context, string, ...any) (pgx.Rows, error) {
	return nil, errors.New("unexpected Query call")
}

func (*scopeQueryer) Exec(context.Context, string, ...any) (pgconn.CommandTag, error) {
	return pgconn.CommandTag{}, errors.New("unexpected Exec call")
}

type scopeRow struct {
	exists bool
}

func (row scopeRow) Scan(dest ...any) error {
	if len(dest) != 1 {
		return errors.New("unexpected scan destination count")
	}
	value, ok := dest[0].(*bool)
	if !ok {
		return errors.New("unexpected scan destination type")
	}
	*value = row.exists
	return nil
}
