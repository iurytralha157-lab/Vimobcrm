package whatsapp

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

// TestSessionConversationMutationLockOrder runs only against an explicitly
// selected disposable loopback database. It exercises the real repository
// paths that previously formed session <-> conversation deadlocks.
func TestSessionConversationMutationLockOrder(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("WHATSAPP_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("WHATSAPP_TEST_DATABASE_URL is not set")
	}
	target, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatalf("parse WHATSAPP_TEST_DATABASE_URL: %v", err)
	}
	if hostname := strings.ToLower(target.Hostname()); hostname != "localhost" && hostname != "127.0.0.1" && hostname != "::1" {
		t.Fatalf("WHATSAPP_TEST_DATABASE_URL must point to loopback, got %q", target.Hostname())
	}

	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, HealthTimeout: 3 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(postgres.Close)

	t.Run("quarantine claim and send both wait on session before conversation", func(t *testing.T) {
		fixture := createSessionConversationLockFixture(t, ctx, postgres.Pool(), "claim-send")
		defer cleanupSessionConversationLockFixture(t, postgres.Pool(), fixture)
		repo := NewRepository(postgres, nil, StorageConfig{})

		blocker := holdSessionForUpdate(t, ctx, postgres.Pool(), fixture.sessionID)
		blockerReleased := false
		defer func() {
			if !blockerReleased {
				_ = blocker.Rollback(context.Background())
			}
		}()

		type claimResult struct {
			found bool
			err   error
		}
		claimDone := make(chan claimResult, 1)
		go func() {
			_, _, found, claimErr := repo.claimExactQuarantinedConversationForLead(
				ctx,
				fixture.tenant,
				fixture.sessionID,
				fixture.leadID,
				newWhatsAppContactIdentity(fixture.phone, fixture.remoteJID, false),
				fixture.leadID,
			)
			claimDone <- claimResult{found: found, err: claimErr}
		}()
		waitForSessionConversationBlockedQueries(t, ctx, postgres.Pool(), 1)

		sendDone := make(chan error, 1)
		go func() {
			_, sendErr := repo.SendMessage(ctx, fixture.tenant, fixture.conversationID, sendMessageInput{
				Text:            "session-first claim/send",
				ClientMessageID: fixture.suffix + "-send",
				ExpectedLeadID:  fixture.leadID,
			})
			sendDone <- sendErr
		}()
		waitForSessionConversationBlockedQueries(t, ctx, postgres.Pool(), 2)
		assertSessionConversationStillUnlocked(t, ctx, postgres.Pool(), fixture.conversationID)

		if err := blocker.Commit(ctx); err != nil {
			t.Fatal(err)
		}
		blockerReleased = true
		select {
		case result := <-claimDone:
			if result.err != nil {
				t.Fatalf("claimExactQuarantinedConversationForLead: %v", result.err)
			}
			if result.found {
				t.Fatal("already-bound conversation was incorrectly reported as a claimed quarantine row")
			}
		case <-time.After(8 * time.Second):
			t.Fatal("quarantine claim did not finish; possible session/conversation deadlock")
		}
		awaitSessionConversationOperation(t, "SendMessage after quarantine claim", sendDone)
		assertSessionConversationMessageCount(t, ctx, postgres.Pool(), fixture, fixture.suffix+"-send", 1)
	})

	t.Run("native session repair and send serialize before conversation", func(t *testing.T) {
		fixture := createSessionConversationLockFixture(t, ctx, postgres.Pool(), "native-send")
		defer cleanupSessionConversationLockFixture(t, postgres.Pool(), fixture)
		repo := NewRepository(postgres, nil, StorageConfig{})

		blocker := holdSessionForUpdate(t, ctx, postgres.Pool(), fixture.sessionID)
		blockerReleased := false
		defer func() {
			if !blockerReleased {
				_ = blocker.Rollback(context.Background())
			}
		}()

		selfPhone := "5511888877777"
		providerMessageID := fixture.suffix + "-native"
		nativeDone := make(chan error, 1)
		go func() {
			nativeDone <- repo.processNativeEvolutionMessages(ctx, pendingEvolutionWebhook{
				OrganizationID: fixture.organizationID,
				SessionID:      fixture.sessionID,
				EventType:      "messages.upsert",
				Payload:        []byte(`{}`),
			}, []nativeEvolutionMessage{{
				ProviderMessageID: providerMessageID,
				RemoteJID:         fixture.remoteJID,
				ContactPhone:      fixture.phone,
				ContactName:       fixture.suffix,
				SenderJID:         selfPhone + "@s.whatsapp.net",
				FromMe:            true,
				MessageType:       "text",
				Content:           "signed native outbound",
				SentAt:            time.Now().UTC(),
			}})
		}()
		waitForSessionConversationBlockedQueries(t, ctx, postgres.Pool(), 1)

		sendClientID := fixture.suffix + "-send"
		sendDone := make(chan error, 1)
		go func() {
			_, sendErr := repo.SendMessage(ctx, fixture.tenant, fixture.conversationID, sendMessageInput{
				Text:            "session-first native/send",
				ClientMessageID: sendClientID,
				ExpectedLeadID:  fixture.leadID,
			})
			sendDone <- sendErr
		}()
		waitForSessionConversationBlockedQueries(t, ctx, postgres.Pool(), 2)
		assertSessionConversationStillUnlocked(t, ctx, postgres.Pool(), fixture.conversationID)

		if err := blocker.Commit(ctx); err != nil {
			t.Fatal(err)
		}
		blockerReleased = true
		awaitSessionConversationOperation(t, "native session repair", nativeDone)
		awaitSessionConversationOperation(t, "SendMessage after native session repair", sendDone)

		assertSessionConversationMessageCount(t, ctx, postgres.Pool(), fixture, providerMessageID, 1)
		assertSessionConversationMessageCount(t, ctx, postgres.Pool(), fixture, sendClientID, 1)
		var storedPhone string
		if err := postgres.Pool().QueryRow(ctx, `
			select coalesce(phone_number, '')
			from public.whatsapp_sessions
			where id = $1::uuid
		`, fixture.sessionID).Scan(&storedPhone); err != nil {
			t.Fatal(err)
		}
		if storedPhone != selfPhone {
			t.Fatalf("native session phone repair = %q, want %q", storedPhone, selfPhone)
		}
	})
}

func TestNativeLegacyRecoveryConversationMessageLockOrder(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("WHATSAPP_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("WHATSAPP_TEST_DATABASE_URL is not set")
	}
	target, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatalf("parse WHATSAPP_TEST_DATABASE_URL: %v", err)
	}
	if hostname := strings.ToLower(target.Hostname()); hostname != "localhost" && hostname != "127.0.0.1" && hostname != "::1" {
		t.Fatalf("WHATSAPP_TEST_DATABASE_URL must point to loopback, got %q", target.Hostname())
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, HealthTimeout: 3 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(postgres.Close)
	fixture := createSessionConversationLockFixture(t, ctx, postgres.Pool(), "legacy-recovery")
	defer cleanupSessionConversationLockFixture(t, postgres.Pool(), fixture)

	providerMessageID := fixture.suffix + "-legacy-message"
	var messageID string
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_messages (
			organization_id, conversation_id, session_id, lead_id,
			provider_message_id, message_id, from_me, direction,
			message_type, content, remote_jid, status, sent_at, metadata
		) values (
			$1::uuid, $2::uuid, $3::uuid, $4::uuid,
			$5, $5, false, 'inbound', 'text', 'legacy recovery',
			$6, 'received', now(), '{}'::jsonb
		)
		returning id::text
	`, fixture.organizationID, fixture.conversationID, fixture.sessionID, fixture.leadID,
		providerMessageID, fixture.remoteJID).Scan(&messageID); err != nil {
		t.Fatal(err)
	}

	conversationBlocker, err := postgres.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	blockerReleased := false
	defer func() {
		if !blockerReleased {
			_ = conversationBlocker.Rollback(context.Background())
		}
	}()
	if _, err := conversationBlocker.Exec(ctx, `
		select id
		from public.whatsapp_conversations
		where id = $1::uuid
		for no key update
	`, fixture.conversationID); err != nil {
		t.Fatal(err)
	}

	recoveryDone := make(chan error, 1)
	go func() {
		tx, beginErr := postgres.Pool().Begin(ctx)
		if beginErr != nil {
			recoveryDone <- beginErr
			return
		}
		defer tx.Rollback(context.Background())
		var (
			lockedMessageID, lockedConversationID string
			messageLeadID, conversationLeadID     string
			remoteJID, recoveredProviderID        string
			content, messageType                  string
			sentAt                                time.Time
			messageMetadata, leadMetadata         string
		)
		recoveryErr := tx.QueryRow(
			ctx,
			nativeLegacyNonManagedRecoveryQuery,
			fixture.organizationID,
			fixture.sessionID,
			providerMessageID,
		).Scan(
			&lockedMessageID,
			&lockedConversationID,
			&messageLeadID,
			&conversationLeadID,
			&remoteJID,
			&recoveredProviderID,
			&content,
			&messageType,
			&sentAt,
			&messageMetadata,
			&leadMetadata,
		)
		if recoveryErr == nil && (lockedMessageID != messageID || lockedConversationID != fixture.conversationID) {
			recoveryErr = fmt.Errorf("legacy recovery locked message/conversation %s/%s, want %s/%s", lockedMessageID, lockedConversationID, messageID, fixture.conversationID)
		}
		if recoveryErr == nil {
			recoveryErr = tx.Commit(ctx)
		}
		recoveryDone <- recoveryErr
	}()
	waitForSessionConversationBlockedQuery(t, ctx, postgres.Pool(), "whatsapp-lock-order:native-legacy-recovery")
	assertSessionConversationMessageStillUnlocked(t, ctx, postgres.Pool(), messageID)

	if err := conversationBlocker.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	blockerReleased = true
	awaitSessionConversationOperation(t, "native legacy recovery", recoveryDone)
}

type sessionConversationLockFixture struct {
	suffix         string
	organizationID string
	userID         string
	leadID         string
	sessionID      string
	conversationID string
	phone          string
	remoteJID      string
	tenant         tenant.Context
}

func createSessionConversationLockFixture(
	t *testing.T,
	ctx context.Context,
	pool *pgxpool.Pool,
	label string,
) sessionConversationLockFixture {
	t.Helper()
	suffix := fmt.Sprintf("wa-session-conversation-%s-%d", label, time.Now().UnixNano())
	phone := fmt.Sprintf("55119%08d", time.Now().UnixNano()%100_000_000)
	fixture := sessionConversationLockFixture{suffix: suffix, phone: phone, remoteJID: phone + "@s.whatsapp.net"}
	if err := pool.QueryRow(ctx, `
		insert into public.organizations (name, slug)
		values ($1, $1)
		returning id::text
	`, suffix).Scan(&fixture.organizationID); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `select gen_random_uuid()::text`).Scan(&fixture.userID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `
		insert into auth.users (
			id, aud, role, email, encrypted_password, email_confirmed_at,
			raw_app_meta_data, raw_user_meta_data, created_at, updated_at
		) values (
			$1::uuid, 'authenticated', 'authenticated', $2, '', now(),
			'{}'::jsonb, '{}'::jsonb, now(), now()
		);
		insert into public.users (id, organization_id, name, email, role, is_active)
		values ($1::uuid, $3::uuid, $4, $2, 'admin', true)
		on conflict (id) do update
		set organization_id = excluded.organization_id,
		    name = excluded.name,
		    email = excluded.email,
		    role = excluded.role,
		    is_active = excluded.is_active;
		insert into public.organization_members (organization_id, user_id, role, is_active)
		values ($3::uuid, $1::uuid, 'admin', true)
		on conflict (user_id, organization_id) do update
		set role = excluded.role,
		    is_active = excluded.is_active,
		    deleted_at = null
	`, fixture.userID, suffix+"@example.invalid", fixture.organizationID, suffix); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `
		insert into public.leads (organization_id, assigned_user_id, name, phone, source)
		values ($1::uuid, $2::uuid, $3, $4, 'whatsapp')
		returning id::text
	`, fixture.organizationID, fixture.userID, suffix+"-lead", phone).Scan(&fixture.leadID); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `
		insert into public.whatsapp_sessions (
			organization_id, instance_name, instance_id, owner_user_id,
			provider, status, is_active, advanced_settings
		) values (
			$1::uuid, $2, $2, $3::uuid,
			'evolution_go', 'connected', true, '{}'::jsonb
		)
		returning id::text
	`, fixture.organizationID, suffix, fixture.userID).Scan(&fixture.sessionID); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `
		insert into public.whatsapp_conversations (
			organization_id, session_id, remote_jid, contact_phone,
			contact_name, assigned_user_id
		) values ($1::uuid, $2::uuid, $3, $4, $5, $6::uuid)
		returning id::text
	`, fixture.organizationID, fixture.sessionID, fixture.remoteJID, fixture.phone, suffix, fixture.userID).Scan(&fixture.conversationID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `
		select public.activate_whatsapp_conversation_lead_binding(
			$1::uuid, $2::uuid, $3::uuid, null
		)
	`, fixture.organizationID, fixture.conversationID, fixture.leadID); err != nil {
		t.Fatal(err)
	}
	fixture.tenant = tenant.Context{
		OrganizationID: fixture.organizationID,
		UserID:         fixture.userID,
		UserRole:       "admin",
		MemberRole:     "admin",
	}
	return fixture
}

func cleanupSessionConversationLockFixture(t *testing.T, pool *pgxpool.Pool, fixture sessionConversationLockFixture) {
	t.Helper()
	cleanupCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := pool.Exec(cleanupCtx, `
		delete from public.whatsapp_conversations where organization_id = $1::uuid;
		delete from public.whatsapp_sessions where organization_id = $1::uuid;
		delete from public.leads where organization_id = $1::uuid;
		delete from public.organization_members
		where organization_id = $1::uuid and user_id = $2::uuid;
		delete from public.users where id = $2::uuid;
		delete from auth.users where id = $2::uuid;
		delete from public.organizations where id = $1::uuid
	`, fixture.organizationID, fixture.userID); err != nil {
		t.Errorf("cleanup session/conversation lock fixture: %v", err)
	}
}

func holdSessionForUpdate(t *testing.T, ctx context.Context, pool *pgxpool.Pool, sessionID string) pgx.Tx {
	t.Helper()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `set local lock_timeout = '8s'`); err != nil {
		_ = tx.Rollback(ctx)
		t.Fatal(err)
	}
	if _, err := tx.Exec(ctx, `
		select id
		from public.whatsapp_sessions
		where id = $1::uuid
		for update
	`, sessionID); err != nil {
		_ = tx.Rollback(ctx)
		t.Fatal(err)
	}
	return tx
}

func waitForSessionConversationBlockedQueries(
	t *testing.T,
	ctx context.Context,
	pool *pgxpool.Pool,
	want int,
) {
	t.Helper()
	deadline := time.Now().Add(8 * time.Second)
	for time.Now().Before(deadline) {
		var count int
		if err := pool.QueryRow(ctx, `
			select count(*)::integer
			from pg_catalog.pg_stat_activity as activity
			where activity.datname = pg_catalog.current_database()
			  and activity.pid <> pg_catalog.pg_backend_pid()
			  and activity.state = 'active'
			  and activity.wait_event_type = 'Lock'
			  and activity.query ilike '%whatsapp_sessions%'
		`).Scan(&count); err != nil {
			t.Fatal(err)
		}
		if count >= want {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("waiting session query count did not reach %d", want)
}

func waitForSessionConversationBlockedQuery(
	t *testing.T,
	ctx context.Context,
	pool *pgxpool.Pool,
	fragment string,
) {
	t.Helper()
	deadline := time.Now().Add(8 * time.Second)
	for time.Now().Before(deadline) {
		var blocked bool
		if err := pool.QueryRow(ctx, `
			select exists (
			  select 1
			  from pg_catalog.pg_stat_activity as activity
			  where activity.datname = pg_catalog.current_database()
			    and activity.pid <> pg_catalog.pg_backend_pid()
			    and activity.state = 'active'
			    and activity.wait_event_type = 'Lock'
			    and activity.query ilike '%' || $1 || '%'
			)
		`, fragment).Scan(&blocked); err != nil {
			t.Fatal(err)
		}
		if blocked {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("query containing %q did not reach the expected lock wait", fragment)
}

func assertSessionConversationStillUnlocked(
	t *testing.T,
	ctx context.Context,
	pool *pgxpool.Pool,
	conversationID string,
) {
	t.Helper()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `
		select id
		from public.whatsapp_conversations
		where id = $1::uuid
		for update nowait
	`, conversationID); err != nil {
		t.Fatalf("operation locked conversation before acquiring session: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
}

func assertSessionConversationMessageStillUnlocked(
	t *testing.T,
	ctx context.Context,
	pool *pgxpool.Pool,
	messageID string,
) {
	t.Helper()
	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `
		select id
		from public.whatsapp_messages
		where id = $1::uuid
		for update nowait
	`, messageID); err != nil {
		t.Fatalf("legacy recovery locked message before conversation: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
}

func awaitSessionConversationOperation(t *testing.T, label string, done <-chan error) {
	t.Helper()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("%s: %v", label, err)
		}
	case <-time.After(8 * time.Second):
		t.Fatalf("%s did not finish; possible session/conversation deadlock", label)
	}
}

func assertSessionConversationMessageCount(
	t *testing.T,
	ctx context.Context,
	pool *pgxpool.Pool,
	fixture sessionConversationLockFixture,
	messageIdentity string,
	want int,
) {
	t.Helper()
	var count int
	if err := pool.QueryRow(ctx, `
		select count(*)::integer
		from public.whatsapp_messages
		where organization_id = $1::uuid
		  and session_id = $2::uuid
		  and conversation_id = $3::uuid
		  and (
			message_id = $4
			or provider_message_id = $4
			or client_message_id = $4
		  )
	`, fixture.organizationID, fixture.sessionID, fixture.conversationID, messageIdentity).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != want {
		t.Fatalf("message identity %q count = %d, want %d", messageIdentity, count, want)
	}
}
