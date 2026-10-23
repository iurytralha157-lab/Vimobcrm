package leads

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const attachmentTestOrg = "10000000-0000-4000-8000-000000000001"
const attachmentTestActor = "20000000-0000-4000-8000-000000000001"
const attachmentTestLead = "30000000-0000-4000-8000-000000000001"
const attachmentTestID = "40000000-0000-4000-8000-000000000001"
const attachmentTestKey = "50000000-0000-4000-8000-000000000001"

type attachmentTestRow struct{ scan func(...any) error }

func (row attachmentTestRow) Scan(dest ...any) error { return row.scan(dest...) }

type attachmentTestRows struct {
	pgx.Rows
	id, owner           string
	available, advanced bool
}

func (rows *attachmentTestRows) Next() bool {
	if rows.advanced || !rows.available {
		return false
	}
	rows.advanced = true
	return true
}
func (rows *attachmentTestRows) Scan(dest ...any) error {
	*dest[0].(*string) = rows.id
	*dest[1].(*string) = rows.owner
	*dest[2].(*string) = ""
	return nil
}
func (*attachmentTestRows) Close()     {}
func (*attachmentTestRows) Err() error { return nil }

type attachmentUploadFixture struct {
	receipts                              map[string]attachmentUploadReceipt
	attachments                           map[string]LeadAttachment
	beginCount, uploads, inserts, cleanup int
	ledgerError, insertError              error
	lostCommit                            bool
	owner                                 string
	poolAccess                            *bool
	queries                               []string
}
type attachmentUploadFixtureTx struct {
	pgx.Tx
	fixture        *attachmentUploadFixture
	changes        map[string]attachmentUploadReceipt
	newAttachments map[string]LeadAttachment
	closed         bool
	index          int
}

func receiptNamespace(args []any) string {
	return args[0].(string) + ":" + args[1].(string) + ":" + args[2].(string)
}
func (tx *attachmentUploadFixtureTx) Exec(_ context.Context, query string, args ...any) (pgconn.CommandTag, error) {
	tx.fixture.queries = append(tx.fixture.queries, query)
	key := receiptNamespace(args)
	if strings.Contains(query, "insert into private") {
		if tx.fixture.ledgerError != nil {
			return pgconn.CommandTag{}, tx.fixture.ledgerError
		}
		if _, exists := tx.fixture.receipts[key]; !exists {
			tx.changes[key] = attachmentUploadReceipt{key: args[2].(string), leadID: args[3].(string), digest: args[4].(string), objectPath: args[5].(string)}
		}
		return pgconn.NewCommandTag("INSERT 0 1"), nil
	}
	receipt := tx.fixture.receipts[key]
	if local, ok := tx.changes[key]; ok {
		receipt = local
	}
	if receipt.digest != args[4].(string) || receipt.attachmentID != "" {
		return pgconn.NewCommandTag("UPDATE 0"), nil
	}
	receipt.attachmentID = args[3].(string)
	tx.changes[key] = receipt
	return pgconn.NewCommandTag("UPDATE 1"), nil
}
func (tx *attachmentUploadFixtureTx) Query(_ context.Context, query string, args ...any) (pgx.Rows, error) {
	tx.fixture.queries = append(tx.fixture.queries, query)
	return &attachmentTestRows{id: attachmentTestLead, owner: tx.fixture.owner, available: args[0] == attachmentTestOrg}, nil
}
func (tx *attachmentUploadFixtureTx) QueryRow(_ context.Context, query string, args ...any) pgx.Row {
	tx.fixture.queries = append(tx.fixture.queries, query)
	if strings.Contains(query, "private.queue_pool_read_access") {
		return attachmentTestRow{scan: func(dest ...any) error {
			if len(args) != 3 || args[0] != attachmentTestOrg || args[1] != attachmentTestLead {
				return errors.New("pool check lost its locked tenant/lead scope")
			}
			*dest[0].(**bool) = tx.fixture.poolAccess
			return nil
		}}
	}
	if strings.Contains(query, "from private.") {
		key := receiptNamespace(args)
		receipt, ok := tx.fixture.receipts[key]
		if local, exists := tx.changes[key]; exists {
			receipt, ok = local, true
		}
		return attachmentTestRow{scan: func(dest ...any) error {
			if !ok {
				return pgx.ErrNoRows
			}
			*dest[0].(*string) = receipt.digest
			*dest[1].(*string) = receipt.leadID
			*dest[2].(*string) = receipt.objectPath
			*dest[3].(*pgtype.Text) = pgtype.Text{String: receipt.attachmentID, Valid: receipt.attachmentID != ""}
			return nil
		}}
	}
	attachment, ok := tx.fixture.attachments[args[2].(string)]
	return attachmentTestRow{scan: func(dest ...any) error {
		if !ok {
			return pgx.ErrNoRows
		}
		return scanAttachmentFixture(attachment, dest)
	}}
}
func scanAttachmentFixture(attachment LeadAttachment, dest []any) error {
	for _, pointer := range dest {
		v := reflect.ValueOf(pointer)
		v.Elem().Set(reflect.Zero(v.Elem().Type()))
	}
	*dest[0].(*string) = attachment.ID
	*dest[1].(*string) = attachment.LeadID
	*dest[2].(*string) = attachment.FileName
	*dest[3].(*string) = attachment.FileURL
	if attachment.FileType != nil {
		*dest[4].(*pgtype.Text) = pgtype.Text{String: *attachment.FileType, Valid: true}
	}
	if attachment.FileSize != nil {
		*dest[5].(*pgtype.Int8) = pgtype.Int8{Int64: *attachment.FileSize, Valid: true}
	}
	*dest[10].(*time.Time) = attachment.CreatedAt
	return nil
}
func (tx *attachmentUploadFixtureTx) Commit(context.Context) error {
	if tx.closed {
		return pgx.ErrTxClosed
	}
	tx.closed = true
	for key, receipt := range tx.changes {
		tx.fixture.receipts[key] = receipt
	}
	for key, attachment := range tx.newAttachments {
		tx.fixture.attachments[key] = attachment
	}
	if tx.index == 2 && tx.fixture.lostCommit {
		tx.fixture.lostCommit = false
		return errors.New("synthetic lost commit acknowledgement")
	}
	return nil
}
func (tx *attachmentUploadFixtureTx) Rollback(context.Context) error {
	if tx.closed {
		return pgx.ErrTxClosed
	}
	tx.closed = true
	return nil
}
func (fixture *attachmentUploadFixture) operations() attachmentUploadOperations {
	return attachmentUploadOperations{
		begin: func(context.Context) (pgx.Tx, error) {
			fixture.beginCount++
			return &attachmentUploadFixtureTx{fixture: fixture, index: fixture.beginCount, changes: map[string]attachmentUploadReceipt{}, newAttachments: map[string]LeadAttachment{}}, nil
		},
		insert: func(_ context.Context, tx pgx.Tx, input leadAttachmentCreateInput, _ string) (LeadAttachment, error) {
			fixture.inserts++
			if fixture.insertError != nil {
				return LeadAttachment{}, fixture.insertError
			}
			a := LeadAttachment{ID: attachmentTestID, LeadID: input.LeadID, FileName: input.FileName, FileURL: "https://project.invalid/stable-object", CreatedAt: time.Now().UTC()}
			tx.(*attachmentUploadFixtureTx).newAttachments[a.ID] = a
			return a, nil
		},
		upload:  func(context.Context, string, string, []byte) error { fixture.uploads++; return nil },
		sign:    func(_ context.Context, _ tenant.Context, a *LeadAttachment) { a.Availability = "ready" },
		cleanup: func(tenant.Context, attachmentUploadReceipt) { fixture.cleanup++ },
	}
}
func attachmentUploadTestInput() (tenant.Context, leadAttachmentCreateInput, attachmentUploadReceipt) {
	actor := tenant.Context{OrganizationID: attachmentTestOrg, UserID: attachmentTestActor, MemberRole: "member", Permissions: []string{permissions.LeadViewOwn, permissions.LeadOperate}}
	input := leadAttachmentCreateInput{LeadID: attachmentTestLead, FileName: "fixture.pdf"}
	receipt := attachmentUploadReceipt{key: attachmentTestKey, leadID: input.LeadID, digest: attachmentUploadDigest(input.LeadID, input.FileName, "application/pdf", []byte("%PDF-1.7 fixture")), objectPath: "orgs/" + actor.OrganizationID + "/leads/" + input.LeadID + "/docs/fixture.pdf"}
	return actor, input, receipt
}
func newAttachmentUploadFixture() *attachmentUploadFixture {
	return &attachmentUploadFixture{receipts: map[string]attachmentUploadReceipt{}, attachments: map[string]LeadAttachment{}, owner: attachmentTestActor}
}

func TestAttachmentLostCommitResponseReplaysWithoutDeletingOrDuplicating(t *testing.T) {
	actor, input, receipt := attachmentUploadTestInput()
	fixture := newAttachmentUploadFixture()
	fixture.lostCommit = true
	_, err := runAttachmentUpload(context.Background(), actor, input, []byte("%PDF-1.7 fixture"), "application/pdf", receipt, leadAttachmentColumns{}, fixture.operations())
	if err == nil || fixture.cleanup != 0 || fixture.inserts != 1 || fixture.uploads != 1 {
		t.Fatalf("unknown commit cleanup/inserts/uploads=%d/%d/%d err=%v", fixture.cleanup, fixture.inserts, fixture.uploads, err)
	}
	result, err := runAttachmentUpload(context.Background(), actor, input, []byte("%PDF-1.7 fixture"), "application/pdf", receipt, leadAttachmentColumns{}, fixture.operations())
	if err != nil || result.ID != attachmentTestID || fixture.inserts != 1 || fixture.uploads != 1 || len(fixture.attachments) != 1 {
		t.Fatalf("replay duplicated a committed attachment: %#v err=%v", result, err)
	}
}

func TestAttachmentPoolRequiresClaimBeforeReceiptOrUpload(t *testing.T) {
	for _, allowedToRead := range []bool{true, false} {
		t.Run(fmt.Sprintf("pool audience %t", allowedToRead), func(t *testing.T) {
			actor, input, receipt := attachmentUploadTestInput()
			actor.MemberRole = "admin"
			actor.Permissions = []string{"*"}
			fixture := newAttachmentUploadFixture()
			fixture.poolAccess = &allowedToRead
			_, err := runAttachmentUpload(context.Background(), actor, input, []byte("%PDF-1.7 fixture"), "application/pdf", receipt, leadAttachmentColumns{}, fixture.operations())
			if !errors.Is(err, ErrQueuePoolConflict) || fixture.uploads != 0 || fixture.inserts != 0 || fixture.cleanup != 0 || len(fixture.receipts) != 0 {
				t.Fatalf("pool upload crossed claim boundary: err=%v uploads=%d inserts=%d cleanup=%d receipts=%d", err, fixture.uploads, fixture.inserts, fixture.cleanup, len(fixture.receipts))
			}
			if len(fixture.queries) != 2 || !strings.Contains(fixture.queries[0], "for no key update of l") || !strings.Contains(fixture.queries[1], "private.queue_pool_read_access") {
				t.Fatal("pool authorization must occur after lead lock and before ledger or provider work")
			}
		})
	}
}

func TestAttachmentReceiptsFailClosedOnConflictMissingLedgerAndForeignTenant(t *testing.T) {
	for _, scenario := range []string{"different content", "missing ledger", "foreign tenant", "transfer before write"} {
		t.Run(scenario, func(t *testing.T) {
			actor, input, receipt := attachmentUploadTestInput()
			fixture := newAttachmentUploadFixture()
			want := ErrAttachmentUploadConflict
			switch scenario {
			case "different content":
				changed := receipt
				changed.digest = "changed"
				fixture.receipts[actor.OrganizationID+":"+actor.UserID+":"+receipt.key] = changed
			case "missing ledger":
				fixture.ledgerError = &pgconn.PgError{Code: "42P01"}
				want = ErrAttachmentUploadUnavailable
			case "foreign tenant":
				actor.OrganizationID = "10000000-0000-4000-8000-000000000002"
				want = ErrLeadNotFound
			case "transfer before write":
				fixture.owner = "20000000-0000-4000-8000-000000000002"
				want = tenant.ErrOrganizationAccessDenied
			}
			_, err := runAttachmentUpload(context.Background(), actor, input, []byte("fixture"), "application/pdf", receipt, leadAttachmentColumns{}, fixture.operations())
			if !errors.Is(err, want) || fixture.uploads != 0 || fixture.inserts != 0 {
				t.Fatalf("unsafe preflight: err=%v uploads=%d inserts=%d", err, fixture.uploads, fixture.inserts)
			}
		})
	}
}

func TestAttachmentCleanupRequiresConfirmedRollbackAndReceiptSurvivesFailure(t *testing.T) {
	actor, input, receipt := attachmentUploadTestInput()
	fixture := newAttachmentUploadFixture()
	fixture.insertError = errors.New("synthetic insert rejection")
	_, err := runAttachmentUpload(context.Background(), actor, input, []byte("fixture"), "application/pdf", receipt, leadAttachmentColumns{}, fixture.operations())
	if err == nil || fixture.cleanup != 1 || len(fixture.receipts) != 1 || len(fixture.attachments) != 0 {
		t.Fatalf("rollback cleanup=%d receipts=%d attachments=%d err=%v", fixture.cleanup, len(fixture.receipts), len(fixture.attachments), err)
	}
	fixture.insertError = nil
	if _, err := runAttachmentUpload(context.Background(), actor, input, []byte("fixture"), "application/pdf", receipt, leadAttachmentColumns{}, fixture.operations()); err != nil || len(fixture.attachments) != 1 {
		t.Fatalf("same operation cannot recover: %v", err)
	}
}

func TestAttachmentDigestIncludesBytesLeadNameAndDetectedMime(t *testing.T) {
	base := attachmentUploadDigest("lead", "name.pdf", "application/pdf", []byte("fixture"))
	for _, changed := range []string{attachmentUploadDigest("other", "name.pdf", "application/pdf", []byte("fixture")), attachmentUploadDigest("lead", "other.pdf", "application/pdf", []byte("fixture")), attachmentUploadDigest("lead", "name.pdf", "application/octet-stream", []byte("fixture")), attachmentUploadDigest("lead", "name.pdf", "application/pdf", []byte("changed"))} {
		if base == changed {
			t.Fatal("changed input reused the digest")
		}
	}
	if validatedAttachmentContentType([]byte("<html>inert fixture</html>")) != "application/octet-stream" {
		t.Fatal("HTML may not be served as executable content")
	}
	if validatedAttachmentContentType([]byte("%PDF-1.7\nfixture")) != "application/pdf" {
		t.Fatal("PDF MIME was not derived from the bytes")
	}
}

func TestAttachmentReauthorizesTransferAfterReceiptPreparation(t *testing.T) {
	actor, input, receipt := attachmentUploadTestInput()
	fixture := newAttachmentUploadFixture()
	operations := fixture.operations()
	begin := operations.begin
	operations.begin = func(ctx context.Context) (pgx.Tx, error) {
		tx, err := begin(ctx)
		if fixture.beginCount == 2 {
			fixture.owner = "20000000-0000-4000-8000-000000000002"
		}
		return tx, err
	}
	_, err := runAttachmentUpload(context.Background(), actor, input, []byte("fixture"), "application/pdf", receipt, leadAttachmentColumns{}, operations)
	if !errors.Is(err, tenant.ErrOrganizationAccessDenied) || fixture.uploads != 0 || fixture.inserts != 0 || len(fixture.receipts) != 1 {
		t.Fatalf("transfer bypassed write authorization: err=%v uploads=%d inserts=%d receipts=%d", err, fixture.uploads, fixture.inserts, len(fixture.receipts))
	}
}

func TestAttachmentCleanupRechecksCompletedRetryAndActorNamespace(t *testing.T) {
	actor, _, receipt := attachmentUploadTestInput()
	fixture := newAttachmentUploadFixture()
	namespace := actor.OrganizationID + ":" + actor.UserID + ":" + receipt.key
	completed := receipt
	completed.attachmentID = attachmentTestID
	fixture.receipts[namespace] = completed
	tx := &attachmentUploadFixtureTx{fixture: fixture, changes: map[string]attachmentUploadReceipt{}}
	deletes := 0
	remove := func(context.Context, string) error { deletes++; return nil }
	if err := cleanupAttachmentUploadIfPending(context.Background(), tx, actor, receipt, remove); err != nil || deletes != 0 {
		t.Fatal("cleanup deleted a retry that already committed")
	}
	other := actor
	other.UserID = "20000000-0000-4000-8000-000000000002"
	if err := cleanupAttachmentUploadIfPending(context.Background(), tx, other, receipt, remove); err == nil || deletes != 0 {
		t.Fatal("cleanup crossed its actor namespace")
	}
	fixture.receipts[namespace] = receipt
	if err := cleanupAttachmentUploadIfPending(context.Background(), tx, actor, receipt, remove); err != nil || deletes != 1 {
		t.Fatal("confirmed pending object cannot be cleaned")
	}
}
