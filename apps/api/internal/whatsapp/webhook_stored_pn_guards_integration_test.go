package whatsapp

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func cleanupStoredPNBusiness(t *testing.T, db *dbpkg.Postgres, org string) {
	t.Helper()
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		defer cancel()
		for _, query := range []string{
			`delete from public.whatsapp_inbound_logs where organization_id=$1::uuid`,
			`delete from private.realtime_events where organization_id=$1::uuid`,
			`delete from private.notification_deliveries where organization_id=$1::uuid`,
			`delete from public.notifications where organization_id=$1::uuid`,
			`delete from public.whatsapp_messages where organization_id=$1::uuid`,
		} {
			if _, err := db.Pool().Exec(ctx, query, org); err != nil {
				t.Error(err)
			}
		}
	})
}

func TestStoredLIDPNCaptureSQLUsesPersistedEvidence(t *testing.T) {
	ctx, db := webhookDependencyDatabase(t)
	for _, aliasOnly := range []bool{false, true} {
		name := "stored-phone"
		if aliasOnly {
			name = "stored-alias"
		}
		t.Run(name, func(t *testing.T) {
			f := newWebhookDependencyFixture(t, ctx, db, name)
			const lid = "777777777000003@lid"
			const otherPN = "5511988881111@s.whatsapp.net"
			if _, err := db.Pool().Exec(ctx, `update public.whatsapp_conversations set remote_jid=$2 where id=$1::uuid`, f.conversationID, lid); err != nil {
				t.Fatal(err)
			}
			if aliasOnly {
				if _, err := db.Pool().Exec(ctx, `update public.whatsapp_conversations set contact_phone=null where id=$1::uuid;
				insert into public.whatsapp_contact_identity_aliases(organization_id,session_id,alias_jid,canonical_jid)
				values($2::uuid,$3::uuid,$4,$5) on conflict(organization_id,session_id,alias_jid) do update
				set canonical_jid=excluded.canonical_jid`, f.conversationID, f.organizationID, f.sessionID, f.remoteJID, lid); err != nil {
					t.Fatal(err)
				}
			}
			before := contactPNBusinessCounts(t, ctx, db.Pool(), f.organizationID)
			tx, err := db.Pool().Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			var snapshot string
			err = tx.QueryRow(ctx, `select private.capture_whatsapp_webhook_routing_snapshot_v2(
			 $1::uuid,$2::uuid,$3,$3,'live','phone:5511988881111',true,$4::text[],'5511988881111','organic',null,
			 false,false,false,null,null,null,1)::text`, f.organizationID, f.sessionID, f.suffix+"-capture", []string{lid, otherPN}).Scan(&snapshot)
			rollbackWebhookTx(tx)
			var guard *pgconn.PgError
			if !errorsAsPNGuard(err, &guard) {
				t.Fatalf("selected physical LID ignored persisted PN: error=%v snapshot=%s", err, snapshot)
			}
			if after := contactPNBusinessCounts(t, ctx, db.Pool(), f.organizationID); before != after {
				t.Fatalf("rejected capture changed business state: %v -> %v", before, after)
			}
			var count int
			if err := db.Pool().QueryRow(ctx, `select count(*) from public.whatsapp_webhook_routing_snapshots where organization_id=$1::uuid`, f.organizationID).Scan(&count); err != nil || count != 0 {
				t.Fatalf("rejected physical route retained a snapshot: %d/%v", count, err)
			}
		})
	}
}

func TestStoredLIDPNEvidencePreservesTenantAndPhoneVariants(t *testing.T) {
	ctx, db := webhookDependencyDatabase(t)
	f := newWebhookDependencyFixture(t, ctx, db, "stored-pn-variants")
	other := newWebhookDependencyFixture(t, ctx, db, "stored-pn-foreign")
	const lid = "777777777000004@lid"
	for _, c := range []struct{ name, pn, phone string }{
		{"BR8-9", "5511988881111@s.whatsapp.net", "551188881111"},
		{"BRnational", "5511988881111@s.whatsapp.net", "11988881111"},
		{"NANPbare", "14155552671@s.whatsapp.net", "14155552671"},
		{"NANPprefix", "14155552671@s.whatsapp.net", "+14155552671"},
	} {
		t.Run(c.name, func(t *testing.T) {
			tx, err := db.Pool().Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer rollbackWebhookTx(tx)
			var id string
			if err := tx.QueryRow(ctx, `insert into public.whatsapp_conversations(organization_id,session_id,remote_jid,contact_phone)
			values($1::uuid,$2::uuid,$3,$4) returning id::text`, f.organizationID, f.sessionID, lid, c.phone).Scan(&id); err != nil {
				t.Fatal(err)
			}
			if _, err := tx.Exec(ctx, `insert into public.whatsapp_contact_identity_aliases(organization_id,session_id,alias_jid,canonical_jid)
			 values($1::uuid,$2::uuid,'5511977772222@s.whatsapp.net',$3)`, other.organizationID, other.sessionID, lid); err != nil {
				t.Fatal(err)
			}
			var conflict bool
			if err := tx.QueryRow(ctx, `select private.whatsapp_contact_pns_conflict(array[$4]::text[] ||
			 private.whatsapp_conversation_contact_pn_evidence($1::uuid,$2::uuid,$3::uuid))`, f.organizationID, f.sessionID, id, c.pn).Scan(&conflict); err != nil || conflict {
				t.Fatalf("legitimate variant or foreign tenant contaminated the physical route: %t/%v", conflict, err)
			}
			if _, err := tx.Exec(ctx, `update public.whatsapp_conversations set remote_jid=$2 where id=$1::uuid`, id, c.pn); err != nil {
				t.Fatalf("legitimate opaque-to-PN promotion failed: %v", err)
			}
			if _, err := tx.Exec(ctx, `update public.whatsapp_conversations set contact_phone=null where id=$1::uuid`, id); err != nil {
				t.Fatalf("retention phone clearing failed: %v", err)
			}
		})
	}
}

func TestStoredLIDPNLateNativeQuarantineCompletesWithoutMessageEffects(t *testing.T) {
	ctx, db := webhookDependencyDatabase(t)
	f := newWebhookDependencyFixture(t, ctx, db, "stored-pn-late-native")
	cleanupStoredPNBusiness(t, db, f.organizationID)
	repo := NewRepository(db, nil, StorageConfig{})
	repo.functions.webhookProcessorMode = webhookProcessorNative
	if _, err := repo.JoinConversationAttendance(ctx, f.tenant, f.conversationID,
		attendanceInput{ExpectedLeadID: f.leadID, SendSessionID: f.sessionID}); err != nil {
		t.Fatal(err)
	}
	const lid = "777777777000005@lid"
	if _, err := db.Pool().Exec(ctx, `update public.whatsapp_sessions
	 set advanced_settings='{"token":"synthetic-stored-late","webhook_token":"synthetic-stored-hook"}'::jsonb where id=$1::uuid;
	 update public.whatsapp_conversations set remote_jid=$3,contact_phone=null where id=$2::uuid`, f.sessionID, f.conversationID, lid); err != nil {
		t.Fatal(err)
	}
	id := f.suffix + "-late-conflict"
	payload, _ := json.Marshal(map[string]any{"event": "message", "data": map[string]any{
		"Info":    map[string]any{"ID": id, "Chat": lid, "SenderPN": "5511988881111@s.whatsapp.net", "Timestamp": time.Now().UTC().Format(time.RFC3339Nano)},
		"Message": map[string]any{"conversation": "must remain durable technical evidence"}}})
	receipt, err := repo.AcceptEvolutionWebhook(ctx, evolutionWebhookEnvelope{SessionID: f.sessionID,
		InstanceToken: "synthetic-stored-late", WebhookHeaderTokens: []string{"synthetic-stored-hook"}, EventType: "message", Payload: payload, ReceivedAt: time.Now().UTC()})
	if err != nil {
		t.Fatal(err)
	}
	// A different legitimate PN is established after immutable admission. The
	// native processor must revalidate physical identity before aliases/capture.
	if _, err := db.Pool().Exec(ctx, `update public.whatsapp_conversations set contact_phone=$2 where id=$1::uuid`, f.conversationID, f.phone); err != nil {
		t.Fatal(err)
	}
	before := contactPNBusinessCounts(t, ctx, db.Pool(), f.organizationID)
	items, _, err := repo.claimEvolutionWebhooksForLane(ctx, evolutionWebhookLaneLive, 1, "")
	if err != nil || len(items) != 1 || items[0].ID != receipt.ID {
		t.Fatalf("late identity fixture claim=%d/%v", len(items), err)
	}
	if err := repo.processClaimedEvolutionWebhook(ctx, items[0]); err != nil {
		t.Fatal(err)
	}
	if after := contactPNBusinessCounts(t, ctx, db.Pool(), f.organizationID); before != after {
		t.Fatalf("late technical rejection had customer effects: %v -> %v", before, after)
	}
	var status, reason, raw string
	if err := db.Pool().QueryRow(ctx, `select inbox.status,ignored.reason,inbox.payload#>>'{data,Message,conversation}'
	 from public.whatsapp_webhook_inbox inbox join private.whatsapp_webhook_ignored_events ignored
	 on ignored.organization_id=inbox.organization_id and ignored.session_id=inbox.session_id and ignored.event_key=inbox.event_key
	 where inbox.id=$1::uuid`, receipt.ID).Scan(&status, &reason, &raw); err != nil || status != "processed" || reason != whatsappPNRouteConflictReason || raw == "" {
		t.Fatalf("late rejection lost durable technical disposition: %s/%s/%t/%v", status, reason, raw != "", err)
	}
}

func TestStoredLIDPNConversationPromotionSerializesCompetingPN(t *testing.T) {
	ctx, db := webhookDependencyDatabase(t)
	f := newWebhookDependencyFixture(t, ctx, db, "stored-pn-concurrent")
	var id string
	if err := db.Pool().QueryRow(ctx, `insert into public.whatsapp_conversations(organization_id,session_id,remote_jid)
	 values($1::uuid,$2::uuid,'777777777000006@lid') returning id::text`, f.organizationID, f.sessionID).Scan(&id); err != nil {
		t.Fatal(err)
	}
	first, err := db.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer rollbackWebhookTx(first)
	second, err := db.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer rollbackWebhookTx(second)
	if _, err := second.Exec(ctx, "set local lock_timeout='5s'; set local statement_timeout='8s'"); err != nil {
		t.Fatal(err)
	}
	const update = `update public.whatsapp_conversations set remote_jid=$2,contact_phone=$3 where id=$1::uuid`
	if _, err := first.Exec(ctx, update, id, "5511988881111@s.whatsapp.net", "5511988881111"); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() {
		_, err := second.Exec(ctx, update, id, "5511977772222@s.whatsapp.net", "5511977772222")
		done <- err
	}()
	// Observe the real row-lock wait, rather than relying on a scheduling sleep.
	deadline := time.Now().Add(2 * time.Second)
	for {
		var blocked bool
		if err := db.Pool().QueryRow(ctx, `select coalesce((select wait_event_type='Lock'
		 from pg_catalog.pg_stat_activity where pid=$1),false)`, second.Conn().PgConn().PID()).Scan(&blocked); err != nil {
			t.Fatal(err)
		}
		if blocked {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("competing Edge-style UPDATE did not reach its row-lock wait")
		}
		select {
		case err := <-done:
			t.Fatalf("competing PN UPDATE completed before the winner committed: %v", err)
		case <-time.After(10 * time.Millisecond):
		}
	}
	if err := first.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-done:
		var guard *pgconn.PgError
		if !errorsAsPNGuard(err, &guard) {
			t.Fatalf("concurrent physical PN overwrite escaped the OLD tuple guard: %v", err)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("concurrent physical identity guard did not release promptly")
	}
	var remote string
	if err := db.Pool().QueryRow(ctx, `select remote_jid from public.whatsapp_conversations where id=$1::uuid`, id).Scan(&remote); err != nil || remote != "5511988881111@s.whatsapp.net" {
		t.Fatalf("concurrent loser changed the winning physical identity: %s/%v", remote, err)
	}
}

func TestStoredLIDPNQuarantineRPCRequiresExactCanonicalLease(t *testing.T) {
	ctx, db := webhookDependencyDatabase(t)
	f := newWebhookDependencyFixture(t, ctx, db, "stored-pn-rpc")
	repo := NewRepository(db, nil, StorageConfig{})
	repo.functions.webhookProcessorMode = webhookProcessorNative
	repo.functions.webhookRolloutSessionIDs = []string{f.sessionID}
	if _, err := db.Pool().Exec(ctx, `delete from private.whatsapp_webhook_session_cutovers where session_id=$1::uuid;
	 update public.whatsapp_sessions set advanced_settings='{"token":"synthetic-stored-rpc","webhook_token":"synthetic-stored-hook"}'::jsonb where id=$1::uuid`, f.sessionID); err != nil {
		t.Fatal(err)
	}
	id := f.suffix + "-canonical"
	payload, _ := json.Marshal(map[string]any{"event": "message", "data": map[string]any{
		"Info":    map[string]any{"ID": id, "Chat": f.remoteJID, "Timestamp": time.Now().UTC().Format(time.RFC3339Nano)},
		"Message": map[string]any{"conversation": "canonical synthetic evidence"}},
		"__vimob_ingress": map[string]any{"identity_quarantined_provider_message_ids": []string{"raw-spoof"}}})
	receipt, err := repo.AcceptEvolutionWebhook(ctx, evolutionWebhookEnvelope{SessionID: f.sessionID,
		InstanceToken: "synthetic-stored-rpc", WebhookHeaderTokens: []string{"synthetic-stored-hook"}, EventType: "message", Payload: payload, ReceivedAt: time.Now().UTC()})
	if err != nil {
		t.Fatal(err)
	}
	items, _, err := repo.claimEvolutionWebhooksForLane(ctx, evolutionWebhookLaneLive, 1, "")
	if err != nil || len(items) != 1 || items[0].ID != receipt.ID {
		t.Fatalf("RPC fixture claim=%d/%v", len(items), err)
	}
	var execution string
	if err := db.Pool().QueryRow(ctx, `select public.reserve_whatsapp_webhook_edge_execution($1::uuid,$2::uuid,$3::uuid,$4)::text`,
		f.organizationID, f.sessionID, receipt.ID, whatsappWebhookWorkerID).Scan(&execution); err != nil || execution == "" {
		t.Fatalf("RPC execution reserve=%s/%v", execution, err)
	}
	var started bool
	if err := db.Pool().QueryRow(ctx, `select public.start_whatsapp_webhook_edge_execution($1::uuid,$2::uuid,$3::uuid,$4::uuid)`,
		f.organizationID, f.sessionID, receipt.ID, execution).Scan(&started); err != nil || !started {
		t.Fatalf("RPC execution start=%t/%v", started, err)
	}
	args := []any{f.organizationID, f.sessionID, receipt.ID, execution, id}
	const query = `select public.record_whatsapp_webhook_contact_pn_quarantine($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5)`
	for _, role := range []string{"anon", "authenticated"} {
		tx, err := db.Pool().Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = tx.Exec(ctx, "set local role "+role); err == nil {
			_, err = tx.Exec(ctx, query, args...)
		}
		rollbackWebhookTx(tx)
		var denied *pgconn.PgError
		if !errors.As(err, &denied) || denied.Code != "42501" {
			t.Fatalf("RPC %s ACL denial=%v", role, err)
		}
	}
	for _, c := range []struct {
		index int
		value any
	}{
		{0, "00000000-0000-4000-8000-000000000001"},
		{1, "00000000-0000-4000-8000-000000000002"},
		{2, "00000000-0000-4000-8000-000000000003"},
		{3, "00000000-0000-4000-8000-000000000004"},
		{4, "raw-spoof"},
	} {
		invalid := append([]any(nil), args...)
		invalid[c.index] = c.value
		_, err := db.Pool().Exec(ctx, query, invalid...)
		var denied *pgconn.PgError
		if !errors.As(err, &denied) || denied.Code != "42501" {
			t.Fatalf("RPC scope argument %d borrowed canonical evidence: %v", c.index, err)
		}
	}
	for attempt := 0; attempt < 2; attempt++ {
		tx, err := db.Pool().Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := tx.Exec(ctx, "set local role service_role"); err != nil {
			rollbackWebhookTx(tx)
			t.Fatal(err)
		}
		var ok bool
		if err := tx.QueryRow(ctx, query, args...).Scan(&ok); err != nil || !ok {
			rollbackWebhookTx(tx)
			t.Fatalf("RPC canonical service evidence=%t/%v", ok, err)
		}
		if err := tx.Commit(ctx); err != nil {
			t.Fatal(err)
		}
	}
	var count int
	if err := db.Pool().QueryRow(ctx, `select count(*) from private.whatsapp_webhook_ignored_events
	 where organization_id=$1::uuid and session_id=$2::uuid and reason=$3`, f.organizationID, f.sessionID, whatsappPNRouteConflictReason).Scan(&count); err != nil || count != 1 {
		t.Fatalf("RPC duplicate technical evidence=%d/%v", count, err)
	}
	if _, err := db.Pool().Exec(ctx, `select public.finish_whatsapp_webhook_edge_execution($1::uuid,$2::uuid,$3::uuid,$4::uuid)`, args[:4]...); err != nil {
		t.Fatal(err)
	}
	_, err = db.Pool().Exec(ctx, query, args...)
	var expired *pgconn.PgError
	if !errors.As(err, &expired) || expired.Code != "42501" {
		t.Fatalf("finished execution retained quarantine authority: %v", err)
	}
}
