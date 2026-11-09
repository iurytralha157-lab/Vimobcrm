package whatsapp

import (
	"encoding/json"
	"testing"
	"time"
)

// The rows below model scheduler metadata only. No event is dispatched, no
// message/outcome is fabricated, and both EXPLAIN writes roll back. Timings
// describe this synthetic database; they are not production latency targets.
func TestWebhookRouteClaimSyntheticThousandRoutePlanStaysBounded(t *testing.T) {
	ctx, db := webhookDependencyDatabase(t)
	f := newWebhookDependencyFixture(t, ctx, db, "route-1000-plan")
	if _, err := db.Pool().Exec(ctx, `
		insert into public.whatsapp_webhook_inbox (
		  organization_id,session_id,event_key,event_type,provider,payload,
		  processing_epoch,processing_lane,status,next_attempt_at,created_at
		)
		select $1::uuid,$2::uuid,$3||'-'||n::text,'message','evolution_go',
		  jsonb_build_object('__vimob_ingress',jsonb_build_object(
		    'epoch_capable',true,'routing_key','jid:synthetic-route-'||n::text,
		    'routing_snapshot',jsonb_build_object('version',1,'messages','[]'::jsonb)
		  )),1,'backlog','pending',now()-interval '1 minute',now()-n*interval '1 second'
		from generate_series(1,1000) as series(n)
	`, f.organizationID, f.sessionID, f.suffix); err != nil {
		t.Fatal(err)
	}
	tx, err := db.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer rollbackWebhookTx(tx)
	if _, err := tx.Exec(ctx, `set local statement_timeout='5s';set local lock_timeout='2s'`); err != nil {
		t.Fatal(err)
	}
	for _, phase := range []struct {
		name, query string
		args        []any
	}{
		{"reservation", reserveEvolutionWebhookClaimSessionsQuery, []any{1, whatsappWebhookWorkerID, "", evolutionWebhookLaneBacklog}},
		{"fresh_claim", claimReservedEvolutionWebhooksQuery, []any{1, whatsappWebhookWorkerID, "", evolutionWebhookLaneBacklog, []string{f.sessionID}}},
	} {
		var encoded []byte
		if err := tx.QueryRow(ctx, "explain (analyze,buffers,format json) "+phase.query, phase.args...).Scan(&encoded); err != nil {
			t.Fatalf("bounded %s plan: %v", phase.name, err)
		}
		var plan []struct {
			Planning  float64 `json:"Planning Time"`
			Execution float64 `json:"Execution Time"`
			Plan      struct {
				Rows   float64 `json:"Actual Rows"`
				Hits   int64   `json:"Shared Hit Blocks"`
				Reads  int64   `json:"Shared Read Blocks"`
				Writes int64   `json:"Shared Written Blocks"`
			} `json:"Plan"`
		}
		if err := json.Unmarshal(encoded, &plan); err != nil || len(plan) != 1 {
			t.Fatalf("decode %s plan: %v", phase.name, err)
		}
		if plan[0].Plan.Rows != 1 {
			t.Fatalf("%s lost its exact eligible head: rows=%g", phase.name, plan[0].Plan.Rows)
		}
		t.Logf("synthetic1000 phase=%s planning_ms=%.3f execution_ms=%.3f hits=%d reads=%d writes=%d",
			phase.name, plan[0].Planning, plan[0].Execution, plan[0].Plan.Hits, plan[0].Plan.Reads, plan[0].Plan.Writes)
	}
	rollbackWebhookTx(tx)
	var pending, processing int
	if err := db.Pool().QueryRow(ctx, `select count(*)filter(where status='pending'),count(*)filter(where status='processing')
		from public.whatsapp_webhook_inbox where session_id=$1::uuid`, f.sessionID).Scan(&pending, &processing); err != nil {
		t.Fatal(err)
	}
	if pending != 1000 || processing != 0 {
		t.Fatalf("EXPLAIN rollback left changed queue rows: pending=%d processing=%d", pending, processing)
	}
}

func TestWebhookRouteClaimBacklogBoundPreservesOlderRoutes(t *testing.T) {
	ctx, db := webhookDependencyDatabase(t)
	f := newWebhookDependencyFixture(t, ctx, db, "route-session-bound-plan")
	older := insertWebhookDependencyEvent(t, ctx, db, f, webhookDependencyEvent{
		key: f.suffix + "-before-barrier", route: "jid:before", lane: evolutionWebhookLaneBacklog,
		epoch: 1, age: 4 * time.Hour, snapshots: []map[string]any{},
	})
	barrier := insertWebhookDependencyEvent(t, ctx, db, f, webhookDependencyEvent{
		key: f.suffix + "-barrier", eventType: "connected", route: "__session__", lane: evolutionWebhookLaneBacklog,
		status: "retry", due: time.Hour, epoch: 1, age: 3 * time.Hour, snapshots: []map[string]any{},
	})
	const successors = 6000
	if _, err := db.Pool().Exec(ctx, `
		insert into public.whatsapp_webhook_inbox (
		  organization_id,session_id,event_key,event_type,provider,payload,
		  processing_epoch,processing_lane,status,next_attempt_at,created_at
		)
		select $1::uuid,$2::uuid,$3||'-'||n::text,'message','evolution_go',
		  jsonb_build_object('__vimob_ingress',jsonb_build_object(
		    'epoch_capable',true,'routing_key','jid:synthetic-route-'||n::text,
		    'routing_snapshot',jsonb_build_object('version',1,'messages','[]'::jsonb)
		  )),1,'backlog','pending',now()-interval '1 minute',now()-n*interval '1 second'
		from generate_series(1,$4::int) as series(n)
	`, f.organizationID, f.sessionID, f.suffix, successors); err != nil {
		t.Fatal(err)
	}
	repo := NewRepository(db, nil, StorageConfig{})
	claimed, _, err := repo.claimEvolutionWebhooksForLane(ctx, evolutionWebhookLaneBacklog, 1, "")
	if err != nil || len(claimed) != 1 || claimed[0].ID != older {
		t.Fatalf("an independent earlier route must remain claimable: %#v / %v", claimed, err)
	}
	if err := repo.markEvolutionWebhookProcessed(ctx, claimed[0]); err != nil {
		t.Fatal(err)
	}
	assertPlans := func(t *testing.T, expectedRows float64) {
		t.Helper()
		for _, phase := range []struct {
			name, query string
			args        []any
		}{
			{"reservation", reserveEvolutionWebhookClaimSessionsQuery, []any{1, whatsappWebhookWorkerID, "", evolutionWebhookLaneBacklog}},
			{"fresh_claim", claimReservedEvolutionWebhooksQuery, []any{1, whatsappWebhookWorkerID, "", evolutionWebhookLaneBacklog, []string{f.sessionID}}},
		} {
			tx, err := db.Pool().Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := tx.Exec(ctx, `set local statement_timeout='5s';set local lock_timeout='2s'`); err != nil {
				rollbackWebhookTx(tx)
				t.Fatal(err)
			}
			var encoded []byte
			err = tx.QueryRow(ctx, "explain (analyze,buffers,timing off,format json) "+phase.query, phase.args...).Scan(&encoded)
			rollbackWebhookTx(tx)
			if err != nil {
				t.Fatalf("%s plan: %v", phase.name, err)
			}
			var plan []struct {
				Execution float64 `json:"Execution Time"`
				Plan      struct {
					Rows  float64 `json:"Actual Rows"`
					Hits  int64   `json:"Shared Hit Blocks"`
					Reads int64   `json:"Shared Read Blocks"`
				} `json:"Plan"`
			}
			if err := json.Unmarshal(encoded, &plan); err != nil || len(plan) != 1 || plan[0].Plan.Rows != expectedRows {
				t.Fatalf("%s must return %.0f rows: %s / %v", phase.name, expectedRows, encoded, err)
			}
			t.Logf("backlog%d phase=%s execution_ms=%.3f hits=%d reads=%d", successors, phase.name, plan[0].Execution, plan[0].Plan.Hits, plan[0].Plan.Reads)
		}
	}
	t.Run("session_barrier", func(t *testing.T) { assertPlans(t, 0) })
	assertRouteClaimState(t, ctx, db.Pool(), barrier, "retry", 0)
	if _, err := db.Pool().Exec(ctx, `delete from public.whatsapp_webhook_inbox where id=$1::uuid`, barrier); err != nil {
		t.Fatal(err)
	}
	t.Run("no_session_barrier", func(t *testing.T) { assertPlans(t, 1) })
	var pending int
	if err := db.Pool().QueryRow(ctx, `select count(*)::int from public.whatsapp_webhook_inbox
		where session_id=$1::uuid and status='pending' and attempts=0`, f.sessionID).Scan(&pending); err != nil || pending != successors {
		t.Fatalf("backlog successors changed across EXPLAIN rollbacks: count=%d err=%v", pending, err)
	}
}
