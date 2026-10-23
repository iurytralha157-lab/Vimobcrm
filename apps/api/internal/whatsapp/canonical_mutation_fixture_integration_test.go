package whatsapp

import (
	"context"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Admit with the real authenticated ingress and execute the production FIFO
// claim SQL, restricting its candidate session to this synthetic fixture.
// Caller owns session activation/token setup. No provenance is fabricated.
func claimCanonicalMutationFixture(t *testing.T, ctx context.Context, pool *pgxpool.Pool, repo Repository, envelope evolutionWebhookEnvelope) pendingEvolutionWebhook {
	t.Helper()
	receipt, err := repo.AcceptEvolutionWebhook(ctx, envelope)
	if err != nil || receipt.ID == "" || receipt.Inline {
		t.Fatalf("canonical synthetic mutation admission: %+v %v", receipt, err)
	}
	var lane string
	if err := pool.QueryRow(ctx, `select processing_lane from public.whatsapp_webhook_inbox where id=$1::uuid and session_id=$2::uuid`, receipt.ID, receipt.SessionID).Scan(&lane); err != nil {
		t.Fatal(err)
	}
	const candidateWhere = "where (nullif(btrim($3), '') is null or ws.id > nullif(btrim($3), '')::uuid)"
	if strings.Count(reserveEvolutionWebhookClaimSessionsQuery, candidateWhere) != 1 {
		t.Fatal("production claim candidate filter changed; review fixture scope")
	}
	query := strings.Replace(reserveEvolutionWebhookClaimSessionsQuery, candidateWhere, "where ws.id=$5::uuid and (nullif(btrim($3), '') is null or ws.id > nullif(btrim($3), '')::uuid)", 1)
	tx, err := pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		t.Fatal(err)
	}
	defer rollbackWebhookTx(tx)
	var reservedSession string
	if err := tx.QueryRow(ctx, query, 1, whatsappWebhookWorkerID, "", lane, receipt.SessionID).Scan(&reservedSession); err != nil || reservedSession != receipt.SessionID {
		t.Fatalf("canonical synthetic mutation session reservation: got=%s expected=%s error=%v", reservedSession, receipt.SessionID, err)
	}
	var item pendingEvolutionWebhook
	var payload string
	err = tx.QueryRow(ctx, claimReservedEvolutionWebhooksQuery, 1, whatsappWebhookWorkerID, "", lane, []string{reservedSession}).Scan(&item.ID, &item.OrganizationID, &item.SessionID, &item.InstanceID, &item.EventType, &item.WebhookToken, &payload, &item.Attempts, &item.MaxAttempts, &item.ProcessingLane, &item.ProcessingEpoch, &item.CreatedAt)
	if err != nil || item.ID != receipt.ID {
		t.Fatalf("canonical synthetic mutation FIFO claim: got=%s expected=%s error=%v", item.ID, receipt.ID, err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	item.Payload = []byte(payload)
	return item
}
