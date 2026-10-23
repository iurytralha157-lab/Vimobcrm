package developments

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type reservationLockRow struct {
	values []any
	err    error
}

func (row reservationLockRow) Scan(dest ...any) error {
	if row.err != nil {
		return row.err
	}
	for index, value := range row.values {
		switch target := dest[index].(type) {
		case **string:
			if value == nil {
				*target = nil
			} else {
				*target = activationText(value.(string))
			}
		case *string:
			*target = value.(string)
		case *[]byte:
			*target = value.([]byte)
		case **bool:
			if value == nil {
				*target = nil
			} else {
				access := value.(bool)
				*target = &access
			}
		}
	}
	return nil
}

type reservationLockQueryer struct {
	pgx.Tx
	t              *testing.T
	organizationID string
	rows           []reservationLockRow
	queries        []string
}

func (queryer *reservationLockQueryer) QueryRow(_ context.Context, sql string, args ...any) pgx.Row {
	queryer.t.Helper()
	if strings.Contains(sql, "private.queue_pool_read_access") {
		if args[0] != queryer.organizationID || len(args) != 3 || len(queryer.queries) < 2 ||
			!strings.Contains(queryer.queries[len(queryer.queries)-1], "for share of lead") {
			queryer.t.Fatal("private authorization must follow the same tenant's lead lock")
		}
		queryer.queries = append(queryer.queries, sql)
		return reservationLockRow{values: []any{nil}}
	}
	if args[0] != queryer.organizationID || !strings.Contains(sql, "organization_id = $1::uuid") {
		queryer.t.Fatal("reservation/lead lookup lost its original tenant")
	}
	if !strings.Contains(sql, "from public.leads") && !reflect.DeepEqual(args, []any{queryer.organizationID, "development", "reservation"}) {
		queryer.t.Fatalf("reservation lookup lost development/resource scope: %v", args)
	}
	index := 0
	for _, query := range queryer.queries {
		if !strings.Contains(query, "private.queue_pool_read_access") {
			index++
		}
	}
	queryer.queries = append(queryer.queries, sql)
	if index >= len(queryer.rows) {
		queryer.t.Fatal("unexpected lock/query after failure")
	}
	return queryer.rows[index]
}

func reservationLockJSON(leadID *string) []byte {
	raw, _ := json.Marshal(Reservation{ID: "reservation", LeadID: leadID})
	return raw
}

func TestReservationMutationLocksCurrentLeadBeforeReservation(t *testing.T) {
	for _, organizationID := range []string{"org-a", "org-b"} {
		t.Run(organizationID, func(t *testing.T) {
			queryer := &reservationLockQueryer{t: t, organizationID: organizationID, rows: []reservationLockRow{
				{values: []any{"lead"}}, {values: []any{"operator", "team"}},
				{values: []any{reservationLockJSON(activationText("lead"))}},
			}}
			current, err := lockReservationForMutationTx(context.Background(), queryer, tenant.Context{
				OrganizationID: organizationID, UserID: "operator", Permissions: []string{permissions.PropertyManage, permissions.LeadViewOwn},
			}, "development", "reservation")
			if err != nil || current.ID != "reservation" || len(queryer.queries) != 4 {
				t.Fatalf("lock result: %#v %v", current, err)
			}
			if strings.Contains(queryer.queries[0], "for update") || strings.Contains(queryer.queries[0], "for share") {
				t.Fatal("discovery locked the reservation ahead of the lead")
			}
			if !strings.Contains(queryer.queries[1], "for share of lead") || !strings.Contains(queryer.queries[2], "private.queue_pool_read_access") || !strings.Contains(queryer.queries[3], "for update") {
				t.Fatal("mutation did not retain lead -> reservation order")
			}
		})
	}
}

func TestReservationMutationRechecksBindingAndFailsClosed(t *testing.T) {
	dbError := errors.New("synthetic database error")
	for _, scenario := range []struct {
		name string
		rows []reservationLockRow
		want error
	}{
		{"unlinked", []reservationLockRow{{values: []any{nil}}, {values: []any{reservationLockJSON(nil)}}}, nil},
		{"lead removed before reservation lock", []reservationLockRow{{values: []any{"lead"}}, {values: []any{"operator", ""}}, {values: []any{reservationLockJSON(nil)}}}, ErrConflict},
		{"lead replaced", []reservationLockRow{{values: []any{"lead"}}, {values: []any{"operator", ""}}, {values: []any{reservationLockJSON(activationText("other"))}}}, ErrConflict},
		{"new lead appeared", []reservationLockRow{{values: []any{nil}}, {values: []any{reservationLockJSON(activationText("other"))}}}, ErrConflict},
		{"missing discovery", []reservationLockRow{{err: pgx.ErrNoRows}}, ErrNotFound},
		{"missing current lead", []reservationLockRow{{values: []any{"lead"}}, {err: pgx.ErrNoRows}}, ErrNotFound},
		{"missing locked reservation", []reservationLockRow{{values: []any{"lead"}}, {values: []any{"operator", ""}}, {err: pgx.ErrNoRows}}, ErrNotFound},
		{"failed discovery", []reservationLockRow{{err: dbError}}, dbError},
		{"failed authorization read", []reservationLockRow{{values: []any{"lead"}}, {err: dbError}}, dbError},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			queryer := &reservationLockQueryer{t: t, organizationID: "org-a", rows: scenario.rows}
			_, err := lockReservationForMutationTx(context.Background(), queryer, tenant.Context{
				OrganizationID: "org-a", UserID: "operator", Permissions: []string{permissions.PropertyManage, permissions.LeadViewOwn},
			}, "development", "reservation")
			wantQueries := len(scenario.rows)
			if len(scenario.rows) > 1 && scenario.rows[0].err == nil && scenario.rows[0].values[0] != nil && scenario.rows[1].err == nil {
				wantQueries++
			}
			if !errors.Is(err, scenario.want) || len(queryer.queries) != wantQueries {
				t.Fatalf("error=%v calls=%d", err, len(queryer.queries))
			}
		})
	}
}

func TestReservationMutationChecksFreshWriteScopeBeforeLockingReservation(t *testing.T) {
	actor := tenant.Context{OrganizationID: "org-a", UserID: "leader", LedTeamIDs: []string{"team-led"}, LedUserIDs: []string{"broker"},
		Permissions: []string{permissions.PropertyManage, permissions.LeadViewTeam}}
	queryer := &reservationLockQueryer{t: t, organizationID: "org-a", rows: []reservationLockRow{
		{values: []any{"lead"}}, {values: []any{"broker", "team-other"}},
	}}
	if _, err := lockReservationForMutationTx(context.Background(), queryer, actor, "development", "reservation"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("broader current reading granted operation: %v", err)
	}
	if len(queryer.queries) != 3 {
		t.Fatal("denied actor acquired reservation lock")
	}
	actor.Permissions = []string{permissions.LeadViewAll}
	if _, err := lockReservationForMutationTx(context.Background(), nil, actor, "development", "reservation"); !errors.Is(err, tenant.ErrOrganizationAccessDenied) {
		t.Fatalf("missing management did not stop before any lookup: %v", err)
	}
}
