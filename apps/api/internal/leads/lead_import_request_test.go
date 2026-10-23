package leads

import (
	"context"
	"errors"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type importReceiptTestTx struct {
	pgx.Tx
	receipt     leadImportReceipt
	digest      string
	inserted    bool
	execError   error
	updateError error
	commitError error
	leadRow     pgx.Row
	sequence    []string
	args        [][]any
}
type importReceiptTestRow struct{ tx *importReceiptTestTx }

func (row importReceiptTestRow) Scan(dest ...any) error {
	*dest[0].(*string) = row.tx.digest
	*dest[1].(*pgtype.Text) = pgtype.Text{String: row.tx.receipt.LeadID, Valid: row.tx.receipt.Completed}
	*dest[2].(*pgtype.Bool) = pgtype.Bool{Bool: row.tx.receipt.Reentry, Valid: row.tx.receipt.Completed}
	*dest[3].(*pgtype.Text) = pgtype.Text{String: string(row.tx.receipt.Outcome), Valid: row.tx.receipt.Completed}
	*dest[4].(*bool) = row.tx.receipt.Completed
	return nil
}
func (tx *importReceiptTestTx) Exec(_ context.Context, query string, args ...any) (pgconn.CommandTag, error) {
	tx.args = append(tx.args, args)
	if strings.Contains(query, "insert into private") {
		tx.sequence = append(tx.sequence, "claim")
		if tx.execError != nil {
			return pgconn.CommandTag{}, tx.execError
		}
		if tx.inserted {
			return pgconn.NewCommandTag("INSERT 0 1"), nil
		}
		return pgconn.NewCommandTag("INSERT 0 0"), nil
	}
	tx.sequence = append(tx.sequence, "complete")
	if tx.updateError != nil {
		return pgconn.CommandTag{}, tx.updateError
	}
	return pgconn.NewCommandTag("UPDATE 1"), nil
}
func (tx *importReceiptTestTx) QueryRow(_ context.Context, query string, args ...any) pgx.Row {
	tx.args = append(tx.args, args)
	if strings.Contains(query, "from private.contact_import") {
		tx.sequence = append(tx.sequence, "lock")
		return importReceiptTestRow{tx}
	}
	tx.sequence = append(tx.sequence, "snapshot")
	return tx.leadRow
}
func (tx *importReceiptTestTx) Commit(context.Context) error {
	tx.sequence = append(tx.sequence, "commit")
	return tx.commitError
}

func TestLeadImportRequestScopeDigestAndAmbiguousPendingFailClosed(t *testing.T) {
	ctx := context.Background()
	key := "99999999-9999-4999-8999-999999999999"
	input := createInput{ImportMode: true, ImportRequestKey: &key, Name: "Synthetic contact", Metadata: LeadMetadata{"b": 2, "a": 1}}
	digest, err := leadImportRequestDigest(input)
	if err != nil {
		t.Fatal(err)
	}
	input.Metadata = LeadMetadata{"a": 1, "b": 2}
	equivalent, _ := leadImportRequestDigest(input)
	if equivalent != digest {
		t.Fatal("map order changed canonical import digest")
	}
	input.Name = "Other input"
	different, _ := leadImportRequestDigest(input)
	if different == digest {
		t.Fatal("different payload reused an import digest")
	}
	for _, scope := range []tenant.Context{
		{OrganizationID: importDistributionOrganizationID, UserID: importDistributionActorID},
		{OrganizationID: "33333333-3333-4333-8333-333333333334", UserID: importDistributionActorID},
		{OrganizationID: importDistributionOrganizationID, UserID: "44444444-4444-4444-8444-444444444444"},
	} {
		tx := &importReceiptTestTx{inserted: true, digest: digest}
		if _, err := claimLeadImportRequest(ctx, tx, scope, &leadImportRequest{tx: tx, key: key, digest: digest}); err != nil {
			t.Fatal(err)
		}
		for _, args := range tx.args {
			if args[0] != scope.OrganizationID || args[1] != scope.UserID || args[2] != key {
				t.Fatal("receipt lookup crossed actor or organization")
			}
		}
	}
	for _, testCase := range []struct {
		name, digest string
		inserted     bool
		want         error
	}{
		{"payload conflict", different, false, ErrLeadImportRequestConflict},
		{"ambiguous pending record", digest, false, ErrLeadImportIdempotencyUnavailable},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			tx := &importReceiptTestTx{digest: testCase.digest, inserted: testCase.inserted}
			_, err := claimLeadImportRequest(ctx, tx, tenant.Context{OrganizationID: importDistributionOrganizationID, UserID: importDistributionActorID}, &leadImportRequest{tx: tx, key: key, digest: digest})
			if !errors.Is(err, testCase.want) {
				t.Fatalf("unsafe receipt error=%v want=%v", err, testCase.want)
			}
			if strings.Join(tx.sequence, ",") != "claim,lock" {
				t.Fatal("receipt failure reached mutation/commit")
			}
		})
	}
	missing := &importReceiptTestTx{execError: &pgconn.PgError{Code: "42P01"}}
	if _, err := claimLeadImportRequest(ctx, missing, tenant.Context{}, &leadImportRequest{key: key, digest: digest}); !errors.Is(err, ErrLeadImportIdempotencyUnavailable) || strings.Join(missing.sequence, ",") != "claim" {
		t.Fatalf("missing storage did not stop before mutation: %v", err)
	}
}

func TestLeadImportLostResponseReplayKeepsReceiptAndCurrentVisibility(t *testing.T) {
	ctx := context.Background()
	viewer := tenant.Context{OrganizationID: creationOrganizationID, UserID: importDistributionActorID, Permissions: []string{permissions.LeadImport, permissions.LeadViewOwn}}
	key := "99999999-9999-4999-8999-999999999999"
	digest := strings.Repeat("a", 64)
	lead := creationFixture()
	first := &importReceiptTestTx{leadRow: leadCreationRow{lead: lead}}
	if _, err := commitLeadImportCreation(ctx, first, viewer, lead.ID, &leadImportRequest{tx: first, key: key, digest: digest}, false, CreateDistributionOutcomeAssigned); err != nil {
		t.Fatal(err)
	}
	if strings.Join(first.sequence, ",") != "snapshot,complete,commit" {
		t.Fatalf("receipt must complete in creation's commit: %v", first.sequence)
	}
	// Simulate the browser losing that success response, then manually retrying
	// the same operation after its assignee is no longer in the actor's scope.
	second := &importReceiptTestTx{digest: digest, receipt: leadImportReceipt{LeadID: lead.ID, Outcome: CreateDistributionOutcomeAssigned, Completed: true}, leadRow: leadCreationRow{lead: lead}}
	receipt, err := claimLeadImportRequest(ctx, second, viewer, &leadImportRequest{tx: second, key: key, digest: digest})
	if err != nil {
		t.Fatal(err)
	}
	result, err := replayLeadImportReceipt(ctx, second, viewer, receipt)
	if err != nil {
		t.Fatal(err)
	}
	response := createLeadResponse(viewer, result)
	if !result.Replayed || response.Data != nil || response.LeadVisible || response.LeadID != lead.ID {
		t.Fatal("lost response retry must give the existing restricted receipt")
	}
	if strings.Join(second.sequence, ",") != "claim,lock,snapshot,commit" {
		t.Fatalf("replay repeated a mutation: %v", second.sequence)
	}
	deleted := &importReceiptTestTx{leadRow: leadCreationRow{err: pgx.ErrNoRows}}
	deletedResult, err := replayLeadImportReceipt(ctx, deleted, viewer, receipt)
	if err != nil {
		t.Fatal(err)
	}
	admin := viewer
	admin.MemberRole = "admin"
	if !deletedResult.ReceiptOnly || createLeadResponse(admin, deletedResult).Data != nil {
		t.Fatal("deleted completed lead must not be recreated or returned as fake data")
	}
	// A replay uses the current resource scope; it cannot preserve an obsolete
	// authorization decision from when the request originally completed.
	currentOwner := viewer
	currentOwner.UserID = lead.AssignedUserID
	if createLeadResponse(currentOwner, result).Data == nil {
		t.Fatal("current owner must be able to read the confirmed replay")
	}
	foreign := currentOwner
	foreign.OrganizationID = "99999999-9999-4999-8999-999999999999"
	foreignResponse := createLeadResponse(foreign, result)
	if foreignResponse.Data != nil || foreignResponse.LeadID != "" {
		t.Fatal("replay result crossed organizations")
	}
}

func TestLeadImportReceiptFailuresNeverCommit(t *testing.T) {
	ctx := context.Background()
	viewer := tenant.Context{OrganizationID: creationOrganizationID, UserID: importDistributionActorID}
	for _, tx := range []*importReceiptTestTx{
		{leadRow: leadCreationRow{err: errors.New("synthetic read failure")}},
		{leadRow: leadCreationRow{lead: creationFixture()}, updateError: errors.New("synthetic receipt write failure")},
	} {
		if _, err := commitLeadImportCreation(ctx, tx, viewer, creationLeadID, &leadImportRequest{tx: tx, key: "99999999-9999-4999-8999-999999999999", digest: strings.Repeat("a", 64)}, true, CreateDistributionOutcomeReentryPreserved); err == nil {
			t.Fatal("failed snapshot/receipt acknowledged success")
		}
		for _, phase := range tx.sequence {
			if phase == "commit" {
				t.Fatal("failed receipt committed business mutation")
			}
		}
	}
	if _, err := (Repository{}).Create(ctx, tenant.Context{OrganizationID: creationOrganizationID, UserID: importDistributionActorID}, createInput{ImportMode: true, ImportRequestKey: stringPointer("99999999-9999-4999-8999-999999999999")}); !errors.Is(err, tenant.ErrOrganizationAccessDenied) {
		t.Fatalf("revoked import permission reached receipt DB: %v", err)
	}
	if _, err := (CreateRequest{Name: "Synthetic contact", ImportRequestKey: "99999999-9999-4999-8999-999999999999"}).Validate(); err == nil {
		t.Fatal("manual creation accepted an import request key")
	}
}

func TestLeadImportReceiptSchemaRejectsNullCompletedOutcome(t *testing.T) {
	raw, err := os.ReadFile("../../../../supabase/migrations/20261012224034_add_contact_import_request_receipts.sql")
	if err != nil {
		t.Fatal(err)
	}
	source := strings.Join(strings.Fields(string(raw)), " ")
	for _, required := range []string{"reentry is not null and distribution_outcome is not null", "primary key (organization_id, actor_id, request_key)", "enable row level security", "from public, anon, authenticated, service_role"} {
		if !strings.Contains(source, required) {
			t.Fatalf("receipt schema lacks %q", required)
		}
	}
}
