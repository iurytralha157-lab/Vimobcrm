package whatsapp

import (
	"context"
	"encoding/json"
	"testing"
	"time"
)

// Etapa 2: a recuperacao reextrai o conteudo do envelope retido e atualiza a
// linha suprimida por UPDATE, sem disparar automacao, sem mexer em nao lidas
// e sem jamais escrever historico no card de lead de outro responsavel.
func TestBacklogRecoveryRestoresSuppressedMessagesSilently(t *testing.T) {
	ctx, postgres := webhookDependencyDatabase(t)
	f := newWebhookDependencyFixture(t, ctx, postgres, "backlog-recovery")
	repo := NewRepository(postgres, nil, StorageConfig{})
	pool := postgres.Pool()

	sentAt := time.Now().UTC().Add(-2 * time.Hour).Truncate(time.Second)
	insertSuppressed := func(conversationID, leadID, providerMessageID, remoteJID string) string {
		t.Helper()
		var rowID string
		if err := pool.QueryRow(ctx, `
			insert into public.whatsapp_messages (
				organization_id, conversation_id, session_id, lead_id,
				provider_message_id, message_id, from_me, direction,
				message_type, remote_jid, status, sent_at, metadata, capture_state
			) values (
				$1::uuid, $2::uuid, $3::uuid, nullif($4, '')::uuid,
				$5, $5, false, 'inbound',
				'text', $6, 'received', $7,
				'{"whatsapp_attendance_capture":{"state":"suppressed"}}'::jsonb, 'suppressed'
			)
			returning id::text
		`, f.organizationID, conversationID, f.sessionID, leadID,
			providerMessageID, remoteJID, sentAt).Scan(&rowID); err != nil {
			t.Fatal(err)
		}
		return rowID
	}

	// Conversa do lead do dono da conexao: deve virar historico visivel.
	leadMessageID := f.suffix + "-lead-msg"
	leadRowID := insertSuppressed(f.conversationID, f.leadID, leadMessageID, f.remoteJID)

	// Conversa sem lead (caixa "Sem lead"): recupera oculta como unlinked.
	unlinkedJID := "5511977770001@s.whatsapp.net"
	var unlinkedConversationID string
	if err := pool.QueryRow(ctx, `
		insert into public.whatsapp_conversations (
			organization_id, session_id, remote_jid, contact_phone, contact_name
		) values ($1::uuid, $2::uuid, $3, '5511977770001', $4)
		returning id::text
	`, f.organizationID, f.sessionID, unlinkedJID, f.suffix+"-semlead").Scan(&unlinkedConversationID); err != nil {
		t.Fatal(err)
	}
	unlinkedMessageID := f.suffix + "-unlinked-msg"
	unlinkedRowID := insertSuppressed(unlinkedConversationID, "", unlinkedMessageID, unlinkedJID)

	// Lead de outro responsavel na mesma conexao: permanece suprimida.
	var foreignUserID string
	if err := pool.QueryRow(ctx, `select gen_random_uuid()::text`).Scan(&foreignUserID); err != nil {
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
		values ($1::uuid, $3::uuid, $2, $2, 'corretor', true)
		on conflict (id) do update
		set organization_id = excluded.organization_id,
		    name = excluded.name,
		    email = excluded.email,
		    role = excluded.role,
		    is_active = excluded.is_active;
		insert into public.organization_members (organization_id, user_id, role, is_active)
		values ($3::uuid, $1::uuid, 'corretor', true)
		on conflict (user_id, organization_id) do update
		set role = excluded.role,
		    is_active = excluded.is_active,
		    deleted_at = null
	`, foreignUserID, f.suffix+"-foreign@example.invalid", f.organizationID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		cleanupCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_, _ = pool.Exec(cleanupCtx, `
			delete from public.whatsapp_webhook_inbox where organization_id = $1::uuid;
			update public.leads set assigned_user_id = $3::uuid
			where organization_id = $1::uuid and assigned_user_id = $2::uuid;
			delete from public.organization_members where organization_id = $1::uuid and user_id = $2::uuid;
			delete from public.users where id = $2::uuid;
			delete from auth.users where id = $2::uuid
		`, f.organizationID, foreignUserID, f.userID)
	})
	foreignJID := "5511977770002@s.whatsapp.net"
	var foreignLeadID, foreignConversationID string
	if err := pool.QueryRow(ctx, `
		insert into public.leads (organization_id, assigned_user_id, name, phone, source)
		values ($1::uuid, $2::uuid, $3, '5511977770002', 'whatsapp')
		returning id::text
	`, f.organizationID, foreignUserID, f.suffix+"-foreign-lead").Scan(&foreignLeadID); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `
		insert into public.whatsapp_conversations (
			organization_id, session_id, remote_jid, contact_phone, contact_name, assigned_user_id
		) values ($1::uuid, $2::uuid, $3, '5511977770002', $4, $5::uuid)
		returning id::text
	`, f.organizationID, f.sessionID, foreignJID, f.suffix+"-foreign", foreignUserID).Scan(&foreignConversationID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `
		select public.activate_whatsapp_conversation_lead_binding($1::uuid, $2::uuid, $3::uuid, null)
	`, f.organizationID, foreignConversationID, foreignLeadID); err != nil {
		t.Fatal(err)
	}
	foreignMessageID := f.suffix + "-foreign-msg"
	foreignRowID := insertSuppressed(foreignConversationID, foreignLeadID, foreignMessageID, foreignJID)

	buildEnvelope := func(providerMessageID, remoteJID, text string) backlogRecoveryEnvelope {
		payload, err := json.Marshal(map[string]any{
			"event": "messages.upsert",
			"data": map[string]any{
				"messages": []map[string]any{{
					"key": map[string]any{
						"id":        providerMessageID,
						"remoteJid": remoteJID,
						"fromMe":    false,
					},
					"message":          map[string]any{"conversation": text},
					"messageTimestamp": sentAt.Unix(),
					"pushName":         "Contato Backlog",
				}},
			},
		})
		if err != nil {
			t.Fatal(err)
		}
		return backlogRecoveryEnvelope{
			ID:             providerMessageID,
			OrganizationID: f.organizationID,
			SessionID:      f.sessionID,
			Payload:        payload,
			CreatedAt:      sentAt,
		}
	}

	// Antes da recuperacao, a conversa sem lead e um card fantasma: nao pode
	// aparecer na caixa principal.
	assertListed := func(wantMain map[string]bool, withoutLead bool, label string) {
		t.Helper()
		listed, err := repo.ListConversations(ctx, f.tenant, ConversationListFilter{WithoutLead: withoutLead})
		if err != nil {
			t.Fatalf("%s: %v", label, err)
		}
		found := map[string]bool{}
		for _, conversation := range listed {
			found[conversation.ID] = true
		}
		for id, want := range wantMain {
			if found[id] != want {
				t.Fatalf("%s: conversa %s listada=%v, esperado %v", label, id, found[id], want)
			}
		}
	}
	assertListed(map[string]bool{f.conversationID: true, unlinkedConversationID: false}, false, "lista antes")

	tx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	sessions := map[string]*nativeEvolutionSession{}
	totalLead, totalUnlinked := 0, 0
	for _, envelope := range []backlogRecoveryEnvelope{
		buildEnvelope(leadMessageID, f.remoteJID, "mensagem do lead recuperada"),
		buildEnvelope(unlinkedMessageID, unlinkedJID, "mensagem sem lead recuperada"),
		buildEnvelope(foreignMessageID, foreignJID, "mensagem de lead alheio"),
	} {
		leadCount, unlinkedCount, err := repo.recoverBacklogEnvelope(ctx, tx, sessions, envelope)
		if err != nil {
			t.Fatal(err)
		}
		totalLead += leadCount
		totalUnlinked += unlinkedCount
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if totalLead != 1 || totalUnlinked != 1 {
		t.Fatalf("recuperadas lead=%d unlinked=%d, esperado 1/1", totalLead, totalUnlinked)
	}

	assertMessage := func(rowID, wantState, wantContent string, label string) {
		t.Helper()
		var state, content string
		if err := pool.QueryRow(ctx, `
			select coalesce(capture_state, ''), coalesce(content, '')
			from public.whatsapp_messages where id = $1::uuid
		`, rowID).Scan(&state, &content); err != nil {
			t.Fatalf("%s: %v", label, err)
		}
		if state != wantState || content != wantContent {
			t.Fatalf("%s: state=%q content=%q, esperado %q/%q", label, state, content, wantState, wantContent)
		}
	}
	assertMessage(leadRowID, "captured", "mensagem do lead recuperada", "mensagem do lead")
	assertMessage(unlinkedRowID, "unlinked_ephemeral", "mensagem sem lead recuperada", "mensagem sem lead")
	// Card de outro responsavel nunca recebe historico de conexao alheia.
	assertMessage(foreignRowID, "suppressed", "", "mensagem de lead alheio")

	// Silencio: a recuperacao nao mexe no contador de nao lidas, mas atualiza
	// a previa monotonica da conversa do lead.
	var unread int
	var preview string
	if err := pool.QueryRow(ctx, `
		select coalesce(unread_count, 0), coalesce(last_message_preview, '')
		from public.whatsapp_conversations where id = $1::uuid
	`, f.conversationID).Scan(&unread, &preview); err != nil {
		t.Fatal(err)
	}
	if unread != 0 {
		t.Fatalf("recuperacao alterou unread_count para %d", unread)
	}
	if preview != "mensagem do lead recuperada" {
		t.Fatalf("previa nao atualizada: %q", preview)
	}

	// Reprocessar o mesmo envelope e idempotente: a linha ja nao esta
	// suprimida, entao nada muda.
	tx2, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx2.Rollback(ctx)
	leadAgain, unlinkedAgain, err := repo.recoverBacklogEnvelope(ctx, tx2, map[string]*nativeEvolutionSession{},
		buildEnvelope(leadMessageID, f.remoteJID, "mensagem do lead recuperada"))
	if err != nil {
		t.Fatal(err)
	}
	if err := tx2.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	if leadAgain != 0 || unlinkedAgain != 0 {
		t.Fatalf("replay recuperou de novo: lead=%d unlinked=%d", leadAgain, unlinkedAgain)
	}

	// Depois da recuperacao o card sem lead continua fora da caixa principal
	// (conteudo e da futura caixa "Sem lead"), e aparece no filtro withoutLead.
	assertListed(map[string]bool{f.conversationID: true, unlinkedConversationID: false}, false, "lista depois")
	assertListed(map[string]bool{unlinkedConversationID: true}, true, "filtro sem lead")
}
