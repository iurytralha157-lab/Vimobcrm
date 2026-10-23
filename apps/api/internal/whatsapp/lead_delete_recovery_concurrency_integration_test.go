package whatsapp

import (
	"context"
	"testing"
	"time"

	leadsrepo "github.com/vimob-crm/vimob-crm/apps/api/internal/leads"
)

func TestLocalLeadDeleteLetsOutboxRecoveryFinishLeadFK(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	db := openLocalOutboundDatabase(t, ctx)
	repo := NewRepository(db, nil, StorageConfig{})
	f := outboundHardeningFixture(t, ctx, db, repo, "delete-recovery-order")
	queued := queueHardeningMessage(t, ctx, repo, f, sendMessageInput{Text: "Synthetic recovery FK", ClientMessageID: f.suffix + "-intent"})
	holder, err := db.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer holder.Rollback(ctx)
	var id string
	if err := holder.QueryRow(ctx, `select id::text from public.whatsapp_outbox where message_id=$1::uuid for update`, queued.Message.ID).Scan(&id); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() { done <- leadsrepo.NewRepository(db, nil).Delete(ctx, f.tenant, f.leadID) }()
	waitForSessionConversationBlockedQuery(t, ctx, db.Pool(), "select queued.id from public.whatsapp_outbox")
	// This is the real FK reference that terminal delivery notification inserts
	// require. It must remain available while delete waits for the outbox holder.
	probeCtx, probeCancel := context.WithTimeout(ctx, 2*time.Second)
	defer probeCancel()
	if err := holder.QueryRow(probeCtx, `select id::text from public.leads where id=$1::uuid for key share`, f.leadID).Scan(&id); err != nil {
		t.Fatalf("lead deletion inverted recovery's outbox -> lead FK order: %v", err)
	}
	if err := holder.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		if err != nil {
			t.Fatal(err)
		}
	case <-ctx.Done():
		t.Fatal("lead delete did not finish after recovery released outbox")
	}
	var outbox, message string
	if err := db.Pool().QueryRow(ctx, `select queued.status,message.status from public.whatsapp_outbox queued join public.whatsapp_messages message on message.id=queued.message_id where message.id=$1::uuid`, queued.Message.ID).Scan(&outbox, &message); err != nil || outbox != "failed" || message != "failed" {
		t.Fatalf("recovered deletion left queue %s/%s: %v", outbox, message, err)
	}
}
