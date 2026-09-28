package whatsapp

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func TestCompleteWhatsAppOutboxRejectsProjectionConversationMismatch(t *testing.T) {
	databaseURL := os.Getenv("WHATSAPP_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("WHATSAPP_TEST_DATABASE_URL is not set")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, HealthTimeout: 3 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(postgres.Close)

	suffix := fmt.Sprintf("wa-outbox-conversation-fence-%d", time.Now().UnixNano())
	var organizationID, userID, sessionID, pendingConversationID, foreignConversationID string
	if err := postgres.Pool().QueryRow(ctx, `select gen_random_uuid()::text, gen_random_uuid()::text`).Scan(&organizationID, &userID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cleanupCancel()
		_, _ = postgres.Pool().Exec(cleanupCtx, `delete from public.organizations where id = $1::uuid`, organizationID)
		_, _ = postgres.Pool().Exec(cleanupCtx, `delete from auth.users where id = $1::uuid`, userID)
	})

	if _, err := postgres.Pool().Exec(ctx, `
		insert into public.organizations (id, name, slug)
		values ($1::uuid, $2, $2)
	`, organizationID, suffix); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		insert into auth.users (
			id, aud, role, email, encrypted_password,
			raw_app_meta_data, raw_user_meta_data, created_at, updated_at
		) values (
			$1::uuid, 'authenticated', 'authenticated', $2, '',
			'{}'::jsonb, '{}'::jsonb, now(), now()
		)
	`, userID, suffix+"@example.invalid"); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		insert into public.users (id, organization_id, name, email, role, is_active)
		values ($1::uuid, $2::uuid, $3, $4, 'user', true)
	`, userID, organizationID, suffix, suffix+"@example.invalid"); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		insert into public.organization_members (organization_id, user_id, role, is_active)
		values ($1::uuid, $2::uuid, 'user', true)
	`, organizationID, userID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_sessions (
			organization_id, owner_user_id, instance_name, instance_id,
			provider, status, is_active, advanced_settings
		) values ($1::uuid, $2::uuid, $3, $3, 'evolution_go', 'connected', true, '{}'::jsonb)
		returning id::text
	`, organizationID, userID, suffix).Scan(&sessionID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_conversations (
			organization_id, session_id, assigned_user_id, remote_jid, contact_name
		) values ($1::uuid, $2::uuid, $3::uuid, '5511999990101@s.whatsapp.net', $4)
		returning id::text
	`, organizationID, sessionID, userID, suffix+"-pending").Scan(&pendingConversationID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_conversations (
			organization_id, session_id, assigned_user_id, remote_jid, contact_name
		) values ($1::uuid, $2::uuid, $3::uuid, '5511999990102@s.whatsapp.net', $4)
		returning id::text
	`, organizationID, sessionID, userID, suffix+"-foreign").Scan(&foreignConversationID); err != nil {
		t.Fatal(err)
	}

	clientMessageID := suffix + "-client"
	providerMessageID := suffix + "-provider"
	leaseToken := suffix + "-lease"
	var pendingMessageID, collisionMessageID, outboxID string
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_messages (
			organization_id, conversation_id, session_id, sender_user_id,
			message_id, client_message_id, from_me, direction, content,
			message_type, remote_jid, status, metadata
		) values (
			$1::uuid, $2::uuid, $3::uuid, $4::uuid,
			$5, $5, true, 'outbound', 'pending projection',
			'text', '5511999990101@s.whatsapp.net', 'queued', '{"delivery":"outbox"}'::jsonb
		)
		returning id::text
	`, organizationID, pendingConversationID, sessionID, userID, clientMessageID).Scan(&pendingMessageID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_messages (
			organization_id, conversation_id, session_id, sender_user_id,
			message_id, provider_message_id, from_me, direction, content,
			message_type, remote_jid, status, sent_at, metadata
		) values (
			$1::uuid, $2::uuid, $3::uuid, $4::uuid,
			$5, $5, true, 'outbound', 'foreign collision',
			'text', '5511999990102@s.whatsapp.net', 'sent', now(), '{"delivery":"webhook"}'::jsonb
		)
		returning id::text
	`, organizationID, foreignConversationID, sessionID, userID, providerMessageID).Scan(&collisionMessageID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_outbox (
			organization_id, session_id, conversation_id, message_id,
			client_message_id, recipient_jid, message_type, payload,
			status, locked_at, locked_by
		) values (
			$1::uuid, $2::uuid, $3::uuid, $4::uuid,
			$5, '5511999990101@s.whatsapp.net', 'text',
			'{"action":"send.text"}'::jsonb, 'processing', now(), $6
		)
		returning id::text
	`, organizationID, sessionID, pendingConversationID, pendingMessageID, clientMessageID, leaseToken).Scan(&outboxID); err != nil {
		t.Fatal(err)
	}

	repo := NewRepository(postgres, nil, StorageConfig{})
	item := pendingWhatsAppOutbox{
		ID:              outboxID,
		OrganizationID:  organizationID,
		SessionID:       sessionID,
		ConversationID:  foreignConversationID,
		MessageRowID:    pendingMessageID,
		ClientMessageID: clientMessageID,
		Payload:         map[string]any{"action": "send.text"},
		LeaseToken:      leaseToken,
	}
	err = repo.completeWhatsAppOutbox(ctx, item, providerMessageID)
	if !errors.Is(err, ErrProviderFailed) || !strings.Contains(err.Error(), "conversation mismatch") {
		t.Fatalf("completeWhatsAppOutbox() error = %v, want fail-closed pending projection mismatch", err)
	}

	item.ConversationID = pendingConversationID
	err = repo.completeWhatsAppOutbox(ctx, item, providerMessageID)
	if !errors.Is(err, ErrProviderFailed) || !strings.Contains(err.Error(), "conversation mismatch") {
		t.Fatalf("completeWhatsAppOutbox() error = %v, want fail-closed cross-conversation collision", err)
	}

	var outboxStatus, outboxLockedBy, outboxProviderID string
	if err := postgres.Pool().QueryRow(ctx, `
		select status, coalesce(locked_by, ''), coalesce(provider_message_id, '')
		from public.whatsapp_outbox
		where id = $1::uuid
	`, outboxID).Scan(&outboxStatus, &outboxLockedBy, &outboxProviderID); err != nil {
		t.Fatal(err)
	}
	if outboxStatus != "processing" || outboxLockedBy != leaseToken || outboxProviderID != "" {
		t.Fatalf("outbox mutated after collision: status=%q locked_by=%q provider_id=%q", outboxStatus, outboxLockedBy, outboxProviderID)
	}

	var pendingStatus, pendingProviderID, pendingClientID string
	if err := postgres.Pool().QueryRow(ctx, `
		select status, coalesce(provider_message_id, ''), coalesce(client_message_id, '')
		from public.whatsapp_messages
		where id = $1::uuid
	`, pendingMessageID).Scan(&pendingStatus, &pendingProviderID, &pendingClientID); err != nil {
		t.Fatal(err)
	}
	if pendingStatus != "queued" || pendingProviderID != "" || pendingClientID != clientMessageID {
		t.Fatalf("pending projection mutated after collision: status=%q provider_id=%q client_id=%q", pendingStatus, pendingProviderID, pendingClientID)
	}

	var collisionConversationID, collisionClientID string
	if err := postgres.Pool().QueryRow(ctx, `
		select conversation_id::text, coalesce(client_message_id, '')
		from public.whatsapp_messages
		where id = $1::uuid
	`, collisionMessageID).Scan(&collisionConversationID, &collisionClientID); err != nil {
		t.Fatal(err)
	}
	if collisionConversationID != foreignConversationID || collisionClientID != "" {
		t.Fatalf("foreign collision was merged: conversation=%q client_id=%q", collisionConversationID, collisionClientID)
	}
}

func TestClaimWhatsAppOutboxSeparatesMediaWithoutReorderingConversation(t *testing.T) {
	databaseURL := os.Getenv("WHATSAPP_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("WHATSAPP_TEST_DATABASE_URL is not set")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, HealthTimeout: 3 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(postgres.Close)

	suffix := fmt.Sprintf("wa-outbox-lanes-%d", time.Now().UnixNano())
	var organizationID, userID, sessionID, conversationA, conversationB, conversationC string
	if err := postgres.Pool().QueryRow(ctx, `select gen_random_uuid()::text, gen_random_uuid()::text`).Scan(&organizationID, &userID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cleanupCancel()
		_, _ = postgres.Pool().Exec(cleanupCtx, `delete from public.organizations where id = $1::uuid`, organizationID)
		_, _ = postgres.Pool().Exec(cleanupCtx, `delete from auth.users where id = $1::uuid`, userID)
	})

	if _, err := postgres.Pool().Exec(ctx, `
		insert into public.organizations (id, name, slug)
		values ($1::uuid, $2, $2)
	`, organizationID, suffix); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		insert into auth.users (
			id, aud, role, email, encrypted_password,
			raw_app_meta_data, raw_user_meta_data, created_at, updated_at
		) values (
			$1::uuid, 'authenticated', 'authenticated', $2, '',
			'{}'::jsonb, '{}'::jsonb, now(), now()
		)
	`, userID, suffix+"@example.invalid"); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		insert into public.users (id, organization_id, name, email, role, is_active)
		values ($1::uuid, $2::uuid, $3, $4, 'user', true)
	`, userID, organizationID, suffix, suffix+"@example.invalid"); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		insert into public.organization_members (organization_id, user_id, role, is_active)
		values ($1::uuid, $2::uuid, 'user', true) on conflict do nothing
	`, organizationID, userID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_sessions (
			organization_id, owner_user_id, instance_name, instance_id,
			provider, status, is_active, advanced_settings
		) values ($1::uuid, $2::uuid, $3, $3, 'evolution_go', 'connected', true, '{}'::jsonb)
		returning id::text
	`, organizationID, userID, suffix).Scan(&sessionID); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_conversations (
			organization_id, session_id, assigned_user_id, remote_jid, contact_name
		) values ($1::uuid, $2::uuid, $3::uuid, '5511999990001@s.whatsapp.net', $4)
		returning id::text
	`, organizationID, sessionID, userID, suffix+"-a").Scan(&conversationA); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_conversations (
			organization_id, session_id, assigned_user_id, remote_jid, contact_name
		) values ($1::uuid, $2::uuid, $3::uuid, '5511999990002@s.whatsapp.net', $4)
		returning id::text
	`, organizationID, sessionID, userID, suffix+"-b").Scan(&conversationB); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		insert into public.whatsapp_conversations (
			organization_id, session_id, assigned_user_id, remote_jid, contact_name
		) values ($1::uuid, $2::uuid, $3::uuid, '5511999990003@s.whatsapp.net', $4)
		returning id::text
	`, organizationID, sessionID, userID, suffix+"-c").Scan(&conversationC); err != nil {
		t.Fatal(err)
	}
	leadByConversation := make(map[string]string, 3)
	for index, conversationID := range []string{conversationA, conversationB, conversationC} {
		var leadID string
		if err := postgres.Pool().QueryRow(ctx, `
			insert into public.leads (organization_id, assigned_user_id, name, source)
			values ($1::uuid, $2::uuid, $3, 'manual') returning id::text
		`, organizationID, userID, fmt.Sprintf("%s-lead-%d", suffix, index)).Scan(&leadID); err != nil {
			t.Fatal(err)
		}
		if _, err := postgres.Pool().Exec(ctx, `
			select public.activate_whatsapp_conversation_lead_binding(
			  $1::uuid, $2::uuid, $3::uuid, null
			)
		`, organizationID, conversationID, leadID); err != nil {
			t.Fatal(err)
		}
		leadByConversation[conversationID] = leadID
	}

	insertFixture := func(conversationID, clientID, messageType, action, age string) string {
		t.Helper()
		var messageID, outboxID string
		if err := postgres.Pool().QueryRow(ctx, `
			insert into public.whatsapp_messages (
				organization_id, conversation_id, session_id, lead_id, sender_user_id,
				message_id, client_message_id, from_me, direction, content,
				message_type, remote_jid, status, sent_at, metadata
			) values (
				$1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
				$6, $6, true, 'outbound', $6,
				$7, '5511999990000@s.whatsapp.net', 'queued', now() - $8::interval,
				'{"delivery":"outbox"}'::jsonb
			)
			returning id::text
		`, organizationID, conversationID, sessionID, leadByConversation[conversationID],
			userID, clientID, messageType, age).Scan(&messageID); err != nil {
			t.Fatal(err)
		}
		if err := postgres.Pool().QueryRow(ctx, `
			insert into public.whatsapp_outbox (
				organization_id, session_id, conversation_id, message_id,
				client_message_id, recipient_jid, message_type, payload,
				status, next_attempt_at, created_at
			) values (
				$1::uuid, $2::uuid, $3::uuid, $4::uuid,
				$5, '5511999990000@s.whatsapp.net', $6,
				jsonb_build_object('action', $7, 'body', jsonb_build_object('number', '5511999990000')),
				'pending', now() - $8::interval, now() - $8::interval
			)
			returning id::text
		`, organizationID, sessionID, conversationID, messageID, clientID, messageType, action, age).Scan(&outboxID); err != nil {
			t.Fatal(err)
		}
		return outboxID
	}

	mediaA := insertFixture(conversationA, suffix+"-a-media", "image", "send.media", "3 minutes")
	textA := insertFixture(conversationA, suffix+"-a-text", "text", "send.text", "2 minutes")
	textASecond := insertFixture(conversationA, suffix+"-a-text-second", "text", "send.text", "90 seconds")
	textB := insertFixture(conversationB, suffix+"-b-text", "text", "send.text", "1 minute")
	if _, err := postgres.Pool().Exec(ctx, `
		update public.whatsapp_outbox
		set status = 'retry', attempts = 1, next_attempt_at = now() + interval '10 minutes'
		where id = $1::uuid
	`, mediaA); err != nil {
		t.Fatal(err)
	}

	repo := NewRepository(postgres, nil, StorageConfig{})
	afterEnd, err := repo.claimWhatsAppOutboxWithBatchAfterConversation(
		ctx,
		10,
		"ffffffff-ffff-ffff-ffff-ffffffffffff",
		whatsappOutboxLaneFast,
	)
	if err != nil {
		t.Fatalf("fast-lane monotonic cursor claim: %v", err)
	}
	if len(afterEnd) != 0 {
		t.Fatalf("fast-lane claim after UUID range = %#v, want explicit Go-side wrap", afterEnd)
	}
	fast, err := repo.claimWhatsAppOutboxWithBatchAfterConversation(ctx, 10, "", whatsappOutboxLaneFast)
	if err != nil {
		t.Fatalf("fast-lane claim: %v", err)
	}
	if len(fast) != 2 {
		t.Fatalf("fast-lane claim = %#v, want both due text rows", fast)
	}
	claimedFast := map[string]bool{}
	claimedFastItems := map[string]pendingWhatsAppOutbox{}
	for _, item := range fast {
		claimedFast[item.ID] = true
		claimedFastItems[item.ID] = item
		if item.LeaseToken == "" {
			t.Fatalf("claimed outbox %s has no lease token", item.ID)
		}
	}
	if !claimedFast[textA] || !claimedFast[textB] {
		t.Fatalf("fast-lane IDs = %#v, want conversation A text %s to pass deferred media %s and conversation B text %s", claimedFast, textA, mediaA, textB)
	}
	if claimedFast[textASecond] {
		t.Fatalf("newer same-conversation text %s overtook fast-lane head %s", textASecond, textA)
	}
	var overtakingTextStatus string
	if err := postgres.Pool().QueryRow(ctx, `select status from public.whatsapp_outbox where id = $1::uuid`, textA).Scan(&overtakingTextStatus); err != nil {
		t.Fatal(err)
	}
	if overtakingTextStatus != "processing" {
		t.Fatalf("conversation A text status = %q, want processing after the bounded media grace", overtakingTextStatus)
	}
	var secondTextStatus string
	if err := postgres.Pool().QueryRow(ctx, `select status from public.whatsapp_outbox where id = $1::uuid`, textASecond).Scan(&secondTextStatus); err != nil {
		t.Fatal(err)
	}
	if secondTextStatus != "pending" {
		t.Fatalf("second conversation A text status = %q, want pending behind first text head", secondTextStatus)
	}

	media, err := repo.claimWhatsAppOutboxWithBatchAfterConversation(ctx, 10, "", whatsappOutboxLaneMedia)
	if err != nil {
		t.Fatalf("media-lane claim: %v", err)
	}
	if len(media) != 0 {
		t.Fatalf("media-lane claim before retry deadline = %#v, want no claim", media)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		update public.whatsapp_outbox
		set next_attempt_at = now() - interval '1 second'
		where id = $1::uuid
	`, mediaA); err != nil {
		t.Fatal(err)
	}
	media, err = repo.claimWhatsAppOutboxWithBatchAfterConversation(ctx, 10, "", whatsappOutboxLaneMedia)
	if err != nil {
		t.Fatalf("media-lane claim after retry deadline: %v", err)
	}
	if len(media) != 1 || media[0].ID != mediaA {
		t.Fatalf("media-lane claim = %#v, want conversation A media %s", media, mediaA)
	}
	if media[0].SessionID != fast[0].SessionID {
		t.Fatal("fixture must prove independent conversations can progress on the same WhatsApp session")
	}

	acceptedItem := claimedFastItems[textA]
	startedItem := claimedFastItems[textB]
	if acceptedItem.LeaseToken == startedItem.LeaseToken {
		t.Fatal("different claims unexpectedly share one lease token")
	}
	if _, err := postgres.Pool().Exec(ctx, `
		update public.whatsapp_outbox
		set attempts = max_attempts,
		    last_error = $2,
		    locked_at = now() - interval '6 minutes'
		where id = $1::uuid
	`, acceptedItem.ID, whatsappOutboxProviderAcceptedMarker); err != nil {
		t.Fatal(err)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		update public.whatsapp_outbox
		set last_error = $2,
		    locked_at = now() - interval '6 minutes'
		where id = $1::uuid
	`, startedItem.ID, whatsappOutboxProviderStartedMarker); err != nil {
		t.Fatal(err)
	}
	if err := repo.RecoverStaleWhatsAppOutbox(ctx); err != nil {
		t.Fatalf("stale recovery: %v", err)
	}

	var acceptedStatus, acceptedMarker string
	var acceptedUnlocked bool
	if err := postgres.Pool().QueryRow(ctx, `
		select status, coalesce(last_error, ''), locked_by is null
		from public.whatsapp_outbox
		where id = $1::uuid
	`, acceptedItem.ID).Scan(&acceptedStatus, &acceptedMarker, &acceptedUnlocked); err != nil {
		t.Fatal(err)
	}
	if acceptedStatus != "retry" || acceptedMarker != whatsappOutboxProviderAcceptedMarker || !acceptedUnlocked {
		t.Fatalf("accepted stale row = status %q marker %q unlocked %t; want retry/finalization marker/unlocked", acceptedStatus, acceptedMarker, acceptedUnlocked)
	}

	var startedStatus, startedMarker string
	if err := postgres.Pool().QueryRow(ctx, `
		select status, coalesce(last_error, '')
		from public.whatsapp_outbox
		where id = $1::uuid
	`, startedItem.ID).Scan(&startedStatus, &startedMarker); err != nil {
		t.Fatal(err)
	}
	if startedStatus != "dead" || startedMarker != whatsappOutboxProviderUnknownMarker {
		t.Fatalf("started stale row = status %q marker %q; want dead/outcome-unknown", startedStatus, startedMarker)
	}

	reclaimed, err := repo.claimWhatsAppOutboxWithBatchAfterConversation(ctx, 1, "", whatsappOutboxLaneFast)
	if err != nil {
		t.Fatalf("reclaim accepted finalization: %v", err)
	}
	if len(reclaimed) != 1 || reclaimed[0].ID != acceptedItem.ID {
		t.Fatalf("accepted finalization reclaim = %#v, want %s", reclaimed, acceptedItem.ID)
	}
	if reclaimed[0].LeaseToken == acceptedItem.LeaseToken {
		t.Fatal("stale reclaim reused the old lease token")
	}
	if owned, err := repo.renewWhatsAppOutboxLease(ctx, acceptedItem); err != nil || owned {
		t.Fatalf("old lease renewal = %t, %v; want fenced loss", owned, err)
	}
	if owned, err := repo.renewWhatsAppOutboxLease(ctx, reclaimed[0]); err != nil || !owned {
		t.Fatalf("new lease renewal = %t, %v; want current ownership", owned, err)
	}

	compatibilityID := insertFixture(conversationC, suffix+"-c-any", "text", "send.text", "1 minute")
	compatibilityClaim, err := repo.claimWhatsAppOutboxWithBatchAfterConversation(
		ctx,
		1,
		"",
		whatsappOutboxLaneAny,
	)
	if err != nil {
		t.Fatalf("compatibility any-lane claim: %v", err)
	}
	if len(compatibilityClaim) != 1 || compatibilityClaim[0].ID != compatibilityID {
		t.Fatalf("compatibility any-lane claim = %#v, want %s", compatibilityClaim, compatibilityID)
	}
	if _, err := postgres.Pool().Exec(ctx, `
		update public.whatsapp_outbox set status = 'sent', locked_at = null, locked_by = null
		where id = $1::uuid and status = 'processing'
	`, compatibilityID); err != nil {
		t.Fatal(err)
	}
	concurrentHead := insertFixture(conversationC, suffix+"-c-concurrent-head", "text", "send.text", "30 seconds")
	concurrentNext := insertFixture(conversationC, suffix+"-c-concurrent-next", "text", "send.text", "20 seconds")
	type claimResult struct {
		items []pendingWhatsAppOutbox
		err   error
	}
	start := make(chan struct{})
	results := make(chan claimResult, 2)
	var claimers sync.WaitGroup
	for range 2 {
		claimers.Add(1)
		go func() {
			defer claimers.Done()
			<-start
			items, err := repo.claimWhatsAppOutboxWithBatchAfterConversation(
				ctx, 1, "", whatsappOutboxLaneFast,
			)
			results <- claimResult{items: items, err: err}
		}()
	}
	close(start)
	claimers.Wait()
	close(results)
	claimedCount := 0
	for result := range results {
		if result.err != nil {
			t.Fatalf("concurrent outbox claim: %v", result.err)
		}
		for _, item := range result.items {
			claimedCount++
			if item.ID != concurrentHead {
				t.Fatalf("concurrent claim took %s before FIFO head %s", item.ID, concurrentHead)
			}
		}
	}
	if claimedCount != 1 {
		t.Fatalf("same-conversation concurrent claims = %d, want one", claimedCount)
	}
	var nextStatus string
	if err := postgres.Pool().QueryRow(ctx, `
		select status from public.whatsapp_outbox where id = $1::uuid
	`, concurrentNext).Scan(&nextStatus); err != nil {
		t.Fatal(err)
	}
	if nextStatus != "pending" {
		t.Fatalf("second same-conversation outbox status = %q, want pending", nextStatus)
	}

	// Cancellation while the claim statement waits on a table lock must not
	// commit the UPDATE or leave a leased row without a worker to deliver it.
	lockTx, err := postgres.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer lockTx.Rollback(context.Background())
	if _, err := lockTx.Exec(ctx, `lock table public.whatsapp_outbox in access exclusive mode`); err != nil {
		t.Fatal(err)
	}
	cancelCtx, cancelClaim := context.WithTimeout(ctx, 100*time.Millisecond)
	_, canceledErr := repo.claimWhatsAppOutboxWithBatchAfterConversation(
		cancelCtx, 1, "", whatsappOutboxLaneFast,
	)
	cancelClaim()
	if canceledErr == nil {
		t.Fatal("outbox claim succeeded while table remained exclusively locked")
	}
	if err := lockTx.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		select status from public.whatsapp_outbox where id = $1::uuid
	`, concurrentNext).Scan(&nextStatus); err != nil {
		t.Fatal(err)
	}
	if nextStatus != "pending" {
		t.Fatalf("canceled claim left an unowned lease: %q", nextStatus)
	}

	// The batch keeps its transaction open until the caller has decoded every
	// returned row. A scan failure can therefore roll back the lease update.
	scanTx, err := postgres.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer scanTx.Rollback(context.Background())
	scanBatch := &pgx.Batch{}
	scanBatch.Queue(`set local statement_timeout = '5s'`)
	scanBatch.Queue(`
		update public.whatsapp_outbox
		set status = 'processing', locked_at = now(), locked_by = 'test-scan-failure'
		where id = $1::uuid and status = 'pending'
		returning id::text
	`, concurrentNext)
	scanResults := scanTx.SendBatch(ctx, scanBatch)
	if _, err := scanResults.Exec(); err != nil {
		t.Fatal(err)
	}
	scanRows, err := scanResults.Query()
	if err != nil {
		t.Fatal(err)
	}
	if !scanRows.Next() {
		t.Fatal("scan-error batch did not return the updated lease")
	}
	var invalidInt int
	if err := scanRows.Scan(&invalidInt); err == nil {
		t.Fatal("scan-error batch unexpectedly decoded UUID as an integer")
	}
	scanRows.Close()
	_ = scanResults.Close()
	if err := scanTx.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	if err := postgres.Pool().QueryRow(ctx, `
		select status from public.whatsapp_outbox where id = $1::uuid
	`, concurrentNext).Scan(&nextStatus); err != nil {
		t.Fatal(err)
	}
	if nextStatus != "pending" {
		t.Fatalf("scan failure committed an outbox lease: %q", nextStatus)
	}
}
