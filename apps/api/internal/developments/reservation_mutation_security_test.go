package developments

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type reservationMutationRow struct {
	scope reservationLeadScope
	err   error
}

func (row reservationMutationRow) Scan(dest ...any) error {
	if row.err != nil {
		return row.err
	}
	if len(dest) == 1 {
		*dest[0].(**bool) = row.scope.QueuePoolReadAccess
		return nil
	}
	*dest[0].(*string) = row.scope.AssignedUserID
	*dest[1].(*string) = row.scope.TeamID
	return nil
}

type reservationMutationQueryer struct {
	t       *testing.T
	leads   map[string]reservationLeadScope
	queries int
}

func (queryer *reservationMutationQueryer) QueryRow(_ context.Context, sql string, args ...any) pgx.Row {
	queryer.queries++
	if strings.Contains(sql, "private.queue_pool_read_access") {
		scope, exists := queryer.leads[args[0].(string)+":"+args[1].(string)]
		if !exists {
			return reservationMutationRow{err: pgx.ErrNoRows}
		}
		if len(args) != 3 || args[2] == "" {
			queryer.t.Fatal("pool projection must retain the current actor")
		}
		return reservationMutationRow{scope: scope}
	}
	if !strings.Contains(sql, "lead.organization_id = $1::uuid") || !strings.Contains(sql, "for share of lead") {
		queryer.t.Fatal("mutation lookup must retain organization scope and its lead lock")
	}
	scope, exists := queryer.leads[args[0].(string)+":"+args[1].(string)]
	if !exists {
		return reservationMutationRow{err: pgx.ErrNoRows}
	}
	return reservationMutationRow{scope: scope}
}

func TestReservationPoolReadAudienceDoesNotAuthorizeMutation(t *testing.T) {
	leadID := "11111111-1111-4111-8111-111111111111"
	actor := tenant.Context{OrganizationID: "org-a", UserID: "admin", MemberRole: "admin", Permissions: []string{permissions.PropertyManage}}
	for _, allowed := range []bool{false, true} {
		scope := reservationLeadScope{QueuePoolReadAccess: &allowed}
		queryer := &reservationMutationQueryer{t: t, leads: map[string]reservationLeadScope{"org-a:" + leadID: scope}}
		if canViewReservationLead(actor, scope) != allowed {
			t.Fatal("private audience must be authoritative even for a broad reader")
		}
		if err := requireReservationLeadMutation(context.Background(), queryer, actor, Reservation{LeadID: &leadID}); !errors.Is(err, ErrNotFound) {
			t.Fatalf("pool read access %v allowed mutation without claim: %v", allowed, err)
		}
		if queryer.queries != 2 {
			t.Fatalf("pool must be read in a separate post-lock statement: %d", queryer.queries)
		}
		name := "private synthetic lead"
		reservation := Reservation{LeadID: &leadID, LeadName: &name}
		redactReservationLead(actor, scope, &reservation)
		if (reservation.LeadID != nil) != allowed || (reservation.LeadName != nil) != allowed {
			t.Fatal("reservation lead projection did not follow pool audience")
		}
	}
}

func TestReservationMutationRequiresWriteScopeAndCurrentOrganization(t *testing.T) {
	leadID := "11111111-1111-4111-8111-111111111111"
	actor := tenant.Context{
		OrganizationID: "org-a", UserID: "leader", LedTeamIDs: []string{"team-led"},
		LedUserIDs: []string{"broker"}, Permissions: []string{permissions.PropertyManage, permissions.LeadViewTeam},
	}
	queryer := &reservationMutationQueryer{t: t, leads: map[string]reservationLeadScope{
		"org-a:" + leadID: {AssignedUserID: "broker", TeamID: "team-other"},
	}}
	reservation := Reservation{LeadID: &leadID}
	if !canViewReservationLead(actor, queryer.leads["org-a:"+leadID]) {
		t.Fatal("control: broader broker-based reading must remain permitted")
	}
	if err := requireReservationLeadMutation(context.Background(), queryer, actor, reservation); !errors.Is(err, ErrNotFound) {
		t.Fatalf("cross-team read scope granted mutation: %v", err)
	}
	queryer.leads["org-a:"+leadID] = reservationLeadScope{AssignedUserID: "broker", TeamID: "team-led"}
	if err := requireReservationLeadMutation(context.Background(), queryer, actor, reservation); err != nil {
		t.Fatalf("own led-team mutation refused: %v", err)
	}
	otherActor := actor
	otherActor.OrganizationID = "org-b"
	if err := requireReservationLeadMutation(context.Background(), queryer, otherActor, reservation); !errors.Is(err, ErrNotFound) {
		t.Fatalf("foreign organization's lead was usable: %v", err)
	}
	// The same lead identifier in another organization must resolve that tenant's
	// scope, never reuse the first organization's authorized relationship.
	queryer.leads["org-b:"+leadID] = reservationLeadScope{AssignedUserID: "outsider", TeamID: "team-other"}
	if err := requireReservationLeadMutation(context.Background(), queryer, otherActor, reservation); !errors.Is(err, ErrNotFound) {
		t.Fatalf("same identifier reused authorization across organizations: %v", err)
	}
}

func TestReservationMutationWithoutLeadStillRequiresManagement(t *testing.T) {
	if err := requireReservationLeadMutation(context.Background(), nil, tenant.Context{Permissions: []string{permissions.PropertyManage}}, Reservation{}); err != nil {
		t.Fatalf("manager's unlinked reservation refused: %v", err)
	}
	if err := requireReservationLeadMutation(context.Background(), nil, tenant.Context{Permissions: []string{permissions.LeadViewAll}}, Reservation{}); !errors.Is(err, tenant.ErrOrganizationAccessDenied) {
		t.Fatalf("lead reading granted reservation management: %v", err)
	}
}
