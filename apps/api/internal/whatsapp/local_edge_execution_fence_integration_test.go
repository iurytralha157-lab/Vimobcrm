package whatsapp

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/packages/db"
)

// This opt-in test runs only against the disposable loopback Supabase clone.
// It exercises the real Go forwarder, Edge handler and SQL fence without a
// provider, then proves that epoch one dispatch is native on the same session.
func TestLocalEdgeExecutionFenceAndCutover(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("WHATSAPP_EDGE_FENCE_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("WHATSAPP_EDGE_FENCE_TEST_DATABASE_URL is not set")
	}
	target, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	host := net.ParseIP(target.Hostname())
	if (target.Hostname() != "localhost" && (host == nil || !host.IsLoopback())) || target.Port() != "57722" {
		t.Fatal("Edge fence fixture requires disposable loopback PostgreSQL port 57722")
	}
	edgeURL := strings.TrimRight(strings.TrimSpace(os.Getenv("WHATSAPP_EDGE_FENCE_TEST_SUPABASE_URL")), "/")
	edgeTarget, err := url.Parse(edgeURL)
	if err != nil || edgeTarget.Scheme != "http" || edgeTarget.Hostname() != "127.0.0.1" || edgeTarget.Port() != "57721" {
		t.Fatal("Edge fence fixture requires http://127.0.0.1:57721")
	}
	serviceKey := strings.TrimSpace(os.Getenv("WHATSAPP_EDGE_FENCE_TEST_SERVICE_ROLE_KEY"))
	if serviceKey == "" {
		t.Fatal("Edge fence fixture requires the disposable project's service key")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()
	postgres, err := db.NewPostgres(ctx, db.Config{URL: databaseURL, HealthTimeout: 3 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(postgres.Close)
	fixture := createSessionConversationLockFixture(t, ctx, postgres.Pool(), "edge-fence")
	preserveFixture := false
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cleanupCancel()
		var outstanding int
		if err := postgres.Pool().QueryRow(cleanupCtx, `
			select count(*) from public.whatsapp_webhook_inbox
			where organization_id = $1::uuid and edge_execution_id is not null
		`, fixture.organizationID).Scan(&outstanding); err != nil || outstanding != 0 || preserveFixture {
			t.Logf("preserving disposable Edge fence fixture: org=%s session=%s outstanding=%d query_error=%v",
				fixture.organizationID, fixture.sessionID, outstanding, err)
			return
		}
		for _, statement := range []string{
			`delete from public.whatsapp_webhook_routing_snapshots where organization_id = $1::uuid`,
			`delete from public.whatsapp_webhook_inbox where organization_id = $1::uuid`,
			`delete from public.whatsapp_labels where organization_id = $1::uuid`,
			`delete from public.whatsapp_groups where organization_id = $1::uuid`,
			`delete from private.whatsapp_webhook_session_cutovers where session_id in (
			  select id from public.whatsapp_sessions where organization_id = $1::uuid
			)`,
		} {
			if _, err := postgres.Pool().Exec(cleanupCtx, statement, fixture.organizationID); err != nil {
				t.Errorf("cleanup synthetic Edge fixture: %v", err)
				return
			}
		}
		cleanupSessionConversationLockFixture(t, postgres.Pool(), fixture)
	})
	if _, err := postgres.Pool().Exec(ctx, `
		update public.whatsapp_sessions
		set advanced_settings = '{"webhook_token":"synthetic-webhook-secret"}'::jsonb
		where id = $1::uuid and organization_id = $2::uuid
	`, fixture.sessionID, fixture.organizationID); err != nil {
		t.Fatal(err)
	}

	repo := NewRepository(postgres, nil, StorageConfig{})
	repo.functions.webhookProcessorMode = webhookProcessorEdge
	repo.functions.projectURL = edgeURL
	repo.functions.apiKey = serviceKey
	repo.functions.httpClient = &http.Client{Timeout: 20 * time.Second}

	insertClaimed := func(name, event string, data any, epoch int) pendingEvolutionWebhook {
		t.Helper()
		payload, err := json.Marshal(map[string]any{
			"event":      event,
			"instanceId": fixture.suffix,
			"data":       data,
			"__vimob_ingress": map[string]any{
				"routing_key":      "__session__",
				"routing_snapshot": map[string]any{"version": 1, "messages": []any{}},
			},
		})
		if err != nil {
			t.Fatal(err)
		}
		var id string
		if err := postgres.Pool().QueryRow(ctx, `
			insert into public.whatsapp_webhook_inbox (
				organization_id, session_id, event_key, event_type, provider,
				payload, processing_epoch, processing_lane, status, attempts,
				locked_by, locked_at, next_attempt_at
			) values (
				$1::uuid, $2::uuid, $3, $4, 'evolution_go',
				$5::jsonb, $6, 'live', 'processing', 1,
				$7, now(), now()
			) returning id::text
		`, fixture.organizationID, fixture.sessionID, fixture.suffix+"-"+name,
			event, string(payload), epoch, whatsappWebhookWorkerID).Scan(&id); err != nil {
			t.Fatal(err)
		}
		return pendingEvolutionWebhook{
			ID: id, OrganizationID: fixture.organizationID, SessionID: fixture.sessionID,
			InstanceID: fixture.suffix, EventType: event, WebhookToken: "synthetic-webhook-secret",
			Payload: payload, ProcessingEpoch: epoch, ProcessingLane: evolutionWebhookLaneLive,
			Attempts: 1, MaxAttempts: 8, CreatedAt: time.Now(),
		}
	}
	assertInbox := func(item pendingEvolutionWebhook, wantStatus, wantEdgeState string) {
		t.Helper()
		var status, edgeState, lastError string
		if err := postgres.Pool().QueryRow(ctx, `
			select status, coalesce(edge_execution_state, ''), left(coalesce(last_error, ''), 240)
			from public.whatsapp_webhook_inbox where id = $1::uuid
		`, item.ID).Scan(&status, &edgeState, &lastError); err != nil {
			t.Fatal(err)
		}
		if status != wantStatus || edgeState != wantEdgeState {
			t.Fatalf("inbox %s status=%s edge=%s, want %s/%s (last_error=%q)", item.ID,
				status, edgeState, wantStatus, wantEdgeState, lastError)
		}
	}
	assertSessionStatus := func(want string) {
		t.Helper()
		var status string
		if err := postgres.Pool().QueryRow(ctx, `
			select status from public.whatsapp_sessions where id = $1::uuid
		`, fixture.sessionID).Scan(&status); err != nil {
			t.Fatal(err)
		}
		if status != want {
			t.Fatalf("session status=%s, want %s", status, want)
		}
	}

	// Successful Go reservation, real Edge effects, Edge finish, Go completion.
	normal := insertClaimed("normal", "connection.update", map[string]any{"state": "disconnected"}, 0)
	if err := repo.processClaimedEvolutionWebhook(ctx, normal); err != nil {
		t.Fatalf("Go to Edge normal delivery: %v", err)
	}
	assertInbox(normal, "processed", "")
	assertSessionStatus("disconnected")
	labelRemoteID := fixture.suffix + "-label"
	labelWithoutColor := insertClaimed("label-null", "labels.update", map[string]any{
		"labels": []any{map[string]any{"id": labelRemoteID, "name": "synthetic label"}},
	}, 0)
	if err := repo.processClaimedEvolutionWebhook(ctx, labelWithoutColor); err != nil {
		t.Fatalf("Edge label without numeric color: %v", err)
	}
	assertInbox(labelWithoutColor, "processed", "")
	var labelColor int
	if err := postgres.Pool().QueryRow(ctx, `
		select coalesce(color, -999) from public.whatsapp_labels
		where organization_id = $1::uuid and session_id = $2::uuid and remote_label_id = $3
	`, fixture.organizationID, fixture.sessionID, labelRemoteID).Scan(&labelColor); err != nil || labelColor != -999 {
		t.Fatalf("Edge label missing color must remain null: color=%d err=%v", labelColor, err)
	}
	labelWithColor := insertClaimed("label-index", "labels.update", map[string]any{
		"labels": []any{map[string]any{"id": labelRemoteID, "name": "synthetic label", "colorIndex": "7"}},
	}, 0)
	if err := repo.processClaimedEvolutionWebhook(ctx, labelWithColor); err != nil {
		t.Fatalf("Edge label with numeric color index: %v", err)
	}
	assertInbox(labelWithColor, "processed", "")
	if err := postgres.Pool().QueryRow(ctx, `
		select coalesce(color, -999) from public.whatsapp_labels
		where organization_id = $1::uuid and session_id = $2::uuid and remote_label_id = $3
	`, fixture.organizationID, fixture.sessionID, labelRemoteID).Scan(&labelColor); err != nil || labelColor != 7 {
		t.Fatalf("Edge label decimal color index: color=%d err=%v", labelColor, err)
	}

	// Go sends a reserved token to a slow receiver and times out before Edge
	// starts. The cancelled token must not allow a later real Edge invocation.
	reserved := insertClaimed("reserved", "connection.update", map[string]any{"state": "connected"}, 0)
	type lateRequest struct {
		headers http.Header
		query   string
		body    []byte
	}
	lateRequests := make(chan lateRequest, 1)
	blockedReceiver := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		lateRequests <- lateRequest{headers: r.Header.Clone(), query: r.URL.RawQuery, body: body}
		<-r.Context().Done()
	}))
	defer blockedReceiver.Close()
	blockedRepo := repo
	blockedRepo.functions.evolutionWebhookURL = blockedReceiver.URL
	blockedRepo.functions.httpClient = &http.Client{Timeout: 800 * time.Millisecond}
	if err := blockedRepo.forwardEvolutionWebhookFenced(ctx, reserved); err == nil {
		t.Fatal("unstarted Edge request unexpectedly succeeded")
	}
	assertInbox(reserved, "processing", "")
	var late lateRequest
	select {
	case late = <-lateRequests:
	case <-time.After(3 * time.Second):
		t.Fatal("Go request did not reach the blocked receiver")
	}
	if late.headers.Get("x-vimob-inbox-id") != reserved.ID || late.headers.Get("x-vimob-edge-execution-id") == "" {
		t.Fatal("Go did not forward the reserved inbox execution token")
	}
	lateEdge, err := http.NewRequestWithContext(ctx, http.MethodPost,
		edgeURL+"/functions/v1/evolution-go-webhook?"+late.query, bytes.NewReader(late.body))
	if err != nil {
		t.Fatal(err)
	}
	lateEdge.Header = late.headers.Clone()
	lateResponse, err := repo.functions.httpClient.Do(lateEdge)
	if err != nil {
		t.Fatal(err)
	}
	_ = lateResponse.Body.Close()
	if lateResponse.StatusCode >= 200 && lateResponse.StatusCode < 300 {
		t.Fatalf("cancelled reservation was accepted by real Edge: HTTP %d", lateResponse.StatusCode)
	}
	assertSessionStatus("disconnected")
	if err := repo.processClaimedEvolutionWebhook(ctx, reserved); err != nil {
		t.Fatalf("drain cancelled reservation through real Edge: %v", err)
	}
	assertInbox(reserved, "processed", "")
	assertSessionStatus("connected")

	// Hold a group row after Edge starts. This blocks an awaited effect but
	// leaves the session row free, so cutover can independently inspect the marker.
	groupJID := fixture.phone + "@g.us"
	var groupID string
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_groups (
			organization_id, session_id, remote_jid, group_jid,
			name, subject, participants, is_announce, metadata
		) values ($1::uuid, $2::uuid, $3, $3, 'before', 'before', '[]'::jsonb, false, '{}'::jsonb)
		returning id::text
	`, fixture.organizationID, fixture.sessionID, groupJID).Scan(&groupID); err != nil {
		t.Fatal(err)
	}
	lock, err := postgres.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	lockReleased := false
	defer func() {
		if !lockReleased {
			_ = lock.Rollback(context.Background())
		}
	}()
	if _, err := lock.Exec(ctx, `select id from public.whatsapp_groups where id = $1::uuid for update`, groupID); err != nil {
		t.Fatal(err)
	}
	timeoutItem := insertClaimed("timeout", "groups.update", map[string]any{
		"groups": []any{map[string]any{"id": groupJID, "name": "after"}},
	}, 0)
	timeoutRepo := repo
	timeoutRepo.functions.httpClient = &http.Client{Timeout: 8 * time.Second}
	workerDone := make(chan error, 1)
	go func() { workerDone <- timeoutRepo.processClaimedEvolutionWebhook(ctx, timeoutItem) }()
	active := false
	for deadline := time.Now().Add(7 * time.Second); time.Now().Before(deadline); {
		var state string
		if err := postgres.Pool().QueryRow(ctx, `
			select coalesce(edge_execution_state, '')
			from public.whatsapp_webhook_inbox where id = $1::uuid
		`, timeoutItem.ID).Scan(&state); err != nil {
			t.Fatal(err)
		}
		if state == "active" {
			active = true
			break
		}
		time.Sleep(25 * time.Millisecond)
	}
	if !active {
		t.Fatal("real Edge did not start before the Go timeout")
	}
	var cutoverAt time.Time
	cutoverErr := postgres.Pool().QueryRow(ctx, `
		select private.activate_whatsapp_webhook_session_cutover($1::uuid, $2::uuid)
	`, fixture.organizationID, fixture.sessionID).Scan(&cutoverAt)
	if cutoverErr == nil || !strings.Contains(cutoverErr.Error(), "whatsapp_cutover_edge_execution_inflight") {
		t.Fatalf("active Edge did not fence cutover: %v", cutoverErr)
	}
	select {
	case err := <-workerDone:
		if !errors.Is(err, errEvolutionEdgeExecutionStillActive) {
			t.Fatalf("Go timeout should report an active Edge execution: %v", err)
		}
	case <-time.After(12 * time.Second):
		t.Fatal("Go HTTP timeout did not complete")
	}
	assertInbox(timeoutItem, "processing", "active")
	if _, err := postgres.Pool().Exec(ctx, `
		update public.whatsapp_webhook_inbox
		set locked_at = now() - interval '6 minutes'
		where id = $1::uuid
	`, timeoutItem.ID); err != nil {
		t.Fatal(err)
	}
	recovery, err := postgres.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := resetStaleEvolutionWebhookClaims(ctx, recovery); err != nil {
		_ = recovery.Rollback(ctx)
		t.Fatal(err)
	}
	var recoveryStatus, recoveryMarker string
	if err := recovery.QueryRow(ctx, `
		select status, coalesce(edge_execution_state, '')
		from public.whatsapp_webhook_inbox where id = $1::uuid
	`, timeoutItem.ID).Scan(&recoveryStatus, &recoveryMarker); err != nil {
		_ = recovery.Rollback(ctx)
		t.Fatal(err)
	}
	_ = recovery.Rollback(ctx) // Global recovery probe cannot mutate other rows.
	if recoveryStatus != "processing" || recoveryMarker != "active" {
		t.Fatalf("stale recovery reclaimed active Edge: %s/%s", recoveryStatus, recoveryMarker)
	}
	if err := lock.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	lockReleased = true
	finished := false
	for deadline := time.Now().Add(15 * time.Second); time.Now().Before(deadline); {
		var marker string
		if err := postgres.Pool().QueryRow(ctx, `
			select coalesce(edge_execution_state, '')
			from public.whatsapp_webhook_inbox where id = $1::uuid
		`, timeoutItem.ID).Scan(&marker); err != nil {
			t.Fatal(err)
		}
		if marker == "" {
			finished = true
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	if !finished {
		preserveFixture = true
		t.Fatal("Edge did not finish its active execution after the blocked effect was released")
	}
	// A disconnected HTTP client may abort the blocked PostgREST write even
	// while Edge's finally block still closes the marker. Either outcome is
	// safe; replay after the marker closes must complete the awaited effect.
	if err := repo.processClaimedEvolutionWebhook(ctx, timeoutItem); err != nil {
		t.Fatalf("drain timed-out epoch-zero event: %v", err)
	}
	assertInbox(timeoutItem, "processed", "")
	var groupName string
	if err := postgres.Pool().QueryRow(ctx, `select name from public.whatsapp_groups where id = $1::uuid`, groupID).Scan(&groupName); err != nil || groupName != "after" {
		t.Fatalf("drained Edge effect did not finish: group=%q err=%v", groupName, err)
	}

	if err := postgres.Pool().QueryRow(ctx, `
		select private.activate_whatsapp_webhook_session_cutover($1::uuid, $2::uuid)
	`, fixture.organizationID, fixture.sessionID).Scan(&cutoverAt); err != nil {
		t.Fatalf("cutover after the epoch-zero drain: %v", err)
	}
	epochOne := insertClaimed("native", "connection.update", map[string]any{"state": "disconnected"}, 1)
	if err := repo.processClaimedEvolutionWebhook(ctx, epochOne); err != nil {
		t.Fatalf("epoch-one dispatch with Edge configured: %v", err)
	}
	assertInbox(epochOne, "processed", "")
	assertSessionStatus("disconnected")

	// Epoch-one control callbacks must be persisted natively even when this
	// replica remains configured for Edge. They never create a conversation.
	nativeLabel := insertClaimed("native-label", "labels.update", map[string]any{
		"Labels": []any{map[string]any{
			"ID": labelRemoteID, "Name": "native label", "colorIndex": "9", "predefined": true,
		}},
	}, 1)
	if err := repo.processClaimedEvolutionWebhook(ctx, nativeLabel); err != nil {
		t.Fatalf("epoch-one native label: %v", err)
	}
	assertInbox(nativeLabel, "processed", "")
	var nativeLabelName string
	if err := postgres.Pool().QueryRow(ctx, `
		select name, coalesce(color, -999) from public.whatsapp_labels
		where organization_id = $1::uuid and session_id = $2::uuid and remote_label_id = $3
	`, fixture.organizationID, fixture.sessionID, labelRemoteID).Scan(&nativeLabelName, &labelColor); err != nil || nativeLabelName != "native label" || labelColor != 9 {
		t.Fatalf("native label metadata: name=%q color=%d err=%v", nativeLabelName, labelColor, err)
	}
	nativeGroup := insertClaimed("native-group", "groups.update", map[string]any{
		"Groups": []any{map[string]any{
			"id": groupJID, "subject": "native group", "description": "synthetic",
			"participants": []any{map[string]any{"id": fixture.phone + "@s.whatsapp.net"}},
			"isAnnounce": true,
		}},
	}, 1)
	if err := repo.processClaimedEvolutionWebhook(ctx, nativeGroup); err != nil {
		t.Fatalf("epoch-one native group: %v", err)
	}
	assertInbox(nativeGroup, "processed", "")
	var nativeGroupName, nativeGroupDescription string
	var nativeGroupParticipants int
	var nativeGroupAnnounce bool
	if err := postgres.Pool().QueryRow(ctx, `
		select name, coalesce(description, ''), jsonb_array_length(participants), is_announce
		from public.whatsapp_groups
		where organization_id = $1::uuid and session_id = $2::uuid and remote_jid = $3
	`, fixture.organizationID, fixture.sessionID, groupJID).Scan(
		&nativeGroupName, &nativeGroupDescription, &nativeGroupParticipants, &nativeGroupAnnounce,
	); err != nil || nativeGroupName != "native group" || nativeGroupDescription != "synthetic" || nativeGroupParticipants != 1 || !nativeGroupAnnounce {
		t.Fatalf("native group metadata: name=%q description=%q participants=%d announce=%t err=%v",
			nativeGroupName, nativeGroupDescription, nativeGroupParticipants, nativeGroupAnnounce, err)
	}
	var groupConversationCount int
	if err := postgres.Pool().QueryRow(ctx, `
		select count(*) from public.whatsapp_conversations
		where organization_id = $1::uuid and session_id = $2::uuid and remote_jid = $3
	`, fixture.organizationID, fixture.sessionID, groupJID).Scan(&groupConversationCount); err != nil || groupConversationCount != 0 {
		t.Fatalf("group callback created a conversation: count=%d err=%v", groupConversationCount, err)
	}
	t.Log("Go/Edge fence, drain, native cutover and native label/group callbacks passed locally")
}
