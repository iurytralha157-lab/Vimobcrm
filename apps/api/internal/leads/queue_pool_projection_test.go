package leads

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type poolProjectionRow struct{ access *bool }

func (row poolProjectionRow) Scan(dest ...any) error {
	*dest[0].(**bool) = row.access
	*dest[1].(*[]byte) = nil
	return nil
}

type poolProjectionRows struct {
	pgx.Rows
	access  *bool
	missing bool
	seen    bool
}

func (rows *poolProjectionRows) Next() bool {
	if rows.seen || rows.missing {
		return false
	}
	rows.seen = true
	return true
}
func (rows *poolProjectionRows) Scan(dest ...any) error {
	*dest[0].(*string) = "lead"
	*dest[1].(**bool) = rows.access
	*dest[2].(*[]byte) = nil
	return nil
}
func (*poolProjectionRows) Err() error { return nil }
func (*poolProjectionRows) Close()     {}

type poolProjectionQueryer struct {
	access  *bool
	missing bool
}

func (queryer poolProjectionQueryer) QueryRow(context.Context, string, ...any) pgx.Row {
	return poolProjectionRow{queryer.access}
}
func (queryer poolProjectionQueryer) Query(context.Context, string, ...any) (pgx.Rows, error) {
	return &poolProjectionRows{access: queryer.access, missing: queryer.missing}, nil
}

func TestQueuePoolProjectionDenialAfterInitialReadFailsClosed(t *testing.T) {
	denied := false
	queryer := poolProjectionQueryer{access: &denied}
	actor := tenant.Context{OrganizationID: "org", UserID: "actor"}
	lead := Lead{ID: "lead", Name: "private name", Phone: "private phone"}
	if err := hydrateQueuePoolLead(context.Background(), queryer, actor, &lead); !errors.Is(err, ErrLeadNotFound) {
		t.Fatalf("detail must honor the newer pool denial, got %v", err)
	}
	if err := hydrateQueuePoolLeads(context.Background(), queryer, actor, []Lead{lead}); !errors.Is(err, ErrLeadNotFound) {
		t.Fatalf("list must not serialize rows after a newer denial, got %v", err)
	}
	board := &PipelineBoardLead{ID: "lead", Name: "private name"}
	if err := hydrateQueuePoolBoard(context.Background(), queryer, actor, []*PipelineBoardLead{board}); !errors.Is(err, ErrLeadNotFound) {
		t.Fatalf("board must not serialize a card after a newer denial, got %v", err)
	}
}

func TestQueuePoolProjectionMissingLeadDoesNotReuseStaleCard(t *testing.T) {
	_, err := loadQueuePoolProjections(context.Background(), poolProjectionQueryer{missing: true}, tenant.Context{}, []string{"lead"})
	if !errors.Is(err, ErrLeadNotFound) {
		t.Fatalf("missing final resource must fail closed, got %v", err)
	}
}

func TestQueuePoolReadDoesNotEnableGenericOperation(t *testing.T) {
	allowed := true
	actor := tenant.Context{MemberRole: "admin"}
	lead := withLeadOperationCapability(actor, Lead{QueuePoolReadAccess: &allowed})
	card := withPipelineLeadOperationCapability(actor, PipelineBoardLead{QueuePool: &QueuePoolMetadata{}})
	if lead.CanOperate == nil || *lead.CanOperate || lead.CanProgress == nil || *lead.CanProgress ||
		card.CanOperate || card.CanProgress {
		t.Fatal("pool audience must not enable ordinary editing or progression")
	}
}
