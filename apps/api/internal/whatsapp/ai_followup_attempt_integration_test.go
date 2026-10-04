package whatsapp

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/ai"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

type followUpTestRunner struct {
	output string
	calls  *atomic.Int32
	ready  chan struct{}
}

func (runner followUpTestRunner) Run(ctx context.Context, _ tenant.Context, _ ai.RunRequest) (ai.RunResponse, error) {
	if runner.calls.Add(1) == 2 && runner.ready != nil {
		close(runner.ready)
	}
	if runner.ready != nil {
		select {
		case <-runner.ready:
		case <-ctx.Done():
			return ai.RunResponse{}, ctx.Err()
		}
	}
	return ai.RunResponse{Output: runner.output}, nil
}

func followUpTestDatabaseURL(t *testing.T) string {
	t.Helper()
	databaseURL := strings.TrimSpace(os.Getenv("WHATSAPP_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("WHATSAPP_TEST_DATABASE_URL is not set")
	}
	target, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	if target.Scheme != "postgres" && target.Scheme != "postgresql" {
		t.Fatal("WHATSAPP_TEST_DATABASE_URL must be a PostgreSQL URL")
	}
	switch strings.ToLower(target.Hostname()) {
	case "localhost", "127.0.0.1", "::1":
	default:
		t.Fatalf("WHATSAPP_TEST_DATABASE_URL must point to loopback, got %q", target.Hostname())
	}
	return databaseURL
}

func prepareAIFollowUpFixture(t *testing.T, ctx context.Context, repo Repository, fixture sessionConversationLockFixture) aiFollowUpCandidate {
	t.Helper()
	due := time.Now().UTC().Add(-time.Minute)
	if _, err := repo.db.Pool().Exec(ctx, `
		insert into public.organization_modules (organization_id, module_name, is_enabled)
		values ($1::uuid, 'ai_agent', true);
		insert into public.organization_ai_settings (organization_id, is_enabled)
		values ($1::uuid, true);
		update public.whatsapp_sessions
		set advanced_settings = jsonb_build_object(
			'ai_auto_reply_enabled', true, 'ai_follow_up_enabled', true
		)
		where organization_id = $1::uuid and id = $2::uuid;
		update public.leads set next_follow_up_at = $4::timestamptz
		where organization_id = $1::uuid and id = $3::uuid
	`, fixture.organizationID, fixture.sessionID, fixture.leadID, due); err != nil {
		t.Fatal(err)
	}
	return aiFollowUpCandidate{
		OrganizationID: fixture.organizationID,
		LeadID:         fixture.leadID,
		LeadName:       fixture.suffix,
		ConversationID: fixture.conversationID,
		SessionID:      fixture.sessionID,
		OwnerUserID:    fixture.userID,
		Template:       "soft",
		IntervalDays:   3,
		DueAt:          due,
	}
}

func assertOneAIFollowUpOutbox(t *testing.T, ctx context.Context, repo Repository, candidate aiFollowUpCandidate, clientMessageID string) {
	t.Helper()
	var messages, outbox int
	if err := repo.db.Pool().QueryRow(ctx, `
		select count(*) from public.whatsapp_messages
		where organization_id = $1::uuid and session_id = $2::uuid
		  and client_message_id = $3
	`, candidate.OrganizationID, candidate.SessionID, clientMessageID).Scan(&messages); err != nil {
		t.Fatal(err)
	}
	if err := repo.db.Pool().QueryRow(ctx, `
		select count(*) from public.whatsapp_outbox
		where organization_id = $1::uuid and session_id = $2::uuid
		  and client_message_id = $3
	`, candidate.OrganizationID, candidate.SessionID, clientMessageID).Scan(&outbox); err != nil {
		t.Fatal(err)
	}
	if messages != 1 || outbox != 1 {
		t.Fatalf("same follow-up occurrence has %d messages and %d outbox rows, want one each", messages, outbox)
	}
}

// Simulate a crash precisely after SendMessage committed the message/outbox,
// before metadata and next schedule were written. Recovery must not call AI
// again or enqueue a second message.
func TestAIFollowUpRecoveryAfterCommittedEnqueue(t *testing.T) {
	databaseURL := followUpTestDatabaseURL(t)
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, HealthTimeout: 3 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	defer postgres.Close()
	fixture := createSessionConversationLockFixture(t, ctx, postgres.Pool(), "ai-followup-recovery")
	defer cleanupSessionConversationLockFixture(t, postgres.Pool(), fixture)
	repo := NewRepository(postgres, nil, StorageConfig{})
	candidate := prepareAIFollowUpFixture(t, ctx, repo, fixture)
	claimed, err := repo.lockDueAIFollowUps(ctx, 1)
	if err != nil || len(claimed) != 1 {
		t.Fatalf("claim follow-up: candidates=%d error=%v", len(claimed), err)
	}
	candidate = claimed[0]
	attempt, err := repo.reserveAIFollowUpAttempt(ctx, candidate)
	if err != nil {
		t.Fatal(err)
	}
	clientMessageID := autoFollowUpMessagePrefix + attempt.ID
	if _, err := repo.SendMessage(ctx, fixture.tenant, candidate.ConversationID, sendMessageInput{
		Text: "the only follow-up", SendSessionID: candidate.SessionID,
		ClientMessageID: clientMessageID, ExpectedLeadID: candidate.LeadID,
		InternalAutomation: true,
	}); err != nil {
		t.Fatalf("commit canonical enqueue before simulated crash: %v", err)
	}
	// The real claim lease elapses before another worker is allowed to retry.
	if _, err := repo.db.Pool().Exec(ctx, `
		update public.leads set next_follow_up_at = now() - interval '1 minute'
		where organization_id = $1::uuid and id = $2::uuid
	`, candidate.OrganizationID, candidate.LeadID); err != nil {
		t.Fatal(err)
	}
	calls := &atomic.Int32{}
	handler := NewHandler(repo).WithAutoReply(followUpTestRunner{output: "different retry text", calls: calls}, "")
	if err := handler.ProcessAIFollowUps(ctx); err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 0 {
		t.Fatalf("AI ran %d times after proof of enqueue, want zero", calls.Load())
	}
	assertOneAIFollowUpOutbox(t, ctx, repo, candidate, clientMessageID)
	var status string
	var nextDue time.Time
	if err := repo.db.Pool().QueryRow(ctx, `
		select attempt.status, lead.next_follow_up_at
		from private.whatsapp_ai_followup_attempts attempt
		join public.leads lead on lead.organization_id = attempt.organization_id and lead.id = attempt.lead_id
		where attempt.organization_id = $1::uuid and attempt.lead_id = $2::uuid
	`, candidate.OrganizationID, candidate.LeadID).Scan(&status, &nextDue); err != nil {
		t.Fatal(err)
	}
	if status != "completed" || !nextDue.After(time.Now().Add(48*time.Hour)) {
		t.Fatalf("recovery left status=%q next due=%v", status, nextDue)
	}
}

// Two independent pools stand in for two API replicas. Both model calls are
// allowed to finish, but the stable client id permits only one outbox send.
func TestAIFollowUpConcurrentReplicasUseOneOutbox(t *testing.T) {
	databaseURL := followUpTestDatabaseURL(t)
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	firstDB, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, HealthTimeout: 3 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	defer firstDB.Close()
	secondDB, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, HealthTimeout: 3 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	defer secondDB.Close()
	fixture := createSessionConversationLockFixture(t, ctx, firstDB.Pool(), "ai-followup-two-replicas")
	defer cleanupSessionConversationLockFixture(t, firstDB.Pool(), fixture)
	first := NewRepository(firstDB, nil, StorageConfig{})
	second := NewRepository(secondDB, nil, StorageConfig{})
	candidate := prepareAIFollowUpFixture(t, ctx, first, fixture)
	calls := &atomic.Int32{}
	ready := make(chan struct{})
	handlers := []Handler{
		NewHandler(first).WithAutoReply(followUpTestRunner{output: "replica A", calls: calls, ready: ready}, ""),
		NewHandler(second).WithAutoReply(followUpTestRunner{output: "replica B", calls: calls, ready: ready}, ""),
	}
	results := make(chan error, len(handlers))
	for _, handler := range handlers {
		go func(handler Handler) { results <- handler.processAIFollowUp(ctx, candidate) }(handler)
	}
	for range handlers {
		if err := <-results; err != nil {
			t.Fatal(fmt.Errorf("concurrent follow-up: %w", err))
		}
	}
	if calls.Load() != 2 {
		t.Fatalf("AI calls=%d, want both replicas to reach the send race", calls.Load())
	}
	var attemptID, status string
	if err := firstDB.Pool().QueryRow(ctx, `
		select attempt_id::text, status
		from private.whatsapp_ai_followup_attempts
		where organization_id = $1::uuid and lead_id = $2::uuid
	`, candidate.OrganizationID, candidate.LeadID).Scan(&attemptID, &status); err != nil {
		t.Fatal(err)
	}
	if status != "completed" {
		t.Fatalf("attempt status=%q, want completed", status)
	}
	assertOneAIFollowUpOutbox(t, ctx, first, candidate, autoFollowUpMessagePrefix+attemptID)
}

// A previous API version committed a timestamp-based client id, then crashed
// before it marked the message or advanced the business schedule. Both new
// replicas must retain the ambiguous occurrence without another AI call.
func TestAIFollowUpLegacyCrashRetainedAcrossTwoConnections(t *testing.T) {
	databaseURL := followUpTestDatabaseURL(t)
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	firstDB, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, HealthTimeout: 3 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	defer firstDB.Close()
	secondDB, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, HealthTimeout: 3 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	defer secondDB.Close()
	fixture := createSessionConversationLockFixture(t, ctx, firstDB.Pool(), "ai-followup-legacy-crash")
	defer cleanupSessionConversationLockFixture(t, firstDB.Pool(), fixture)
	first := NewRepository(firstDB, nil, StorageConfig{})
	second := NewRepository(secondDB, nil, StorageConfig{})
	candidate := prepareAIFollowUpFixture(t, ctx, first, fixture)
	legacyID := fmt.Sprintf("ai-followup-%s-%d", fixture.leadID, time.Now().Add(-16*time.Minute).Unix())
	if _, err := first.SendMessage(ctx, fixture.tenant, fixture.conversationID, sendMessageInput{
		Text: "legacy enqueue before crash", SendSessionID: fixture.sessionID,
		ClientMessageID: legacyID, ExpectedLeadID: fixture.leadID,
		InternalAutomation: true,
	}); err != nil {
		t.Fatal(err)
	}
	// Time travel only the disposable fixture: old claim due = enqueue + 15m.
	if _, err := firstDB.Pool().Exec(ctx, `
		update public.whatsapp_messages
		set created_at = now() - interval '16 minutes',
		    sent_at = now() - interval '16 minutes'
		where organization_id = $1::uuid and session_id = $2::uuid
		  and client_message_id = $3;
		update public.leads
		set next_follow_up_at = now() - interval '1 minute'
		where organization_id = $1::uuid and id = $4::uuid
	`, fixture.organizationID, fixture.sessionID, legacyID, fixture.leadID); err != nil {
		t.Fatal(err)
	}
	if err := firstDB.Pool().QueryRow(ctx, `
		select next_follow_up_at from public.leads
		where organization_id = $1::uuid and id = $2::uuid
	`, fixture.organizationID, fixture.leadID).Scan(&candidate.DueAt); err != nil {
		t.Fatal(err)
	}
	calls := &atomic.Int32{}
	handlers := []Handler{
		NewHandler(first).WithAutoReply(followUpTestRunner{output: "duplicate A", calls: calls}, ""),
		NewHandler(second).WithAutoReply(followUpTestRunner{output: "duplicate B", calls: calls}, ""),
	}
	results := make(chan error, len(handlers))
	for _, handler := range handlers {
		go func(handler Handler) { results <- handler.processAIFollowUp(ctx, candidate) }(handler)
	}
	for range handlers {
		if err := <-results; !errors.Is(err, errAIFollowUpLegacyReview) {
			t.Fatalf("legacy result=%v, want review hold", err)
		}
	}
	if calls.Load() != 0 {
		t.Fatalf("AI ran %d times for legacy uncertain enqueue", calls.Load())
	}
	assertOneAIFollowUpOutbox(t, ctx, first, candidate, legacyID)
	var status, reviewClientID string
	var reviewMessageID, reviewOutboxID string
	if err := firstDB.Pool().QueryRow(ctx, `
		select status, legacy_client_message_id,
		       legacy_message_id::text, legacy_outbox_id::text
		from private.whatsapp_ai_followup_attempts
		where organization_id = $1::uuid and lead_id = $2::uuid
	`, fixture.organizationID, fixture.leadID).Scan(
		&status, &reviewClientID, &reviewMessageID, &reviewOutboxID,
	); err != nil {
		t.Fatal(err)
	}
	if status != "legacy_review" || reviewClientID != legacyID || reviewMessageID == "" || reviewOutboxID == "" {
		t.Fatalf("legacy hold status=%q client=%q message=%q outbox=%q", status, reviewClientID, reviewMessageID, reviewOutboxID)
	}
	if claimed, err := first.lockDueAIFollowUps(ctx, 1); err != nil || len(claimed) != 0 {
		t.Fatalf("legacy review must be excluded from new claims: %d candidates, %v", len(claimed), err)
	}
}

// A real next cycle may be due days after a legacy message even if the old
// best-effort event write failed. The 15-minute lease guard must not retain it.
func TestAIFollowUpEarlierLegacyCycleDoesNotBlockNewDue(t *testing.T) {
	databaseURL := followUpTestDatabaseURL(t)
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, HealthTimeout: 3 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	defer postgres.Close()
	fixture := createSessionConversationLockFixture(t, ctx, postgres.Pool(), "ai-followup-old-cycle")
	defer cleanupSessionConversationLockFixture(t, postgres.Pool(), fixture)
	repo := NewRepository(postgres, nil, StorageConfig{})
	candidate := prepareAIFollowUpFixture(t, ctx, repo, fixture)
	legacyID := fmt.Sprintf("ai-followup-%s-%d", fixture.leadID, time.Now().Add(-4*24*time.Hour).Unix())
	if _, err := repo.SendMessage(ctx, fixture.tenant, fixture.conversationID, sendMessageInput{
		Text: "previous cycle", SendSessionID: fixture.sessionID,
		ClientMessageID: legacyID, ExpectedLeadID: fixture.leadID,
		InternalAutomation: true,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		update public.whatsapp_messages
		set created_at = now() - interval '4 days',
		    sent_at = now() - interval '4 days'
		where organization_id = $1::uuid and session_id = $2::uuid
		  and client_message_id = $3
	`, fixture.organizationID, fixture.sessionID, legacyID); err != nil {
		t.Fatal(err)
	}
	calls := &atomic.Int32{}
	handler := NewHandler(repo).WithAutoReply(followUpTestRunner{output: "current cycle", calls: calls}, "")
	if err := handler.processAIFollowUp(ctx, candidate); err != nil {
		t.Fatalf("new due after older legacy cycle: %v", err)
	}
	if calls.Load() != 1 {
		t.Fatalf("AI ran %d times for legitimate new due, want one", calls.Load())
	}
	var status string
	var legacyReferenceCount, messageCount, outboxCount int
	if err := postgres.Pool().QueryRow(ctx, `
		select status, case when legacy_message_id is null then 0 else 1 end
		from private.whatsapp_ai_followup_attempts
		where organization_id = $1::uuid and lead_id = $2::uuid
	`, fixture.organizationID, fixture.leadID).Scan(&status, &legacyReferenceCount); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		select count(*) from public.whatsapp_messages
		where organization_id = $1::uuid and lead_id = $2::uuid
		  and client_message_id like 'ai-followup-%'
	`, fixture.organizationID, fixture.leadID).Scan(&messageCount); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		select count(*) from public.whatsapp_outbox
		where organization_id = $1::uuid and conversation_id = $2::uuid
		  and client_message_id like 'ai-followup-%'
	`, fixture.organizationID, fixture.conversationID).Scan(&outboxCount); err != nil {
		t.Fatal(err)
	}
	if status != "completed" || legacyReferenceCount != 0 || messageCount != 2 || outboxCount != 2 {
		t.Fatalf("new cycle status=%q legacyRef=%d messages=%d outbox=%d", status, legacyReferenceCount, messageCount, outboxCount)
	}
}
