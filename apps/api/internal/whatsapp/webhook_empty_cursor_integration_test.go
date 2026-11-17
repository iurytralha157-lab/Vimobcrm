package whatsapp

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestWebhookEmptyFullPassResetsCursorWithoutBypassingDeferredHead(t *testing.T) {
	ctx, db := webhookDependencyDatabase(t)
	for _, lane := range []string{evolutionWebhookLaneLive, evolutionWebhookLaneBacklog} {
		t.Run(lane, func(t *testing.T) {
			f := newWebhookDependencyFixture(t, ctx, db, "empty-full-pass-"+lane)
			other := newWebhookDependencyFixture(t, ctx, db, "empty-full-pass-other-"+lane)
			head := insertWebhookDependencyEvent(t, ctx, db, f, webhookDependencyEvent{
				key: f.suffix + "-deferred", route: "__session__", lane: lane,
				status: "retry", due: time.Hour, epoch: 1, age: time.Hour,
				snapshots: []map[string]any{},
			})
			successor := insertWebhookDependencyEvent(t, ctx, db, f, webhookDependencyEvent{
				key: f.suffix + "-successor", route: "jid:independent-after-barrier", lane: lane,
				epoch: 1, age: 30 * time.Minute, snapshots: []map[string]any{},
			})
			// Exclude unrelated tenants in the owned fixture through the real
			// old/new session fence, without changing their rows.
			fence, err := db.Pool().Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer rollbackWebhookTx(fence)
			if _, err := fence.Exec(ctx, `select id from public.whatsapp_sessions
				where id<>$1::uuid order by id for no key update nowait`, f.sessionID); err != nil {
				t.Fatal(err)
			}
			repo := NewRepository(db, nil, StorageConfig{})
			items, cursor, err := repo.claimEvolutionWebhooksForLane(ctx, lane, 1, f.sessionID)
			if err != nil || len(items) != 0 || cursor != "" {
				t.Fatalf("empty wrapped pass: count=%d cursor_reset=%t error=%v", len(items), cursor == "", err)
			}
			assertRouteClaimState(t, ctx, db.Pool(), head, "retry", 0)
			assertRouteClaimState(t, ctx, db.Pool(), successor, "pending", 0)
			if shouldWrapEvolutionWebhookLaneClaim(cursor, 0) {
				t.Fatal("next empty pass would repeat an unnecessary cursor wrap")
			}
			canceled, cancel := context.WithCancel(ctx)
			cancel()
			if _, retained, err := repo.claimEvolutionWebhooksForLane(canceled, lane, 1, f.sessionID); !errors.Is(err, context.Canceled) || retained != f.sessionID {
				t.Fatalf("failed claim changed cursor: preserved=%t error=%v", retained == f.sessionID, err)
			}
			if _, err := db.Pool().Exec(ctx, `update public.whatsapp_webhook_inbox
				set next_attempt_at=now() where id=$1::uuid`, head); err != nil {
				t.Fatal(err)
			}
			items, cursor, err = repo.claimEvolutionWebhooksForLane(ctx, lane, 1, cursor)
			if err != nil || len(items) != 1 || items[0].ID != head || cursor != f.sessionID {
				t.Fatalf("successful claim retains cursor: count=%d correct_cursor=%t error=%v", len(items), cursor == f.sessionID, err)
			}
			assertRouteClaimState(t, ctx, db.Pool(), head, "processing", 1)
			assertRouteClaimState(t, ctx, db.Pool(), successor, "pending", 0)
			var foreignLeases, outcomes int
			if err := db.Pool().QueryRow(ctx, `select
				(select count(*)::int from public.whatsapp_webhook_inbox where organization_id=$1::uuid and status='processing'),
				(select count(*)::int from public.whatsapp_webhook_routing_outcomes where organization_id=any($2::uuid[]))`,
				other.organizationID, []string{f.organizationID, other.organizationID}).Scan(&foreignLeases, &outcomes); err != nil {
				t.Fatal(err)
			}
			if foreignLeases != 0 || outcomes != 0 {
				t.Fatalf("cursor reset changed another tenant or fabricated outcome: leases=%d outcomes=%d", foreignLeases, outcomes)
			}
		})
	}
}
