package attention

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type attentionPoolRow struct {
	leadID string
	access *bool
	err    error
}

func (r attentionPoolRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	switch p := dest[0].(type) {
	case *string:
		*p = r.leadID
	case **bool:
		*p = r.access
	}
	return nil
}

type attentionPoolQueryer struct {
	t      *testing.T
	calls  int
	access *bool
	busy   bool
}

func (q *attentionPoolQueryer) QueryRow(_ context.Context, query string, args ...any) pgx.Row {
	q.calls++
	if q.calls == 1 {
		if !strings.Contains(query, "for no key update of l skip locked") || len(args) != 2 || args[0] != "org-a" {
			q.t.Fatal("lock must use the current tenant and skip a busy parent")
		}
		if q.busy {
			return attentionPoolRow{err: pgx.ErrNoRows}
		}
		return attentionPoolRow{leadID: "lead-a"}
	}
	if q.calls != 2 || !strings.Contains(query, "private.queue_pool_read_access") || args[0] != "org-a" || args[1] != "lead-a" || args[2] != "actor-a" {
		q.t.Fatal("pool authorization must be read after locking its exact parent")
	}
	return attentionPoolRow{access: q.access}
}
func TestAttentionPoolMutationRequiresClaimForEveryAudience(t *testing.T) {
	actor := tenant.Context{OrganizationID: "org-a", UserID: "actor-a"}
	for _, access := range []*bool{nil, boolPointer(false), boolPointer(true)} {
		queryer := &attentionPoolQueryer{t: t, access: access}
		err := lockAttentionItemLeadMutation(context.Background(), queryer, actor, "item-a")
		if access == nil && err != nil {
			t.Fatal(err)
		}
		if access != nil && *access && !errors.Is(err, ErrForbidden) {
			t.Fatalf("audience %v allowed generic mutation: %v", *access, err)
		}
		if access != nil && !*access && !errors.Is(err, ErrNotFound) {
			t.Fatalf("excluded audience learned private item existence: %v", err)
		}
	}
	busy := &attentionPoolQueryer{t: t, busy: true}
	if err := lockAttentionItemLeadMutation(context.Background(), busy, actor, "item-a"); !errors.Is(err, ErrNotFound) || busy.calls != 1 {
		t.Fatal("busy lead must fail closed before any mutation")
	}
}
func TestAttentionEveryReadScopeIncludesPrivatePoolAudience(t *testing.T) {
	actor := tenant.Context{OrganizationID: "org-a", UserID: "actor-a", Permissions: []string{permissions.LeadViewAll}}
	for _, scope := range []string{"mine", "team", "organization", "all"} {
		where, args, err := itemVisibilitySQL(actor, scope)
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(where, "coalesce(private.queue_pool_read_access(i.organization_id,i.lead_id,") || args[len(args)-1] != "actor-a" {
			t.Fatalf("scope %s omitted the private ceiling", scope)
		}
	}
}
func boolPointer(value bool) *bool { return &value }
