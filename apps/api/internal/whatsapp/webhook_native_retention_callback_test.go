package whatsapp

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

type nativeDeletionRetentionTx struct {
	pgx.Tx
	target    nativeEvolutionLockedMessageTarget
	execCalls int
}

func (tx *nativeDeletionRetentionTx) Query(_ context.Context, sql string, _ ...any) (pgx.Rows, error) {
	for _, predicate := range []string{
		"message.lead_id is null",
		"conversation.lead_id is null",
		"not coalesce(conversation.is_group, false)",
		"conversation.retired_at is not null",
		"conversation.created_at <= clock_timestamp() - interval '7 days'",
		"message.unlinked_retention_scrubbed_at is not null",
	} {
		if !strings.Contains(sql, predicate) {
			return nil, fmt.Errorf("deletion target lock lacks retention predicate %q", predicate)
		}
	}
	return &nativeDeletionRetentionRows{target: tx.target}, nil
}

func (tx *nativeDeletionRetentionTx) Exec(_ context.Context, _ string, _ ...any) (pgconn.CommandTag, error) {
	tx.execCalls++
	return pgconn.NewCommandTag("UPDATE 1"), nil
}

type nativeDeletionRetentionRows struct {
	pgx.Rows
	target nativeEvolutionLockedMessageTarget
	read   bool
}

func (rows *nativeDeletionRetentionRows) Next() bool {
	if rows.read {
		return false
	}
	rows.read = true
	return true
}

func (rows *nativeDeletionRetentionRows) Scan(dest ...any) error {
	if len(dest) != 9 {
		return fmt.Errorf("deletion target lock returned %d fields, want 9", len(dest))
	}
	*dest[0].(*string) = rows.target.ID
	*dest[1].(*string) = rows.target.ConversationID
	*dest[2].(*string) = rows.target.LeadID
	*dest[3].(*string) = rows.target.MessageID
	*dest[4].(*string) = rows.target.ProviderMessageID
	*dest[5].(*string) = rows.target.ClientMessageID
	*dest[6].(**time.Time) = rows.target.SentAt
	*dest[7].(*string) = rows.target.CaptureState
	*dest[8].(*bool) = rows.target.ExpiredUnlinked
	return nil
}

func (*nativeDeletionRetentionRows) Err() error { return nil }
func (*nativeDeletionRetentionRows) Close()     {}

func TestNativeDeletionSkipsExpiredUnlinkedTombstoneWithoutMutatingLeadHistory(t *testing.T) {
	sentAt := time.Now().UTC()
	for _, test := range []struct {
		name         string
		captureState string
		leadID       string
		expired      bool
		wantWrites   int
	}{
		{name: "expired before scrub", captureState: "unlinked_ephemeral", expired: true},
		{name: "expired after scrub", captureState: "suppressed", expired: true},
		{name: "fresh without lead", captureState: "unlinked_ephemeral", wantWrites: 2},
		{name: "promoted lead history", captureState: "promoted_unlinked", leadID: "44444444-4444-4444-8444-444444444444", wantWrites: 2},
		{name: "ordinary lead history", captureState: "captured", leadID: "44444444-4444-4444-8444-444444444444", wantWrites: 2},
	} {
		t.Run(test.name, func(t *testing.T) {
			tx := &nativeDeletionRetentionTx{target: nativeEvolutionLockedMessageTarget{
				ID:                "33333333-3333-4333-8333-333333333333",
				ConversationID:    "22222222-2222-4222-8222-222222222222",
				LeadID:            test.leadID,
				MessageID:         "provider-target",
				ProviderMessageID: "provider-target",
				SentAt:            &sentAt,
				CaptureState:      test.captureState,
				ExpiredUnlinked:   test.expired,
			}}
			err := processNativeEvolutionDeletion(context.Background(), tx, nativeEvolutionSession{
				ID:             "11111111-1111-4111-8111-111111111111",
				OrganizationID: "55555555-5555-4555-8555-555555555555",
			}, nativeEvolutionMessage{ProviderMessageID: "provider-delete", DeletionTargetID: "provider-target"})
			if err != nil {
				t.Fatal(err)
			}
			if tx.execCalls != test.wantWrites {
				t.Fatalf("deletion writes = %d, want %d", tx.execCalls, test.wantWrites)
			}
		})
	}
}
