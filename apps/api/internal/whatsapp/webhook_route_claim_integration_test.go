package whatsapp

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

func TestWebhookRouteClaimLockedHeadAllowsIndependentSameSession(t *testing.T) {
	ctx, db := webhookDependencyDatabase(t)
	for _, lane := range []string{evolutionWebhookLaneLive, evolutionWebhookLaneBacklog} {
		t.Run(lane, func(t *testing.T) {
			f := newWebhookDependencyFixture(t, ctx, db, "route-lock-"+lane)
			root := insertWebhookDependencyEvent(t, ctx, db, f, webhookDependencyEvent{
				key: f.suffix + "-root", providerID: "root", route: "jid:blocked", lane: lane, epoch: 1, age: 3 * time.Minute})
			successor := insertWebhookDependencyEvent(t, ctx, db, f, webhookDependencyEvent{
				key: f.suffix + "-successor", providerID: "successor", route: "jid:blocked", lane: lane, epoch: 1, age: 2 * time.Minute})
			neighbor := insertWebhookDependencyEvent(t, ctx, db, f, webhookDependencyEvent{
				key: f.suffix + "-neighbor", providerID: "neighbor", route: "jid:independent", lane: lane, epoch: 1, age: time.Minute})
			blocker, err := db.Pool().Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer rollbackWebhookTx(blocker)
			if _, err := blocker.Exec(ctx, `select id from public.whatsapp_webhook_inbox where id=$1::uuid for update`, root); err != nil {
				t.Fatal(err)
			}
			items, _, err := NewRepository(db, nil, StorageConfig{}).claimEvolutionWebhooksForLane(ctx, lane, 1, "")
			if err != nil || len(items) != 1 || items[0].ID != neighbor {
				t.Fatalf("locked route hid independent same-session head: items=%#v error=%v", items, err)
			}
			for _, id := range []string{root, successor} {
				assertRouteClaimState(t, ctx, db.Pool(), id, "pending", 0)
			}
		})
	}
}

func TestWebhookRouteClaimNativeSharedFenceAllowsIndependentSameSession(t *testing.T) {
	ctx, db := webhookDependencyDatabase(t)
	for _, lanes := range []struct {
		name, active, candidate, activeRoute string
		canAdvance                           bool
	}{
		{"live_live", evolutionWebhookLaneLive, evolutionWebhookLaneLive, "jid:blocked", true},
		{"backlog_backlog", evolutionWebhookLaneBacklog, evolutionWebhookLaneBacklog, "jid:blocked", true},
		{"live_backlog", evolutionWebhookLaneLive, evolutionWebhookLaneBacklog, "jid:blocked", true},
		{"backlog_live", evolutionWebhookLaneBacklog, evolutionWebhookLaneLive, "jid:blocked", true},
		{"session_fence_live", evolutionWebhookLaneBacklog, evolutionWebhookLaneLive, "__session__", false},
		{"session_fence_backlog", evolutionWebhookLaneLive, evolutionWebhookLaneBacklog, "__session__", false},
	} {
		t.Run(lanes.name, func(t *testing.T) {
			f := newWebhookDependencyFixture(t, ctx, db, "route-native-share-"+lanes.name)
			root := insertWebhookDependencyEvent(t, ctx, db, f, webhookDependencyEvent{
				key: f.suffix + "-processing", providerID: "processing", route: lanes.activeRoute, lane: lanes.active,
				epoch: 1, age: 3 * time.Minute})
			if _, err := db.Pool().Exec(ctx, `update public.whatsapp_webhook_inbox set status='processing',locked_by=$2,locked_at=now() where id=$1::uuid`, root, whatsappWebhookWorkerID); err != nil {
				t.Fatal(err)
			}
			successor := insertWebhookDependencyEvent(t, ctx, db, f, webhookDependencyEvent{
				key: f.suffix + "-successor", providerID: "successor", route: "jid:blocked", lane: lanes.candidate,
				epoch: 1, age: 2 * time.Minute})
			neighbor := insertWebhookDependencyEvent(t, ctx, db, f, webhookDependencyEvent{
				key: f.suffix + "-neighbor", providerID: "neighbor", route: "jid:independent", lane: lanes.candidate,
				epoch: 1, age: time.Minute})
			native, err := db.Pool().Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer rollbackWebhookTx(native)
			if _, err := native.Exec(ctx, `select id from public.whatsapp_sessions where id=$1::uuid for share;
		select id from public.whatsapp_webhook_inbox where id=$2::uuid for update`, f.sessionID, root); err != nil {
				t.Fatal(err)
			}
			items, _, err := NewRepository(db, nil, StorageConfig{}).claimEvolutionWebhooksForLane(ctx, lanes.candidate, 1, "")
			if err != nil {
				t.Fatal(err)
			}
			if lanes.canAdvance {
				if len(items) != 1 || items[0].ID != neighbor {
					t.Fatalf("native SHARE fence blocked independent route: items=%#v error=%v", items, err)
				}
			} else if len(items) != 0 {
				t.Fatal("active session-wide effect did not fence all routes across lanes")
			}
			assertRouteClaimState(t, ctx, db.Pool(), successor, "pending", 0)
		})
	}
}

func TestWebhookRouteClaimOldNewSessionFencesRemainCompatible(t *testing.T) {
	ctx, db := webhookDependencyDatabase(t)
	f := newWebhookDependencyFixture(t, ctx, db, "route-rolling-fence")
	id := insertWebhookDependencyEvent(t, ctx, db, f, webhookDependencyEvent{
		key: f.suffix + "-head", providerID: "head", route: "jid:head", lane: evolutionWebhookLaneLive, epoch: 1, age: time.Minute})
	old, err := db.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer rollbackWebhookTx(old)
	if _, err := old.Exec(ctx, `select id from public.whatsapp_sessions where id=$1::uuid for no key update`, f.sessionID); err != nil {
		t.Fatal(err)
	}
	repo := NewRepository(db, nil, StorageConfig{})
	items, _, err := repo.claimEvolutionWebhooksForLane(ctx, evolutionWebhookLaneLive, 1, "")
	if err != nil || len(items) != 0 {
		t.Fatalf("new claimant raced old exclusive session claimant: %#v/%v", items, err)
	}
	rollbackWebhookTx(old)
	current, err := db.Pool().BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		t.Fatal(err)
	}
	defer rollbackWebhookTx(current)
	reserved, err := reserveEvolutionWebhookClaimSessions(ctx, current, 1, "", evolutionWebhookLaneLive)
	if err != nil || len(reserved) != 1 || reserved[0] != f.sessionID {
		t.Fatalf("reserve current claimant=%#v/%v", reserved, err)
	}
	probe, err := db.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer rollbackWebhookTx(probe)
	var session string
	if err := probe.QueryRow(ctx, `select id::text from public.whatsapp_sessions where id=$1::uuid for no key update skip locked`, f.sessionID).Scan(&session); err != pgx.ErrNoRows {
		t.Fatalf("old claimant did not respect new shared claim fence: %v", err)
	}
	other, err := reserveEvolutionWebhookClaimSessions(ctx, probe, 1, "", evolutionWebhookLaneLive)
	if err != nil || len(other) != 0 {
		t.Fatalf("new replica did not respect exact short mutex: %#v/%v", other, err)
	}
	assertRouteClaimState(t, ctx, db.Pool(), id, "pending", 0)
}

func TestWebhookRouteClaimFreshStatementSeesCommittedOtherLaneLease(t *testing.T) {
	ctx, db := webhookDependencyDatabase(t)
	f := newWebhookDependencyFixture(t, ctx, db, "route-fresh-snapshot")
	rootKey := f.suffix + "-root"
	root := insertWebhookDependencyEvent(t, ctx, db, f, webhookDependencyEvent{
		key: rootKey, providerID: "root", route: "jid:dependent", lane: evolutionWebhookLaneBacklog, epoch: 1, age: 3 * time.Minute})
	child := insertWebhookDependencyEvent(t, ctx, db, f, webhookDependencyEvent{
		key: f.suffix + "-child", providerID: "child", route: "jid:dependent", lane: evolutionWebhookLaneLive,
		predecessorKey: rootKey, predecessorProvider: "root", epoch: 1, age: 2 * time.Minute})
	neighbor := insertWebhookDependencyEvent(t, ctx, db, f, webhookDependencyEvent{
		key: f.suffix + "-neighbor", providerID: "neighbor", route: "jid:independent", lane: evolutionWebhookLaneLive,
		epoch: 1, age: time.Minute})
	reader, err := db.Pool().BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		t.Fatal(err)
	}
	defer rollbackWebhookTx(reader)
	if _, err := reader.Exec(ctx, `select id from public.whatsapp_webhook_inbox where session_id=$1::uuid`, f.sessionID); err != nil {
		t.Fatal(err)
	}
	claimed, _, err := NewRepository(db, nil, StorageConfig{}).claimEvolutionWebhooksForLane(ctx, evolutionWebhookLaneBacklog, 1, "")
	if err != nil || len(claimed) != 1 || claimed[0].ID != root {
		t.Fatalf("dependency root claim=%#v/%v", claimed, err)
	}
	items, err := claimEvolutionWebhooksInLaneSegment(ctx, reader, 1, "", evolutionWebhookLaneLive)
	if err != nil || len(items) != 1 || items[0].ID != neighbor {
		t.Fatalf("new statement did not see committed cross-lane lease: %#v/%v", items, err)
	}
	assertRouteClaimState(t, ctx, db.Pool(), child, "pending", 0)
}

func TestWebhookRouteClaimConcurrentReplicasKeepCrossLaneDependency(t *testing.T) {
	t.Run("short_mutex_contention", testWebhookRouteClaimShortMutexContention)
	ctx, db := webhookDependencyDatabase(t)
	for attempt := range 8 {
		t.Run(fmt.Sprintf("race_%d", attempt), func(t *testing.T) {
			f := newWebhookDependencyFixture(t, ctx, db, fmt.Sprintf("route-lane-race-%d", attempt))
			rootKey := f.suffix + "-root"
			root := insertWebhookDependencyEvent(t, ctx, db, f, webhookDependencyEvent{
				key: rootKey, providerID: "root", route: "jid:dependent", lane: evolutionWebhookLaneBacklog, epoch: 1, age: 2 * time.Minute})
			child := insertWebhookDependencyEvent(t, ctx, db, f, webhookDependencyEvent{
				key: f.suffix + "-child", providerID: "child", route: "jid:dependent", lane: evolutionWebhookLaneLive,
				predecessorKey: rootKey, predecessorProvider: "root", epoch: 1, age: time.Minute})
			repo := NewRepository(db, nil, StorageConfig{})
			items := concurrentWebhookRouteClaims(t, ctx, repo)
			// try-lock/SKIP LOCKED make this round nonblocking. A live
			// reservation with no eligible head can retain the session mutex
			// while both backlog replicas try it, so all four may return empty.
			// Every claim transaction has ended after the goroutines join: one
			// further backlog pass must now make progress, without a retry loop.
			next, _, err := repo.claimEvolutionWebhooksForLane(ctx, evolutionWebhookLaneBacklog, 1, "")
			if err != nil {
				t.Fatal(err)
			}
			items = append(items, next...)
			for _, item := range items {
				if item.ID != root {
					t.Fatalf("cross-lane worker bypassed exact dependency: %s", item.ID)
				}
			}
			if len(items) != 1 {
				t.Fatalf("exact root got %d leases across concurrent and uncontended passes, want one", len(items))
			}
			assertRouteClaimState(t, ctx, db.Pool(), root, "processing", 1)
			assertRouteClaimState(t, ctx, db.Pool(), child, "pending", 0)
		})
	}
}

func TestWebhookRouteClaimDeferredAndDeadRoutesKeepExactBarriers(t *testing.T) {
	ctx, db := webhookDependencyDatabase(t)
	for _, status := range []string{"retry", "dead", "session-control"} {
		t.Run(status, func(t *testing.T) {
			f := newWebhookDependencyFixture(t, ctx, db, "route-barrier-"+status)
			rootKey := f.suffix + "-root"
			route, rootStatus := "jid:blocked", status
			if status == "session-control" {
				route, rootStatus = "__session__", "retry"
			}
			root := insertWebhookDependencyEvent(t, ctx, db, f, webhookDependencyEvent{
				key: rootKey, providerID: "root", route: route, lane: evolutionWebhookLaneBacklog,
				status: rootStatus, due: time.Hour, epoch: 1, age: 3 * time.Minute})
			child := insertWebhookDependencyEvent(t, ctx, db, f, webhookDependencyEvent{
				key: f.suffix + "-child", providerID: "child", route: "jid:blocked", lane: evolutionWebhookLaneBacklog,
				predecessorKey: rootKey, predecessorProvider: "root", epoch: 1, age: 2 * time.Minute})
			neighbor := insertWebhookDependencyEvent(t, ctx, db, f, webhookDependencyEvent{
				key: f.suffix + "-neighbor", providerID: "neighbor", route: "jid:independent", lane: evolutionWebhookLaneBacklog,
				epoch: 1, age: time.Minute})
			items, _, err := NewRepository(db, nil, StorageConfig{}).claimEvolutionWebhooksForLane(ctx, evolutionWebhookLaneBacklog, 1, "")
			if err != nil {
				t.Fatal(err)
			}
			if status == "session-control" {
				if len(items) != 0 {
					t.Fatal("unclassified session-wide effect was bypassed without a durable narrower contract")
				}
			} else if status == "dead" {
				// Um predecessor dead-lettered nunca mais sera processado; mante-lo
				// como barreira congelava a corrente para sempre (producao parou com
				// 200 mil mortos). A morte conta como baixa e libera o sucessor, que
				// por FIFO e a cabeca mais antiga da sessao.
				if len(items) != 1 || items[0].ID != child {
					t.Fatalf("dead predecessor still vetoed its successor: %#v", items)
				}
			} else if len(items) != 1 || items[0].ID != neighbor {
				t.Fatalf("isolated deferred route hid independent head: %#v", items)
			}
			assertRouteClaimState(t, ctx, db.Pool(), root, rootStatus, 0)
			if status == "dead" {
				assertRouteClaimState(t, ctx, db.Pool(), child, "processing", 1)
			} else {
				assertRouteClaimState(t, ctx, db.Pool(), child, "pending", 0)
			}
		})
	}
	t.Run("live FIFO successor cannot veto its backlog prerequisite", func(t *testing.T) {
		f := newWebhookDependencyFixture(t, ctx, db, "route-priority-cycle")
		control := insertWebhookDependencyEvent(t, ctx, db, f, webhookDependencyEvent{
			key: f.suffix + "-control", eventType: "connected", route: "__session__", lane: evolutionWebhookLaneBacklog,
			epoch: 1, age: 4 * time.Minute, snapshots: []map[string]any{},
		})
		rootKey := f.suffix + "-root"
		root := insertWebhookDependencyEvent(t, ctx, db, f, webhookDependencyEvent{
			key: rootKey, providerID: "root", route: "jid:dependent", lane: evolutionWebhookLaneBacklog,
			epoch: 1, age: 3 * time.Minute,
		})
		live := insertWebhookDependencyEvent(t, ctx, db, f, webhookDependencyEvent{
			key: f.suffix + "-live", providerID: "live", route: "jid:dependent", lane: evolutionWebhookLaneLive,
			predecessorKey: rootKey, predecessorProvider: "root", epoch: 1, age: 2 * time.Minute,
		})
		receipt := insertWebhookDependencyEvent(t, ctx, db, f, webhookDependencyEvent{
			key: f.suffix + "-receipt", eventType: "receipt", route: "jid:dependent", lane: evolutionWebhookLaneLive,
			epoch: 1, age: time.Minute, snapshots: []map[string]any{},
		})
		repo := NewRepository(db, nil, StorageConfig{})
		if claimed, _, err := repo.claimEvolutionWebhooksForLane(ctx, evolutionWebhookLaneLive, 1, ""); err != nil || len(claimed) != 0 {
			t.Fatalf("live claim bypassed the dependency or FIFO: %#v / %v", claimed, err)
		}
		claimed, _, err := repo.claimEvolutionWebhooksForLane(ctx, evolutionWebhookLaneBacklog, 1, "")
		if err != nil || len(claimed) != 1 || claimed[0].ID != control {
			t.Fatalf("unclaimable live successor vetoed its exact session prerequisite: %#v / %v", claimed, err)
		}
		assertRouteClaimState(t, ctx, db.Pool(), control, "processing", 1)
		for _, id := range []string{root, live, receipt} {
			assertRouteClaimState(t, ctx, db.Pool(), id, "pending", 0)
		}
	})
	t.Run("pairing acknowledgement completes without connection or routing effects", func(t *testing.T) {
		f := newWebhookDependencyFixture(t, ctx, db, "route-pair-control")
		id := insertWebhookDependencyEvent(t, ctx, db, f, webhookDependencyEvent{
			key: f.suffix + "-pair", eventType: "pairsuccess", route: "__session__", lane: evolutionWebhookLaneBacklog,
			epoch: 1, age: time.Minute, withoutLedger: true,
			snapshots: []map[string]any{{"provider_message_id": "synthetic-pair-jid", "binding_eligible": false, "processing_epoch": 1}},
		})
		if _, err := db.Pool().Exec(ctx, `
			update public.whatsapp_sessions set status='disconnected' where id=$1::uuid`, f.sessionID); err != nil {
			t.Fatal(err)
		}
		if _, err := db.Pool().Exec(ctx, `
			update public.whatsapp_webhook_inbox
			set payload = payload || '{"event":"PairSuccess","data":{"ID":"5511999990001@s.whatsapp.net","LID":"1000000001@lid","BusinessName":"Synthetic","Platform":"android","jid":"5511999990001:1@s.whatsapp.net","status":"open"}}'::jsonb
			where id=$1::uuid`, id); err != nil {
			t.Fatal(err)
		}
		repo := NewRepository(db, nil, StorageConfig{})
		claimed, _, err := repo.claimEvolutionWebhooksForLane(ctx, evolutionWebhookLaneBacklog, 1, "")
		if err != nil || len(claimed) != 1 || claimed[0].ID != id {
			t.Fatalf("pairing control claim: %#v / %v", claimed, err)
		}
		if err := repo.processClaimedEvolutionWebhook(ctx, claimed[0]); err != nil {
			t.Fatal(err)
		}
		assertRouteClaimState(t, ctx, db.Pool(), id, "processed", 1)
		var status string
		var outcomes int
		if err := db.Pool().QueryRow(ctx, `
			select status, (select count(*)::int from public.whatsapp_webhook_routing_outcomes where session_id=$1::uuid)
			from public.whatsapp_sessions where id=$1::uuid`, f.sessionID).Scan(&status, &outcomes); err != nil ||
			status != "disconnected" || outcomes != 0 {
			t.Fatalf("pairing acknowledgement mutated session or routing: status=%q outcomes=%d err=%v", status, outcomes, err)
		}
	})
}

type routeClaimRowReader interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

func assertRouteClaimState(t *testing.T, ctx context.Context, db routeClaimRowReader, id, want string, wantAttempts int) {
	t.Helper()
	var state string
	var attempts int
	if err := db.QueryRow(ctx, `select status,attempts from public.whatsapp_webhook_inbox where id=$1::uuid`, id).Scan(&state, &attempts); err != nil {
		t.Fatal(err)
	}
	if state != want || attempts != wantAttempts {
		t.Fatalf("route head state=%s/%d, want %s/%d", state, attempts, want, wantAttempts)
	}
}
