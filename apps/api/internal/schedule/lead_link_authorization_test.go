package schedule

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/authorization"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type scheduleLeadAuthorizationRow struct {
	values []any
	err    error
}

func (row scheduleLeadAuthorizationRow) Scan(dest ...any) error {
	if row.err != nil {
		return row.err
	}
	if len(dest) != len(row.values) {
		return fmt.Errorf("unexpected scan width: %d", len(dest))
	}
	for index, value := range row.values {
		switch target := dest[index].(type) {
		case *string:
			*target = value.(string)
		case *bool:
			*target = value.(bool)
		case **bool:
			*target = value.(*bool)
		default:
			return fmt.Errorf("unexpected scan type: %T", target)
		}
	}
	return nil
}

// Models rows only: validateLead, its lock/pool guards and the authorization
// implementation remain real. No database, credentials or service is used.
type scheduleLeadAuthorizationRows struct {
	actor        tenant.Context
	organization string
	leadID       string
	resource     authorization.LeadResource
	poolAccess   *bool
	locked       bool
	readError    error
	queries      int
}

func (rows *scheduleLeadAuthorizationRows) QueryRow(_ context.Context, query string, args ...any) pgx.Row {
	rows.queries++
	if len(args) < 2 || args[0] != rows.actor.OrganizationID || args[1] != rows.leadID {
		return scheduleLeadAuthorizationRow{err: errors.New("lead query lacks captured tenant and lead")}
	}
	if rows.actor.OrganizationID != rows.organization || rows.locked {
		return scheduleLeadAuthorizationRow{err: pgx.ErrNoRows}
	}
	switch rows.queries {
	case 1:
		if !strings.Contains(query, "for share of l skip locked") {
			return scheduleLeadAuthorizationRow{err: errors.New("lead must be locked before checking the pool")}
		}
		return scheduleLeadAuthorizationRow{values: []any{rows.leadID}}
	case 2:
		if !strings.Contains(query, "private.queue_pool_read_access") || len(args) != 3 || args[2] != rows.actor.UserID {
			return scheduleLeadAuthorizationRow{err: errors.New("pool must be checked under the captured actor")}
		}
		return scheduleLeadAuthorizationRow{values: []any{rows.poolAccess}}
	case 3:
		if rows.readError != nil {
			return scheduleLeadAuthorizationRow{err: rows.readError}
		}
		if !strings.Contains(query, "l.organization_id = $1::uuid") || !strings.Contains(query, "l.id = $2::uuid") {
			return scheduleLeadAuthorizationRow{err: errors.New("resource snapshot must retain tenant and lead predicates")}
		}
		if strings.Contains(query, "select exists") {
			// Old implementation only checked visibility; the negative tests
			// below must fail against that implementation.
			return scheduleLeadAuthorizationRow{values: []any{authorization.CanViewLead(rows.actor, rows.resource)}}
		}
		if !strings.Contains(query, "assigned_user_id") || !strings.Contains(query, "to_jsonb(l)->>'team_id'") {
			return scheduleLeadAuthorizationRow{err: errors.New("resource snapshot must include assignee and legacy-compatible team")}
		}
		return scheduleLeadAuthorizationRow{values: []any{rows.resource.AssignedUserID, rows.resource.TeamID}}
	default:
		return scheduleLeadAuthorizationRow{err: errors.New("unexpected extra lead query")}
	}
}

func scheduleLinkActor(grants ...string) tenant.Context {
	return tenant.Context{OrganizationID: "org-a", UserID: "actor-a", MemberRole: "user", Permissions: grants}
}

func TestScheduleNewLeadLinkUsesResourceOperationScope(t *testing.T) {
	leader := scheduleLinkActor(permissions.LeadViewTeam, permissions.LeadOperate)
	leader.LedTeamIDs = []string{"team-a"}
	leader.LedUserIDs = []string{"broker-a"}
	leader.IsTeamLeader = true
	admin := scheduleLinkActor()
	admin.MemberRole = "admin"
	owner := scheduleLinkActor()
	owner.MemberRole = "owner"
	poolAllowed, poolDenied := true, false
	tests := []struct {
		name       string
		actor      tenant.Context
		resource   authorization.LeadResource
		poolAccess *bool
		locked     bool
		want       error
		queries    int
	}{
		{"leader cannot write led broker lead recorded under another team", leader, authorization.LeadResource{AssignedUserID: "broker-a", TeamID: "team-b"}, nil, false, ErrInvalidReference, 3},
		{"leader can link led broker lead under led team", leader, authorization.LeadResource{AssignedUserID: "broker-a", TeamID: "team-a"}, nil, false, nil, 3},
		{"leader can link led broker direct lead", leader, authorization.LeadResource{AssignedUserID: "broker-a"}, nil, false, nil, 3},
		{"leader can link unassigned led queue lead", leader, authorization.LeadResource{TeamID: "team-a"}, nil, false, nil, 3},
		{"historical team cannot grant another broker access", leader, authorization.LeadResource{AssignedUserID: "outside", TeamID: "team-a"}, nil, false, ErrInvalidReference, 3},
		{"leader cannot link unrelated lead", leader, authorization.LeadResource{AssignedUserID: "outside", TeamID: "team-b"}, nil, false, ErrInvalidReference, 3},
		{"broker links own lead even under another team", scheduleLinkActor(permissions.LeadViewOwn, permissions.LeadOperate), authorization.LeadResource{AssignedUserID: "actor-a", TeamID: "team-b"}, nil, false, nil, 3},
		{"broker cannot link another user lead", scheduleLinkActor(permissions.LeadViewOwn, permissions.LeadOperate), authorization.LeadResource{AssignedUserID: "broker-a"}, nil, false, ErrInvalidReference, 3},
		{"read all without operate remains read only", scheduleLinkActor(permissions.LeadViewAll), authorization.LeadResource{AssignedUserID: "broker-a"}, nil, false, tenant.ErrOrganizationAccessDenied, 0},
		{"operate alone does not grant visibility", scheduleLinkActor(permissions.LeadOperate), authorization.LeadResource{AssignedUserID: "actor-a"}, nil, false, ErrInvalidReference, 3},
		{"view all plus operate remains allowed", scheduleLinkActor(permissions.LeadViewAll, permissions.LeadOperate), authorization.LeadResource{AssignedUserID: "broker-a", TeamID: "team-b"}, nil, false, nil, 3},
		{"admin keeps ordinary lead access", admin, authorization.LeadResource{AssignedUserID: "broker-a", TeamID: "team-b"}, nil, false, nil, 3},
		{"owner keeps ordinary lead access", owner, authorization.LeadResource{AssignedUserID: "broker-a", TeamID: "team-b"}, nil, false, nil, 3},
		{"nullable assignee and team remain an ordinary admin link", admin, authorization.LeadResource{}, nil, false, nil, 3},
		{"admin cannot link unclaimed readable pool", admin, authorization.LeadResource{}, &poolAllowed, false, ErrInvalidReference, 2},
		{"admin cannot link unclaimed hidden pool", admin, authorization.LeadResource{}, &poolDenied, false, ErrInvalidReference, 2},
		{"leader cannot link unclaimed pool", leader, authorization.LeadResource{TeamID: "team-a"}, &poolAllowed, false, ErrInvalidReference, 2},
		{"busy parent fails before pool and resource read", admin, authorization.LeadResource{}, nil, true, ErrInvalidReference, 1},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			rows := &scheduleLeadAuthorizationRows{actor: test.actor, organization: "org-a", leadID: "lead-a", resource: test.resource, poolAccess: test.poolAccess, locked: test.locked}
			err := (Repository{}).validateLead(context.Background(), rows, test.actor, &rows.leadID)
			if !errors.Is(err, test.want) || rows.queries != test.queries {
				t.Fatalf("link validation = %v with %d queries; want %v with %d", err, rows.queries, test.want, test.queries)
			}
		})
	}
}

func TestScheduleNewLeadLinkDoesNotCrossOrganizations(t *testing.T) {
	actor := scheduleLinkActor(permissions.LeadViewAll, permissions.LeadOperate)
	actor.OrganizationID = "org-b"
	rows := &scheduleLeadAuthorizationRows{actor: actor, organization: "org-a", leadID: "lead-a"}
	if err := (Repository{}).validateLead(context.Background(), rows, actor, &rows.leadID); !errors.Is(err, ErrInvalidReference) || rows.queries != 1 {
		t.Fatalf("foreign tenant link = %v with %d queries", err, rows.queries)
	}
}

func TestScheduleNewLeadLinkPropagatesResourceReadFailure(t *testing.T) {
	actor := scheduleLinkActor(permissions.LeadViewAll, permissions.LeadOperate)
	want := errors.New("synthetic read unavailable")
	rows := &scheduleLeadAuthorizationRows{actor: actor, organization: "org-a", leadID: "lead-a", readError: want}
	if err := (Repository{}).validateLead(context.Background(), rows, actor, &rows.leadID); !errors.Is(err, want) {
		t.Fatalf("resource failure = %v, want original error", err)
	}
}

func TestScheduleNewLeadLinkRejectsMissingResourceSnapshot(t *testing.T) {
	actor := scheduleLinkActor(permissions.LeadViewAll, permissions.LeadOperate)
	rows := &scheduleLeadAuthorizationRows{actor: actor, organization: "org-a", leadID: "lead-a", readError: pgx.ErrNoRows}
	if err := (Repository{}).validateLead(context.Background(), rows, actor, &rows.leadID); !errors.Is(err, ErrInvalidReference) {
		t.Fatalf("missing resource = %v, want invalid reference", err)
	}
}

func TestScheduleExistingEventLeadLinkPreservesIndependentMaintenance(t *testing.T) {
	// This actor can maintain the event under canEditEvent's separate contract,
	// but cannot operate its lead. Unchanged/removed links must not add a new gate.
	actor := scheduleLinkActor(permissions.ScheduleManage)
	unchanged, next := "lead-a", "lead-b"
	for _, test := range []struct {
		name  string
		patch patchString
	}{
		{"omitted", patchString{}},
		{"echoed unchanged", patchString{Set: true, Value: &unchanged}},
		{"removed", patchString{Set: true}},
	} {
		t.Run(test.name, func(t *testing.T) {
			rows := &scheduleLeadAuthorizationRows{actor: actor, organization: "org-a", leadID: unchanged}
			if err := (Repository{}).validateChangedLeadLink(context.Background(), rows, actor, unchanged, test.patch); err != nil || rows.queries != 0 {
				t.Fatalf("independent maintenance = %v with %d queries", err, rows.queries)
			}
		})
	}
	rows := &scheduleLeadAuthorizationRows{actor: actor, organization: "org-a", leadID: next}
	if err := (Repository{}).validateChangedLeadLink(context.Background(), rows, actor, unchanged, patchString{Set: true, Value: &next}); !errors.Is(err, tenant.ErrOrganizationAccessDenied) {
		t.Fatalf("new link bypassed lead operate = %v", err)
	}
}

func TestScheduleChangedLeadLinkUsesCurrentResourceScope(t *testing.T) {
	actor := scheduleLinkActor(permissions.LeadViewTeam, permissions.LeadOperate)
	actor.LedTeamIDs, actor.LedUserIDs = []string{"team-a"}, []string{"broker-a"}
	for _, test := range []struct {
		team string
		want error
	}{{"team-a", nil}, {"team-b", ErrInvalidReference}} {
		rows := &scheduleLeadAuthorizationRows{actor: actor, organization: "org-a", leadID: "lead-b", resource: authorization.LeadResource{AssignedUserID: "broker-a", TeamID: test.team}}
		err := (Repository{}).validateChangedLeadLink(context.Background(), rows, actor, "lead-a", patchString{Set: true, Value: &rows.leadID})
		if !errors.Is(err, test.want) || rows.queries != 3 {
			t.Fatalf("changed link to %s = %v with %d queries", test.team, err, rows.queries)
		}
	}
}

func TestScheduleCreateWithoutLeadNeedsNoLeadCapability(t *testing.T) {
	actor := scheduleLinkActor(permissions.ScheduleManage)
	rows := &scheduleLeadAuthorizationRows{actor: actor}
	if err := (Repository{}).validateLead(context.Background(), rows, actor, nil); err != nil || rows.queries != 0 {
		t.Fatalf("unlinked event = %v with %d lead queries", err, rows.queries)
	}
}
