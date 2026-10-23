package schedule

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type schedulePoolLinkRow struct {
	access *bool
	err    error
}

func (r schedulePoolLinkRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	switch p := dest[0].(type) {
	case *string:
		*p = "lead-a"
	case **bool:
		*p = r.access
	}
	return nil
}

type schedulePoolLinkQueryer struct {
	t      *testing.T
	calls  int
	access *bool
	busy   bool
}

func (q *schedulePoolLinkQueryer) QueryRow(_ context.Context, query string, args ...any) pgx.Row {
	q.calls++
	if q.calls == 1 {
		if !strings.Contains(query, "for share of l skip locked") || args[0] != "org-a" || args[1] != "lead-a" {
			q.t.Fatal("new link must lock its own tenant lead")
		}
		if q.busy {
			return schedulePoolLinkRow{err: pgx.ErrNoRows}
		}
	} else if q.calls != 2 || !strings.Contains(query, "private.queue_pool_read_access") || args[0] != "org-a" || args[1] != "lead-a" || args[2] != "actor-a" {
		q.t.Fatal("private runtime must be checked in a fresh statement after its parent lock")
	}
	return schedulePoolLinkRow{access: q.access}
}
func TestScheduleNewLeadLinkRequiresClaimInPrivatePool(t *testing.T) {
	actor := tenant.Context{OrganizationID: "org-a", UserID: "actor-a"}
	allowed, denied := true, false
	for _, access := range []*bool{nil, &allowed, &denied} {
		queryer := &schedulePoolLinkQueryer{t: t, access: access}
		err := requireScheduleLeadOutsideQueuePool(context.Background(), queryer, actor, "lead-a")
		if access == nil && err != nil {
			t.Fatal(err)
		}
		if access != nil && !errors.Is(err, ErrInvalidReference) {
			t.Fatalf("private pool link allowed: %v", err)
		}
	}
	busy := &schedulePoolLinkQueryer{t: t, busy: true}
	if err := requireScheduleLeadOutsideQueuePool(context.Background(), busy, actor, "lead-a"); !errors.Is(err, ErrInvalidReference) || busy.calls != 1 {
		t.Fatal("busy parent must fail before linking")
	}
}
