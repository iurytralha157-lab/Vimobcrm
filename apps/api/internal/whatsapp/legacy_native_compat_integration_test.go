package whatsapp

import (
	"context"
	"testing"
	"time"
)

func TestLegacyUnlinkedConversationAgeRespectsRetentionEnrollment(t *testing.T) {
	ctx, postgres := webhookDependencyDatabase(t)
	owner := newWebhookDependencyFixture(t, ctx, postgres, "legacy-aged-owner")
	foreign := newWebhookDependencyFixture(t, ctx, postgres, "legacy-aged-foreign")
	var legacyID, enrolledID string
	for _, example := range []struct {
		remoteJID string
		enrolled  bool
		id        *string
	}{
		{"5511980000001@s.whatsapp.net", false, &legacyID},
		{"5511980000002@s.whatsapp.net", true, &enrolledID},
	} {
		if err := postgres.Pool().QueryRow(ctx, `
			insert into public.whatsapp_conversations (
				organization_id, session_id, remote_jid, unlinked_retention_v1, created_at
			) values ($1::uuid, $2::uuid, $3, $4, now() - interval '8 days')
			returning id::text
		`, owner.organizationID, owner.sessionID, example.remoteJID, example.enrolled).Scan(example.id); err != nil {
			t.Fatal(err)
		}
	}
	repo := NewRepository(postgres, nil, StorageConfig{LegacyNativeCompatEnabled: true})
	conversations, err := repo.ListConversations(ctx, owner.tenant, ConversationListFilter{SessionID: owner.sessionID, WithoutLead: true})
	if err != nil || len(conversations) != 1 || conversations[0].ID != legacyID {
		t.Fatalf("owner must see only the non-enrolled conversation, got %d rows (%v)", len(conversations), err)
	}
	conversations, err = repo.ListConversations(ctx, foreign.tenant, ConversationListFilter{WithoutLead: true})
	if err != nil || len(conversations) != 0 {
		t.Fatalf("foreign tenant received %d conversations (%v)", len(conversations), err)
	}
	if _, err := repo.GetConversationSnapshot(ctx, owner.tenant, enrolledID); err == nil {
		t.Fatal("expired enrolled conversation remained readable")
	}
}

func TestLegacyNativeReactionRequiresAttendanceAndDeduplicates(t *testing.T) {
	ctx, postgres := webhookDependencyDatabase(t)
	f := newWebhookDependencyFixture(t, ctx, postgres, "legacy-reaction")
	t.Cleanup(func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if _, err := postgres.Pool().Exec(cleanup, `
			delete from public.whatsapp_message_reactions where organization_id=$1::uuid;
			delete from public.whatsapp_messages where organization_id=$1::uuid;
		`, f.organizationID); err != nil {
			t.Error(err)
		}
	})
	target := f.suffix + "-target"
	if _, err := postgres.Pool().Exec(ctx, `
		insert into public.whatsapp_messages (
			organization_id, session_id, conversation_id, lead_id, remote_jid,
			message_id, provider_message_id, content, direction, from_me, capture_state
		) values ($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$6,'Synthetic','inbound',false,'captured')
	`, f.organizationID, f.sessionID, f.conversationID, f.leadID, f.remoteJID, target); err != nil {
		t.Fatal(err)
	}
	repo := NewRepository(postgres, nil, StorageConfig{LegacyNativeCompatEnabled: true})
	session := nativeEvolutionSession{ID: f.sessionID, OrganizationID: f.organizationID}
	message := nativeEvolutionMessage{
		ProviderMessageID: f.suffix + "-reaction", ReactionTargetID: target,
		RemoteJID: f.remoteJID, SenderJID: f.remoteJID, ReactionEmoji: "👍",
	}
	process := func() {
		t.Helper()
		tx, err := postgres.Pool().Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer rollbackWebhookTx(tx)
		message.SentAt = time.Now().UTC()
		if err := processLegacyNativeEvolutionReaction(ctx, tx, session, message, message.SentAt, nil); err != nil {
			t.Fatal(err)
		}
		if err := tx.Commit(ctx); err != nil {
			t.Fatal(err)
		}
	}
	check := func(want int) {
		t.Helper()
		var reactions, timeline int
		if err := postgres.Pool().QueryRow(ctx, `
			select
				(select count(*) from public.whatsapp_message_reactions
					where organization_id=$1::uuid and provider_reaction_message_id=$2),
				(select count(*) from public.whatsapp_messages where organization_id=$1::uuid
					and provider_message_id=$2 and message_type='reaction' and capture_state='captured')
		`, f.organizationID, message.ProviderMessageID).Scan(&reactions, &timeline); err != nil || reactions != want || timeline != want {
			t.Fatalf("legacy reaction effects = %d/%d, want %d each (%v)", reactions, timeline, want, err)
		}
	}
	process()
	check(0)
	if _, err := repo.JoinConversationAttendance(ctx, f.tenant, f.conversationID,
		attendanceInput{ExpectedLeadID: f.leadID, SendSessionID: f.sessionID}); err != nil {
		t.Fatal(err)
	}
	process()
	process()
	check(1)
}
