package roundrobin

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type lifecycleRow struct {
	value bool
	err   error
}

func (r lifecycleRow) Scan(values ...any) error {
	if r.err != nil {
		return r.err
	}
	*values[0].(*bool) = r.value
	return nil
}

type lifecycleQueryer struct {
	value bool
	err   error
	query string
	args  []any
}

func (q *lifecycleQueryer) QueryRow(_ context.Context, query string, args ...any) pgx.Row {
	q.query, q.args = query, args
	return lifecycleRow{q.value, q.err}
}
func (*lifecycleQueryer) Query(context.Context, string, ...any) (pgx.Rows, error) {
	panic("unexpected rows query")
}
func (*lifecycleQueryer) Exec(context.Context, string, ...any) (pgconn.CommandTag, error) {
	panic("unexpected mutation")
}

func TestQueueDeletePendingCheckPreservesScopeAndErrors(t *testing.T) {
	for _, pending := range []bool{false, true} {
		q := &lifecycleQueryer{value: pending}
		err := ensureQueueHasNoDistributionPending(context.Background(), q, "org-a", "queue-a")
		if errors.Is(err, ErrQueueDistributionPending) != pending || len(q.args) != 2 || q.args[0] != "org-a" || q.args[1] != "queue-a" {
			t.Fatalf("pending=%v err=%v args=%v", pending, err, q.args)
		}
	}
	want := errors.New("database unavailable")
	if got := ensureQueueHasNoDistributionPending(context.Background(), &lifecycleQueryer{err: want}, "org-a", "queue-a"); !errors.Is(got, want) {
		t.Fatal(got)
	}
}

func TestQueueHistoryTombstoneKeepsOrganizationAuthorization(t *testing.T) {
	actor := tenant.Context{OrganizationID: "org-a", IsSuperAdmin: true}
	q := &lifecycleQueryer{value: true}
	if err := (Repository{}).ensureRoundRobinHistoryVisible(context.Background(), q, actor, "queue-a"); err != nil {
		t.Fatal(err)
	}
	if len(q.args) != 2 || q.args[0] != "org-a" || strings.Contains(q.query, "deleted_at") {
		t.Fatalf("history scope = %s %v", q.query, q.args)
	}
	q.value = false
	if err := (Repository{}).ensureRoundRobinHistoryVisible(context.Background(), q, actor, "queue-b"); !errors.Is(err, ErrRoundRobinNotFound) {
		t.Fatal(err)
	}
	if err := (Repository{}).ensureRoundRobinHistoryVisible(context.Background(), q, tenant.Context{OrganizationID: "org-a"}, "queue-a"); !errors.Is(err, tenant.ErrOrganizationAccessDenied) {
		t.Fatal(err)
	}
}

func TestQueuePendingDeletionMapsGoAndSQLToConflict(t *testing.T) {
	for _, err := range []error{ErrQueueDistributionPending, &pgconn.PgError{Code: "23514", Message: "queue_distribution_pending"}} {
		recorder := httptest.NewRecorder()
		writeRoundRobinError(recorder, httptest.NewRequest(http.MethodDelete, "/", nil), err)
		if recorder.Code != http.StatusConflict || !strings.Contains(recorder.Body.String(), "round_robin_distribution_pending") {
			t.Fatalf("response = %d %s", recorder.Code, recorder.Body.String())
		}
	}
}

func TestQueueHistoryHydratesOnlyTenantParticipantsOrExplicitGlobalActors(t *testing.T) {
	for _, fragment := range []string{
		"actor.organization_id = $1::uuid or actor.role = 'super_admin'",
		"actor_membership.organization_id = $1::uuid and actor_membership.user_id = actor.id",
		"subject.organization_id = $1::uuid or subject.role = 'super_admin'",
		"subject_membership.organization_id = $1::uuid and subject_membership.user_id = subject.id",
	} {
		if !strings.Contains(historyQuery, fragment) {
			t.Fatalf("missing history participant boundary %q", fragment)
		}
	}
}
