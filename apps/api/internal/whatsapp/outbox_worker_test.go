package whatsapp

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestSendMessageCommitsDurableStoragePathWithoutSigningBeforeOutbox(t *testing.T) {
	sourceBytes, err := os.ReadFile("message_operations.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(sourceBytes)
	if strings.Contains(source, "repo.storage.signedURL(ctx, whatsappMediaBucket") {
		t.Fatal("SendMessage still signs outbound media before the durable worker owns delivery")
	}
	if !strings.Contains(source, `body["mediaStoragePath"] = storedMediaPath`) {
		t.Fatal("SendMessage must persist the private Storage path in the durable outbox payload")
	}
	if got := strings.Count(source, "wakeWhatsAppOutboxWorker()"); got < 2 {
		t.Fatalf("repository-level outbox wake count = %d, want new and idempotent commit paths", got)
	}
}

func TestOutboxLaneClassificationKeepsTextOffMediaCapacity(t *testing.T) {
	tests := []struct {
		name     string
		action   string
		wantLane whatsappOutboxLane
	}{
		{name: "text", action: "send.text", wantLane: whatsappOutboxLaneFast},
		{name: "reaction", action: "message.react", wantLane: whatsappOutboxLaneFast},
		{name: "image", action: "send.media", wantLane: whatsappOutboxLaneMedia},
		{name: "audio", action: "send.audio", wantLane: whatsappOutboxLaneMedia},
		{name: "sticker", action: "send.sticker", wantLane: whatsappOutboxLaneMedia},
		{name: "malformed is isolated by delivery validation, not media", action: "", wantLane: whatsappOutboxLaneFast},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := whatsappOutboxLaneForPayload(map[string]any{"action": test.action})
			if got != test.wantLane {
				t.Fatalf("lane = %q, want %q", got, test.wantLane)
			}
		})
	}
}

func TestOutboxWorkerDefaultsDrainImmediateTextWithBoundedConcurrency(t *testing.T) {
	config := (WorkerConfig{}).normalized()
	if config.OutboxWorkerInterval.String() != "1s" {
		t.Fatalf("default interval = %s, want 1s", config.OutboxWorkerInterval)
	}
	if config.OutboxWorkerBatch != 10 {
		t.Fatalf("default burst = %d, want 10", config.OutboxWorkerBatch)
	}
	if config.OutboxWorkerConcurrency != 4 {
		t.Fatalf("default concurrency = %d, want 4", config.OutboxWorkerConcurrency)
	}
	if got := (WorkerConfig{OutboxWorkerConcurrency: 16}).normalized().OutboxWorkerConcurrency; got != 16 {
		t.Fatalf("maximum concurrency = %d, want 16", got)
	}
	if got := (WorkerConfig{OutboxWorkerConcurrency: 17}).normalized().OutboxWorkerConcurrency; got != 4 {
		t.Fatalf("unsafe concurrency = %d, want safe default 4", got)
	}
}

func TestOutboxClaimUsesConversationFIFOAndExplicitCursorWrap(t *testing.T) {
	query := strings.ToLower(strings.Join(strings.Fields(claimWhatsAppOutboxQuery), " "))
	for _, required := range []string{
		"'00000000-0000-0000-0000-000000000000'::uuid",
		"select distinct on (queued.conversation_id)",
		"queued.conversation_id > params.after_conversation_id",
		"order by queued.conversation_id, queued.created_at, queued.id",
		"from conversation_heads head join public.whatsapp_conversations wc on wc.id = head.conversation_id",
		"where head.next_attempt_at <= now()",
		"for no key update of wc skip locked",
		"join public.whatsapp_outbox queued on queued.id = selected.event_id",
		"for update of queued skip locked",
		"where active.conversation_id = wc.id",
		"active.status = 'processing'",
		"$4::text as requested_lane",
		"$5::double precision as media_ordering_grace_millis",
	} {
		if !strings.Contains(query, required) {
			t.Fatalf("outbox claim is missing %q", required)
		}
	}
	if strings.Contains(query, "where active.session_id") || strings.Contains(query, "for no key update of ws") {
		t.Fatal("outbox claim must not let media in one conversation serialize every chat on the same WhatsApp session")
	}
	if strings.Contains(query, "gen_random_uuid()") || strings.Contains(query, "claim_bucket") {
		t.Fatal("outbox cursor must start at the beginning and wrap explicitly instead of randomizing or sorting every head")
	}
	headStart := strings.Index(query, "conversation_heads as (")
	candidateStart := strings.Index(query, "candidate_conversations as materialized")
	if headStart < 0 || candidateStart <= headStart {
		t.Fatal("outbox claim must expose separate FIFO-head and due-candidate stages")
	}
	if strings.Contains(query[headStart:candidateStart], "next_attempt_at <= now()") {
		t.Fatal("lane head must be selected before checking its retry deadline, or a newer operation in the same lane can bypass backoff")
	}
	if strings.Contains(query, "params.lane") || strings.Contains(query, "older_media") || strings.Contains(query, "older_fast") {
		t.Fatal("compatibility any claim must use the predicate-free v2 head path")
	}
	if whatsappOutboxMediaOrderingGrace != 2*time.Second {
		t.Fatalf("cross-lane media ordering grace = %s, want explicit 2s bound", whatsappOutboxMediaOrderingGrace)
	}
}

func TestOutboxWorkerSelectsLiteralLaneClaimsForPartialIndexes(t *testing.T) {
	normalize := func(query string) string {
		return strings.ToLower(strings.Join(strings.Fields(query), " "))
	}
	anyQuery := normalize(whatsappOutboxClaimQueryForLane(whatsappOutboxLaneAny))
	fastQuery := normalize(whatsappOutboxClaimQueryForLane(whatsappOutboxLaneFast))
	mediaQuery := normalize(whatsappOutboxClaimQueryForLane(whatsappOutboxLaneMedia))

	if anyQuery != normalize(claimWhatsAppOutboxQuery) {
		t.Fatal("lane any no longer uses the compatibility claim backed by the general v2 head index")
	}
	if got := normalize(whatsappOutboxClaimQueryForLane("unexpected")); got != anyQuery {
		t.Fatal("an unknown internal lane must fail safely to the compatibility claim")
	}
	for _, token := range []string{
		whatsappOutboxQueuedLanePredicateToken,
		whatsappOutboxActiveLanePredicateToken,
		whatsappOutboxCrossLaneOrderingToken,
	} {
		if strings.Contains(anyQuery, token) {
			t.Fatalf("compatibility claim leaked internal SQL token %q", token)
		}
	}

	for lane, query := range map[string]string{"fast": fastQuery, "media": mediaQuery} {
		for _, forbidden := range []string{
			"params.lane = 'any'",
			"params.lane = case",
			"params.lane <>",
			whatsappOutboxQueuedLanePredicateToken,
			whatsappOutboxActiveLanePredicateToken,
			whatsappOutboxCrossLaneOrderingToken,
		} {
			if strings.Contains(query, forbidden) {
				t.Fatalf("%s hot claim still contains parameterized lane branch %q", lane, forbidden)
			}
		}
		for _, required := range []string{
			"select distinct on (queued.conversation_id)",
			"queued.status in ('pending', 'retry')",
			"queued.attempts < queued.max_attempts or queued.last_error = '" + whatsappOutboxProviderAcceptedMarker + "'",
			"order by queued.conversation_id, queued.created_at, queued.id",
			"for no key update of wc skip locked",
			"for update of queued skip locked",
			"coalesce(delivery_session.is_active, true)",
		} {
			if !strings.Contains(query, required) {
				t.Fatalf("%s literal claim lost %q", lane, required)
			}
		}
	}

	const fastQueuedPredicate = `and not ( lower(coalesce(queued.payload->>'action', '')) in ('send.media', 'send.audio', 'send.sticker') or lower(coalesce(queued.message_type, '')) in ('image', 'audio', 'video', 'document', 'sticker') )`
	const mediaQueuedPredicate = `and ( lower(coalesce(queued.payload->>'action', '')) in ('send.media', 'send.audio', 'send.sticker') or lower(coalesce(queued.message_type, '')) in ('image', 'audio', 'video', 'document', 'sticker') )`
	const fastActivePredicate = `and not ( lower(coalesce(active.payload->>'action', '')) in ('send.media', 'send.audio', 'send.sticker') or lower(coalesce(active.message_type, '')) in ('image', 'audio', 'video', 'document', 'sticker') )`
	const mediaActivePredicate = `and ( lower(coalesce(active.payload->>'action', '')) in ('send.media', 'send.audio', 'send.sticker') or lower(coalesce(active.message_type, '')) in ('image', 'audio', 'video', 'document', 'sticker') )`

	if got := strings.Count(fastQuery, fastQueuedPredicate); got != 1 {
		t.Fatalf("fast literal queued predicate count = %d, want one hot head predicate", got)
	}
	if got := strings.Count(fastQuery, fastActivePredicate); got != 3 {
		t.Fatalf("fast literal active predicate count = %d, want all three race guards", got)
	}
	if !strings.Contains(fastQuery, "from public.whatsapp_outbox older_media") ||
		strings.Contains(fastQuery, "from public.whatsapp_outbox older_fast") ||
		!strings.Contains(fastQuery, "make_interval(secs => params.media_ordering_grace_millis / 1000.0)") {
		t.Fatal("fast claim lost its bounded older-media ordering guard")
	}

	if got := strings.Count(mediaQuery, mediaQueuedPredicate); got != 1 {
		t.Fatalf("media literal queued predicate count = %d, want one hot head predicate", got)
	}
	if got := strings.Count(mediaQuery, mediaActivePredicate); got != 3 {
		t.Fatalf("media literal active predicate count = %d, want all three race guards", got)
	}
	if !strings.Contains(mediaQuery, "from public.whatsapp_outbox older_fast") ||
		strings.Contains(mediaQuery, "from public.whatsapp_outbox older_media") {
		t.Fatal("media claim lost its older-fast FIFO guard")
	}
}

func TestOutboxLaneIndexesAreOnlineExactAndKeepGeneralCompatibilityIndex(t *testing.T) {
	migrationBytes, err := os.ReadFile("../../../../supabase/migrations/20260912183453_isolate_whatsapp_outbox_lane_claims.sql")
	if err != nil {
		t.Fatal(err)
	}
	cutoverBytes, err := os.ReadFile("../../../../supabase/cutovers/20260912_prepare_whatsapp_outbox_lane_indexes.sql")
	if err != nil {
		t.Fatal(err)
	}
	migration := strings.ToLower(strings.Join(strings.Fields(string(migrationBytes)), " "))
	cutover := strings.ToLower(strings.Join(strings.Fields(string(cutoverBytes)), " "))
	const fastIndexPredicate = `and not ( lower(coalesce(payload->>'action', '')) in ('send.media', 'send.audio', 'send.sticker') or lower(coalesce(message_type, '')) in ('image', 'audio', 'video', 'document', 'sticker') )`
	const mediaIndexPredicate = `and ( lower(coalesce(payload->>'action', '')) in ('send.media', 'send.audio', 'send.sticker') or lower(coalesce(message_type, '')) in ('image', 'audio', 'video', 'document', 'sticker') )`

	for name, source := range map[string]string{"migration": migration, "cutover": cutover} {
		for _, required := range []string{
			"whatsapp_outbox_fast_due_head_idx",
			"whatsapp_outbox_media_due_head_idx",
			"whatsapp_outbox_conversation_due_head_v2_idx",
			"include (next_attempt_at)",
			"last_error = '" + whatsappOutboxProviderAcceptedMarker + "'",
			"actual_signature is distinct from expected_signature",
			"pg_my_temp_schema()",
			"whatsapp_outbox_lane_contract_fast_idx",
			"whatsapp_outbox_lane_contract_media_idx",
			fastIndexPredicate,
			mediaIndexPredicate,
		} {
			if !strings.Contains(source, required) {
				t.Fatalf("%s lane-index contract is missing %q", name, required)
			}
		}
		if strings.Contains(source, "index_definition like") || strings.Contains(source, "index_definition not like") {
			t.Fatalf("%s accepts a partial or drifted lane index with LIKE", name)
		}
		if strings.Contains(source, "drop index concurrently if exists public.whatsapp_outbox_conversation_due_head_v2_idx") ||
			strings.Contains(source, "drop index public.whatsapp_outbox_conversation_due_head_v2_idx") {
			t.Fatalf("%s must retain the general v2 compatibility index", name)
		}
	}

	for _, required := range []string{
		"\\set on_error_stop on",
		"create index concurrently if not exists whatsapp_outbox_fast_due_head_idx",
		"create index concurrently if not exists whatsapp_outbox_media_due_head_idx",
		"pg_advisory_lock(hashtextextended('vimob:whatsapp-outbox:lane-index-cutover', 0))",
		"pg_advisory_unlock(hashtextextended('vimob:whatsapp-outbox:lane-index-cutover', 0))",
	} {
		if !strings.Contains(cutover, required) {
			t.Fatalf("online lane-index cutover is missing %q", required)
		}
	}
	if fastAt, mediaAt := strings.Index(cutover, "create index concurrently if not exists whatsapp_outbox_fast_due_head_idx"), strings.Index(cutover, "create index concurrently if not exists whatsapp_outbox_media_due_head_idx"); fastAt < 0 || mediaAt <= fastAt {
		t.Fatalf("same-table concurrent builds must be sequential and deterministic: fast=%d media=%d", fastAt, mediaAt)
	}
	if !strings.Contains(migration, "lock table public.whatsapp_outbox in share mode nowait") ||
		!strings.Contains(migration, "if exists (select 1 from public.whatsapp_outbox limit 1)") {
		t.Fatal("transactional fallback is not restricted to a locked, provably pristine outbox")
	}
}

func TestOutboxCursorWrapsAtMostOncePerBurst(t *testing.T) {
	cursor := ""
	wrapped := false
	if tryWrapWhatsAppOutboxCursor(&cursor, &wrapped) {
		t.Fatal("empty cursor already starts at the beginning and must not trigger an empty wrap")
	}

	cursor = "ffffffff-ffff-ffff-ffff-ffffffffffff"
	if !tryWrapWhatsAppOutboxCursor(&cursor, &wrapped) {
		t.Fatal("cursor should wrap after reaching the end")
	}
	if cursor != "" || !wrapped {
		t.Fatalf("wrapped cursor = %q, wrapped = %t; want empty cursor and wrapped=true", cursor, wrapped)
	}

	// A successful claim after wrapping advances the cursor again. The guard
	// must still refuse a second wrap in this burst or an empty queue can spin.
	cursor = "11111111-1111-1111-1111-111111111111"
	if tryWrapWhatsAppOutboxCursor(&cursor, &wrapped) {
		t.Fatal("cursor wrapped twice in one burst")
	}
	if cursor != "11111111-1111-1111-1111-111111111111" {
		t.Fatalf("second wrap mutated cursor to %q", cursor)
	}
}

func TestOutboxClaimDoesNotRunGlobalRecoveryOnEveryMessage(t *testing.T) {
	query := strings.ToLower(claimWhatsAppOutboxQuery)
	for _, forbidden := range []string{
		"status = 'dead'",
		"locked_at < now() - interval '5 minutes'",
		"retry_exhausted",
	} {
		if strings.Contains(query, forbidden) {
			t.Fatalf("hot claim path still contains recovery work %q", forbidden)
		}
	}
}

func TestOutboxWakeSignalsOnlyConfiguredFastWorkers(t *testing.T) {
	drainOutboxWake := func(wake <-chan struct{}) {
		for {
			select {
			case <-wake:
			default:
				return
			}
		}
	}
	drainOutboxWake(whatsappOutboxFastWorkerWake)
	drainOutboxWake(whatsappOutboxMediaWorkerWake)
	previous := whatsappOutboxFastWorkerCount.Load()
	t.Cleanup(func() {
		drainOutboxWake(whatsappOutboxFastWorkerWake)
		drainOutboxWake(whatsappOutboxMediaWorkerWake)
		whatsappOutboxFastWorkerCount.Store(previous)
	})

	whatsappOutboxFastWorkerCount.Store(2)
	wakeWhatsAppOutboxWorker()
	if got := len(whatsappOutboxFastWorkerWake); got != 2 {
		t.Fatalf("fast wake tokens = %d, want configured worker count 2", got)
	}
	if got := len(whatsappOutboxMediaWorkerWake); got != 1 {
		t.Fatalf("media wake tokens = %d, want 1", got)
	}
}

func TestOutboxClaimCreatesFencedLeaseWithoutConsumingDeliveryAttempt(t *testing.T) {
	query := strings.ToLower(strings.Join(strings.Fields(claimWhatsAppOutboxQuery), " "))
	for _, required := range []string{
		"locked_by = concat($2::text, ':', $6::text, ':', queued.id::text)",
		"coalesce(claimed.locked_by, '')",
		"coalesce(claimed.last_error, '')",
		"or queued.last_error = '" + whatsappOutboxProviderAcceptedMarker + "'",
	} {
		if !strings.Contains(query, required) {
			t.Fatalf("fenced outbox claim is missing %q", required)
		}
	}
	if strings.Contains(query, "attempts = queued.attempts + 1") {
		t.Fatal("claim still consumes the provider delivery attempt before session and dependency preflight")
	}
}

func TestOutboxClaimSkipsOfflineProviderWorkButKeepsLocalFinalizationEligible(t *testing.T) {
	query := strings.ToLower(strings.Join(strings.Fields(claimWhatsAppOutboxQuery), " "))
	for _, required := range []string{
		"from public.whatsapp_sessions as delivery_session",
		"delivery_session.id = queued.session_id",
		"delivery_session.organization_id = queued.organization_id",
		"delivery_session.provider",
		"delivery_session.is_active",
		"delivery_session.status",
		"queued.last_error = '" + whatsappOutboxProviderAcceptedMarker + "' or exists",
	} {
		if !strings.Contains(query, required) {
			t.Fatalf("offline-safe outbox claim is missing %q", required)
		}
	}
	if got := strings.Count(query, "from public.whatsapp_sessions as delivery_session"); got != 3 {
		t.Fatalf("session eligibility is rechecked %d times, want head, locked head, and final update", got)
	}
	if got := strings.Count(query, "coalesce(delivery_session.is_active, true)"); got != 3 {
		t.Fatalf("legacy nullable active sessions are preserved in %d eligibility checks, want 3", got)
	}
	if strings.Contains(query, "coalesce(delivery_session.is_active, false)") {
		t.Fatal("outbox claim strands legacy sessions whose nullable is_active means active")
	}
}

func TestOutboxFinalizationRecoveryHasAnExactOnlineHeadIndex(t *testing.T) {
	migrationBytes, err := os.ReadFile("../../../../supabase/migrations/20260912160000_optimize_whatsapp_outbox_finalization_claim.sql")
	if err != nil {
		t.Fatal(err)
	}
	cutoverBytes, err := os.ReadFile("../../../../supabase/cutovers/20260912_prepare_whatsapp_outbox_finalization_index.sql")
	if err != nil {
		t.Fatal(err)
	}
	migration := strings.ToLower(string(migrationBytes))
	cutover := strings.ToLower(string(cutoverBytes))
	for name, source := range map[string]string{"migration": migration, "cutover": cutover} {
		for _, required := range []string{
			"whatsapp_outbox_conversation_due_head_v2_idx",
			"attempts < max_attempts",
			"last_error = '" + whatsappOutboxProviderAcceptedMarker + "'",
			"include (next_attempt_at)",
			"if index_definition is distinct from",
		} {
			if !strings.Contains(source, required) {
				t.Fatalf("%s finalization head-index contract is missing %q", name, required)
			}
		}
		if strings.Contains(source, "index_definition not like") {
			t.Fatalf("%s accepts a partial/drifted outbox index definition", name)
		}
	}
	if !strings.Contains(cutover, "\\set on_error_stop on") {
		t.Fatal("outbox index cutover can continue into the obsolete-index drop after verification fails")
	}
	if !strings.Contains(cutover, "create index concurrently if not exists whatsapp_outbox_conversation_due_head_v2_idx") {
		t.Fatal("live outbox recovery index is not built concurrently")
	}
	verifyPosition := strings.Index(cutover, "$verify_whatsapp_outbox_finalization_index$")
	dropPosition := strings.Index(cutover, "drop index concurrently if exists public.whatsapp_outbox_conversation_due_head_idx")
	if verifyPosition < 0 || dropPosition < 0 || verifyPosition > dropPosition {
		t.Fatalf("obsolete outbox index is retired before v2 verification: verify=%d drop=%d", verifyPosition, dropPosition)
	}
}

func TestOutboxMediaStoragePathIsTenantScopedBeforeSigning(t *testing.T) {
	raw, err := os.ReadFile("outbox_worker.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)
	processStart := strings.Index(source, "func (repo Repository) processClaimedWhatsAppOutbox(")
	if processStart < 0 {
		t.Fatal("could not isolate outbox delivery orchestration")
	}
	processEnd := strings.Index(source[processStart:], "func finalizeAcceptedWhatsAppOutbox(")
	if processEnd < 0 {
		t.Fatal("could not isolate outbox delivery orchestration")
	}
	process := source[processStart : processStart+processEnd]
	scopeCheck := strings.Index(process, "whatsappMediaPathBelongsToOrganization(storagePath, item.OrganizationID)")
	signCall := strings.Index(process, "repo.storage.signedURL(ctx, whatsappMediaBucket, storagePath")
	providerAttempt := strings.Index(process, "startWhatsAppOutboxProviderAttempt")
	if scopeCheck < 0 || signCall < 0 || providerAttempt < 0 || scopeCheck > signCall || signCall > providerAttempt {
		t.Fatalf("outbound media boundary order is unsafe: scope=%d sign=%d attempt=%d", scopeCheck, signCall, providerAttempt)
	}
	if !strings.Contains(process, "outbound media path escaped organization scope") ||
		!strings.Contains(process, "true,\n\t\t\t\tfalse,") {
		t.Fatal("cross-tenant media path must fail permanently before any signing or provider call")
	}
}

func TestOutboxProviderAcceptedThenDatabaseFailureDefersOnlyFinalization(t *testing.T) {
	databaseFailure := errors.New("injected acknowledgement transaction failure")
	var calls []string
	err := finalizeAcceptedWhatsAppOutbox(
		func() error {
			calls = append(calls, "mark-accepted")
			return nil
		},
		func() error {
			calls = append(calls, "complete")
			return databaseFailure
		},
		func(cause error) error {
			calls = append(calls, "defer-finalization")
			if !errors.Is(cause, databaseFailure) {
				t.Fatalf("deferred cause = %v, want injected database failure", cause)
			}
			return fmt.Errorf("%w: %v", errWhatsAppOutboxFinalizationPending, cause)
		},
	)
	if !errors.Is(err, errWhatsAppOutboxFinalizationPending) {
		t.Fatalf("finalization failure = %v, want finalization-pending", err)
	}
	if got := strings.Join(calls, ","); got != "mark-accepted,complete,defer-finalization" {
		t.Fatalf("fault-injection call order = %q", got)
	}
	if !whatsappOutboxAwaitingFinalization(whatsappOutboxProviderAcceptedMarker) {
		t.Fatal("persisted provider acceptance must route the next claim directly to local finalization")
	}
}

func TestOutboxProviderAcceptanceMarkerFailureIsOutcomeUnknown(t *testing.T) {
	markerFailure := errors.New("injected marker failure")
	completeCalled := false
	err := finalizeAcceptedWhatsAppOutbox(
		func() error { return markerFailure },
		func() error {
			completeCalled = true
			return nil
		},
		func(error) error {
			t.Fatal("finalization cannot be deferred before the acceptance marker exists")
			return nil
		},
	)
	if !errors.Is(err, ErrProviderOutcomeUnknown) {
		t.Fatalf("marker failure = %v, want provider outcome unknown", err)
	}
	if completeCalled {
		t.Fatal("local message state was finalized without a durable provider acceptance marker")
	}
}

func TestOutboxTerminalWebhookRaceRequiresExactProviderIdentity(t *testing.T) {
	for _, status := range []string{"sent", "delivered", "read"} {
		if !whatsappOutboxTerminalMatchesProvider(status, "provider-1", "provider-1", "message-row-1") {
			t.Fatalf("terminal webhook status %q with exact identities was not reconciled", status)
		}
	}
	for _, test := range []struct {
		name      string
		status    string
		persisted string
		expected  string
		messageID string
	}{
		{name: "still processing", status: "processing", persisted: "provider-1", expected: "provider-1", messageID: "message-row-1"},
		{name: "failed", status: "failed", persisted: "provider-1", expected: "provider-1", messageID: "message-row-1"},
		{name: "other provider", status: "sent", persisted: "provider-2", expected: "provider-1", messageID: "message-row-1"},
		{name: "missing projection", status: "sent", persisted: "provider-1", expected: "provider-1", messageID: ""},
	} {
		t.Run(test.name, func(t *testing.T) {
			if whatsappOutboxTerminalMatchesProvider(test.status, test.persisted, test.expected, test.messageID) {
				t.Fatal("unsafe terminal outbox state was accepted as the provider webhook race winner")
			}
		})
	}
}

func TestOutboxCanceledProviderAttemptIsOutcomeUnknown(t *testing.T) {
	for _, err := range []error{ErrProviderOutcomeUnknown, context.Canceled, context.DeadlineExceeded} {
		if !whatsappOutboxProviderOutcomeUnknown(err) {
			t.Fatalf("provider error %v may be post-acceptance and must not be retried", err)
		}
	}
	if whatsappOutboxProviderOutcomeUnknown(errors.New("known provider rejection")) {
		t.Fatal("known provider rejection was incorrectly classified as outcome unknown")
	}
}

func TestOutboxLeaseLossCancelsSlowProviderCall(t *testing.T) {
	var renewals atomic.Int32
	providerStarted := make(chan struct{})
	providerErr, leaseErr := superviseWhatsAppOutboxLease(
		context.Background(),
		time.Millisecond,
		func(context.Context) (bool, error) {
			renewals.Add(1)
			return false, nil
		},
		func(ctx context.Context) error {
			close(providerStarted)
			<-ctx.Done()
			return ctx.Err()
		},
	)
	select {
	case <-providerStarted:
	default:
		t.Fatal("provider call did not start")
	}
	if renewals.Load() < 1 {
		t.Fatal("lease heartbeat never ran")
	}
	if !errors.Is(leaseErr, errWhatsAppOutboxLeaseLost) {
		t.Fatalf("lease error = %v, want lease lost", leaseErr)
	}
	if !errors.Is(providerErr, context.Canceled) {
		t.Fatalf("provider error = %v, want cancellation after lease loss", providerErr)
	}
}

func TestOutboxProviderCompletionWinsItsOwnHeartbeatCancellation(t *testing.T) {
	renewStarted := make(chan struct{})
	var started sync.Once
	providerErr, leaseErr := superviseWhatsAppOutboxLease(
		context.Background(),
		time.Millisecond,
		func(ctx context.Context) (bool, error) {
			started.Do(func() { close(renewStarted) })
			<-ctx.Done()
			return false, ctx.Err()
		},
		func(context.Context) error {
			<-renewStarted
			return nil
		},
	)
	if providerErr != nil || leaseErr != nil {
		t.Fatalf("completed provider call = provider %v, lease %v; its own cancellation is not lease loss", providerErr, leaseErr)
	}
}

func TestOutboxStaleRecoverySeparatesAcceptedStartedAndUnstartedLeases(t *testing.T) {
	raw, err := os.ReadFile("outbox_worker.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)
	for _, required := range []string{
		"with candidates as materialized",
		"order by outbox.id",
		"limit $5",
		"for update skip locked",
		"then 'finalize'",
		"then 'unknown'",
		"whatsappOutboxProviderUnknownMarker",
		"coalesce(outbox.last_error, '') not in ($1, $2)",
		"syncTerminalWhatsAppOutboxFailuresBatch(ctx, tx, terminalIDs)",
		"terminal WhatsApp outbox projection requires an explicit non-empty scope",
	} {
		if !strings.Contains(source, required) {
			t.Fatalf("stale recovery contract is missing %q", required)
		}
	}
	if strings.Contains(source, `syncTerminalWhatsAppOutboxFailures(ctx, tx, "")`) {
		t.Fatal("runtime stale recovery still projects every terminal outbox row without a bounded scope")
	}
	processStart := strings.Index(source, "func (repo Repository) processClaimedWhatsAppOutbox(")
	if processStart < 0 {
		t.Fatal("could not isolate outbox delivery orchestration")
	}
	processEnd := strings.Index(source[processStart:], "func finalizeAcceptedWhatsAppOutbox(")
	if processEnd < 0 {
		t.Fatal("could not isolate outbox delivery orchestration")
	}
	process := source[processStart : processStart+processEnd]
	deferDisconnected := strings.Index(process, "deferWhatsAppOutboxWithoutAttempt")
	startAttempt := strings.Index(process, "startWhatsAppOutboxProviderAttempt")
	providerCall := strings.Index(process, "invokeEvolution(providerCtx")
	if deferDisconnected < 0 || startAttempt < 0 || providerCall < 0 || deferDisconnected > startAttempt || startAttempt > providerCall {
		t.Fatalf("delivery boundary order is unsafe: defer=%d start=%d provider=%d", deferDisconnected, startAttempt, providerCall)
	}
}

func TestOutboxCompletionLocksAllMessageProjectionsInUUIDOrder(t *testing.T) {
	raw, err := os.ReadFile("outbox_worker.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)
	start := strings.Index(source, "func (repo Repository) completeWhatsAppOutbox(")
	if start < 0 {
		t.Fatal("completeWhatsAppOutbox source boundary not found")
	}
	end := strings.Index(source[start:], "\nfunc ")
	if end < 0 {
		t.Fatal("completeWhatsAppOutbox source boundary not found")
	}
	body := source[start : start+end]
	for _, required := range []string{
		"select message.id::text, message.conversation_id::text",
		"message.id = $4::uuid",
		"message.provider_message_id = $3",
		"message.message_id = $3",
		"message.session_id = $2::uuid",
		"order by message.id",
		"for update of message",
		"pendingMessageLocked",
		"conversationID != item.ConversationID",
		"WhatsApp message projection conversation mismatch",
		"multiple WhatsApp message projections share provider id",
	} {
		if !strings.Contains(body, required) {
			t.Fatalf("outbox completion deterministic message lock is missing %q", required)
		}
	}
	orderAt := strings.Index(body, "order by message.id")
	lockAt := strings.Index(body, "for update of message")
	if orderAt < 0 || lockAt < 0 || orderAt >= lockAt {
		t.Fatal("outbox completion must lock message projections in UUID order")
	}
	if strings.Contains(body, "message.conversation_id =") {
		t.Fatal("outbox completion must lock provider-id collisions across the whole session before validating conversation ownership")
	}
}
