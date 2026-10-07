package whatsapp

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

// TestSessionSharingSendAndRevocation requires an isolated local database with
// the sharing migration applied. It never accepts a remote database URL.
func TestSessionSharingSendAndRevocation(t *testing.T) {
	databaseURL := strings.TrimSpace(os.Getenv("WHATSAPP_TEST_DATABASE_URL"))
	if databaseURL == "" {
		t.Skip("WHATSAPP_TEST_DATABASE_URL is not set")
	}
	target, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	if host := strings.ToLower(target.Hostname()); host != "localhost" && host != "127.0.0.1" && host != "::1" {
		t.Fatalf("WHATSAPP_TEST_DATABASE_URL must point to loopback, got %q", target.Hostname())
	}
	// Loopback alone can be an SSH tunnel to a live server. This destructive
	// fixture must also target a deliberately named, disposable database.
	if strings.TrimPrefix(target.Path, "/") != "vimob_whatsapp_test" {
		t.Fatal("WHATSAPP_TEST_DATABASE_URL must name the disposable vimob_whatsapp_test database")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: databaseURL, HealthTimeout: 3 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	defer postgres.Close()
	pool := postgres.Pool()
	var databaseName string
	if err := pool.QueryRow(ctx, `select current_database()`).Scan(&databaseName); err != nil {
		t.Fatal(err)
	}
	if databaseName != "vimob_whatsapp_test" {
		t.Fatalf("sharing fixture requires vimob_whatsapp_test, connected to %q", databaseName)
	}
	fixture := createSessionConversationLockFixture(t, ctx, pool, "sharing")
	defer cleanupSessionConversationLockFixture(t, pool, fixture)
	foreign := createSessionConversationLockFixture(t, ctx, pool, "sharing-foreign")
	defer cleanupSessionConversationLockFixture(t, pool, foreign)

	var recipientID string
	if err := pool.QueryRow(ctx, `select gen_random_uuid()::text`).Scan(&recipientID); err != nil {
		t.Fatal(err)
	}
	recipientEmail := fixture.suffix + "-recipient@example.invalid"
	if _, err := pool.Exec(ctx, `
		insert into auth.users (
			id, aud, role, email, encrypted_password, email_confirmed_at,
			raw_app_meta_data, raw_user_meta_data, created_at, updated_at
		) values ($1::uuid, 'authenticated', 'authenticated', $2, '', now(), '{}'::jsonb, '{}'::jsonb, now(), now());
		insert into public.users (id, organization_id, name, email, role, is_active)
		values ($1::uuid, $3::uuid, 'Sharing Recipient', $2, 'user', true)
		on conflict (id) do update
		set organization_id = excluded.organization_id,
		    name = excluded.name,
		    email = excluded.email,
		    role = excluded.role,
		    is_active = excluded.is_active;
		insert into public.organization_members (organization_id, user_id, role, is_active)
		values ($3::uuid, $1::uuid, 'user', true)
		on conflict (user_id, organization_id) do update
		set role = excluded.role,
		    is_active = excluded.is_active,
		    deleted_at = null
	`, recipientID, recipientEmail, fixture.organizationID); err != nil {
		t.Fatal(err)
	}
	defer func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cleanupCancel()
		// Deleting the test organization first cascades its lead activity and
		// attendance rows, which can still reference the recipient after transfer.
		_, err := pool.Exec(cleanupCtx, `
			update public.users set organization_id = null where organization_id = $1::uuid;
			delete from public.organizations where id = $1::uuid;
			delete from public.users where id = $2::uuid;
			delete from auth.users where id = $2::uuid
		`, fixture.organizationID, recipientID)
		if err != nil {
			t.Errorf("cleanup sharing recipient fixture: %v", err)
		}
	}()

	repo := NewRepository(postgres, nil, StorageConfig{})
	grant := grantAccessInput{UserID: recipientID, CanView: true, CanSend: true}
	if err := repo.GrantSessionAccess(ctx, fixture.tenant, fixture.sessionID, grant); err != nil {
		t.Fatalf("admin granting own number: %v", err)
	}
	accesses, err := repo.ListSessionAccess(ctx, fixture.tenant, fixture.sessionID)
	if err != nil || len(accesses) != 1 || pointerValue(accesses[0].GrantScope) != "organization" {
		t.Fatalf("admin grant scope = %+v, error = %v", accesses, err)
	}
	firstGrantID := accesses[0].ID
	firstGrantedAt := accesses[0].CreatedAt
	if err := repo.GrantSessionAccess(ctx, fixture.tenant, fixture.sessionID, grant); err != nil {
		t.Fatalf("repeating an unchanged grant: %v", err)
	}
	accesses, err = repo.ListSessionAccess(ctx, fixture.tenant, fixture.sessionID)
	if err != nil || len(accesses) != 1 || accesses[0].ID != firstGrantID || !accesses[0].CreatedAt.Equal(firstGrantedAt) {
		t.Fatalf("unchanged grant must preserve identity and creation time: %+v, error = %v", accesses, err)
	}
	viewOnlyGrant := grant
	viewOnlyGrant.CanSend = false
	if err := repo.GrantSessionAccess(ctx, fixture.tenant, fixture.sessionID, viewOnlyGrant); err != nil {
		t.Fatalf("reducing grant capability: %v", err)
	}
	accesses, err = repo.ListSessionAccess(ctx, fixture.tenant, fixture.sessionID)
	if err != nil || len(accesses) != 1 || accesses[0].ID == firstGrantID || accesses[0].CanSend {
		t.Fatalf("changed grant must rotate identity and remove send: %+v, error = %v", accesses, err)
	}
	viewOnlyGrantID := accesses[0].ID
	if err := repo.GrantSessionAccess(ctx, fixture.tenant, fixture.sessionID, grant); err != nil {
		t.Fatalf("restoring grant capability: %v", err)
	}
	accesses, err = repo.ListSessionAccess(ctx, fixture.tenant, fixture.sessionID)
	if err != nil || len(accesses) != 1 || accesses[0].ID == viewOnlyGrantID || !accesses[0].CanSend {
		t.Fatalf("restored grant must rotate identity and allow send: %+v, error = %v", accesses, err)
	}
	// A grant update that already holds the row must finish before the send
	// records its immutable grant ID. Otherwise the new intent is rejected by
	// the outbox as though access had been revoked.
	grantTx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = grantTx.Rollback(ctx) }()
	var concurrentGrantID string
	if err := grantTx.QueryRow(ctx, `
		update public.whatsapp_session_access
		set id = gen_random_uuid()
		where organization_id = $1::uuid and session_id = $2::uuid and user_id = $3::uuid
		returning id::text
	`, fixture.organizationID, fixture.sessionID, recipientID).Scan(&concurrentGrantID); err != nil {
		t.Fatal(err)
	}
	readTx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = readTx.Rollback(ctx) }()
	var readPID int
	if err := readTx.QueryRow(ctx, `select pg_backend_pid()`).Scan(&readPID); err != nil {
		t.Fatal(err)
	}
	type grantReadResult struct {
		id  string
		err error
	}
	readDone := make(chan grantReadResult, 1)
	go func() {
		id, readErr := outboundSessionAccessGrantID(ctx, readTx,
			fixture.organizationID, fixture.sessionID, recipientID)
		readDone <- grantReadResult{id: id, err: readErr}
	}()
	readWaiting := false
	for deadline := time.Now().Add(5 * time.Second); time.Now().Before(deadline); {
		select {
		case result := <-readDone:
			t.Fatalf("grant read returned before concurrent update committed: %+v", result)
		default:
		}
		if err := pool.QueryRow(ctx, `
			select wait_event_type = 'Lock'
			from pg_catalog.pg_stat_activity
			where pid = $1
		`, readPID).Scan(&readWaiting); err != nil {
			t.Fatal(err)
		}
		if readWaiting {
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if !readWaiting {
		t.Fatal("grant read did not wait on the concurrently updated grant row")
	}
	if err := grantTx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	select {
	case result := <-readDone:
		if result.err != nil || result.id != concurrentGrantID {
			t.Fatalf("grant read after update = %+v, want id %s", result, concurrentGrantID)
		}
	case <-ctx.Done():
		t.Fatal("grant read did not resume after concurrent update committed")
	}
	if err := readTx.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	accesses, err = repo.ListSessionAccess(ctx, fixture.tenant, fixture.sessionID)
	if err != nil || len(accesses) != 1 || accesses[0].ID != concurrentGrantID {
		t.Fatalf("grant identity after concurrent update = %+v, error = %v", accesses, err)
	}
	if err := repo.GrantSessionAccess(ctx, fixture.tenant, foreign.sessionID, grant); !errors.Is(err, ErrSessionNotFound) {
		t.Fatalf("cross-org session grant = %v, want ErrSessionNotFound", err)
	}
	foreignRecipient := grantAccessInput{UserID: foreign.userID, CanView: true, CanSend: true}
	if err := repo.GrantSessionAccess(ctx, fixture.tenant, fixture.sessionID, foreignRecipient); !errors.Is(err, ErrInvalidReference) {
		t.Fatalf("cross-org recipient grant = %v, want ErrInvalidReference", err)
	}

	recipient := tenant.Context{OrganizationID: fixture.organizationID, UserID: recipientID, MemberRole: "user", UserRole: "user", Permissions: []string{"lead_view_own", "whatsapp_view", "whatsapp_operate", "whatsapp_manage"}}
	if _, err := pool.Exec(ctx, `
		update public.whatsapp_sessions set status = 'disconnected'
		where organization_id = $1::uuid and id = $2::uuid
	`, fixture.organizationID, fixture.sessionID); err != nil {
		t.Fatal(err)
	}
	if disconnectedSessions, err := repo.ListSessions(ctx, recipient); err != nil || len(disconnectedSessions) != 1 || disconnectedSessions[0].CanSend == nil || *disconnectedSessions[0].CanSend {
		t.Fatalf("disconnected shared number must remain visible but not sendable: %+v, %v", disconnectedSessions, err)
	}
	for _, userID := range []string{fixture.userID, recipientID} {
		tx, err := pool.Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		_, accessErr := outboundSessionAccessGrantID(ctx, tx, fixture.organizationID, fixture.sessionID, userID)
		if err := tx.Rollback(ctx); err != nil {
			t.Fatal(err)
		}
		if !errors.Is(accessErr, ErrInvalidInput) || errors.Is(accessErr, ErrSessionAccessRevoked) {
			t.Fatalf("disconnected session for user %s = %v, want disconnected input error", userID, accessErr)
		}
	}
	if _, err := pool.Exec(ctx, `
		update public.whatsapp_sessions set status = 'connected'
		where organization_id = $1::uuid and id = $2::uuid
	`, fixture.organizationID, fixture.sessionID); err != nil {
		t.Fatal(err)
	}
	sessions, err := repo.ListSessions(ctx, recipient)
	if err != nil || len(sessions) != 1 || sessions[0].ID != fixture.sessionID {
		t.Fatalf("shared session list = %+v, error = %v", sessions, err)
	}
	if sessions[0].CanSend == nil || !*sessions[0].CanSend {
		t.Fatal("shared session did not report effective send permission")
	}
	if sessions[0].InstanceID != nil || sessions[0].AdvancedSettings != nil || sessions[0].Owner != nil {
		t.Fatal("shared session exposed owner-only provider settings or email")
	}
	if _, err := repo.GetSession(ctx, recipient, fixture.sessionID); !errors.Is(err, ErrSessionNotFound) {
		t.Fatalf("shared recipient may manage owner session: %v", err)
	}
	if _, err := repo.UpdateGroup(ctx, recipient, fixture.sessionID, UpdateGroupRequest{
		Field: "name", JID: "12345@g.us", Value: "unauthorized change",
	}); !errors.Is(err, ErrSessionNotFound) {
		t.Fatalf("shared recipient may update owner's group: %v", err)
	}
	attendance := attendanceInput{SendSessionID: fixture.sessionID, ExpectedLeadID: fixture.leadID}
	if _, err := repo.GetConversationSnapshot(ctx, recipient, fixture.conversationID); !errors.Is(err, ErrConversationNotFound) {
		t.Fatalf("shared recipient saw another user's lead conversation: %v", err)
	}
	if _, err := repo.JoinConversationAttendance(ctx, recipient, fixture.conversationID, attendance); !errors.Is(err, ErrConversationNotFound) {
		t.Fatalf("unassigned lead attendance = %v, want ErrConversationNotFound", err)
	}
	if _, err := pool.Exec(ctx, `update public.leads set assigned_user_id = $2::uuid where id = $1::uuid`, fixture.leadID, recipientID); err != nil {
		t.Fatal(err)
	}
	if conversation, err := repo.GetConversationSnapshot(ctx, recipient, fixture.conversationID); err != nil || conversation.ID != fixture.conversationID {
		t.Fatalf("shared recipient could not see assigned lead conversation: %+v, %v", conversation, err)
	}
	if _, err := repo.JoinConversationAttendance(ctx, recipient, fixture.conversationID, attendance); err != nil {
		t.Fatalf("shared recipient joining assigned lead: %v", err)
	}
	var sharedEntryID, sharedBindingID string
	var sharedJoinedAt time.Time
	var sharedIngressCutoff int64
	if err := pool.QueryRow(ctx, `
		select entry.id::text, entry.binding_id::text, entry.joined_at, entry.ingress_sequence_cutoff
		from public.whatsapp_attendance_entries entry
		where entry.organization_id = $1::uuid
		  and entry.conversation_id = $2::uuid
		  and entry.session_id = $3::uuid
		  and entry.lead_id = $4::uuid
		  and entry.user_id = $5::uuid
	`, fixture.organizationID, fixture.conversationID, fixture.sessionID,
		fixture.leadID, recipientID).Scan(&sharedEntryID, &sharedBindingID,
		&sharedJoinedAt, &sharedIngressCutoff); err != nil {
		t.Fatalf("shared attendance entry: %v", err)
	}
	sharedCaptureTx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	sharedEventID, err := eventAttendanceEntry(ctx, sharedCaptureTx,
		fixture.organizationID, fixture.conversationID, fixture.sessionID,
		fixture.leadID, sharedBindingID, fixture.suffix+"-inbound",
		sharedJoinedAt.Add(time.Second), sharedJoinedAt.Add(2*time.Second),
		sharedIngressCutoff+1)
	if err != nil || sharedEventID != sharedEntryID {
		_ = sharedCaptureTx.Rollback(ctx)
		t.Fatalf("new inbound after shared recipient joins = %q, error = %v, want %q",
			sharedEventID, err, sharedEntryID)
	}
	oldEventID, err := eventAttendanceEntry(ctx, sharedCaptureTx,
		fixture.organizationID, fixture.conversationID, fixture.sessionID,
		fixture.leadID, sharedBindingID, fixture.suffix+"-old-inbound",
		sharedJoinedAt.Add(-time.Second), sharedJoinedAt.Add(2*time.Second),
		sharedIngressCutoff+1)
	if err != nil || oldEventID != "" {
		_ = sharedCaptureTx.Rollback(ctx)
		t.Fatalf("inbound before shared recipient joins = %q, error = %v, want no capture",
			oldEventID, err)
	}
	anyEntryID, err := anyCurrentAttendanceEntry(ctx, sharedCaptureTx,
		fixture.organizationID, fixture.conversationID, fixture.sessionID,
		fixture.leadID, sharedBindingID)
	if err != nil || anyEntryID != sharedEntryID {
		_ = sharedCaptureTx.Rollback(ctx)
		t.Fatalf("shared attendance for allowed automation = %q, error = %v, want %q",
			anyEntryID, err, sharedEntryID)
	}
	// Reassignment immediately makes the grantee's prior attendance unusable;
	// rollback keeps the recipient assigned for the send checks below.
	if _, err := sharedCaptureTx.Exec(ctx, `
		update public.leads set assigned_user_id = $2::uuid
		where organization_id = $1::uuid and id = $3::uuid
	`, fixture.organizationID, fixture.userID, fixture.leadID); err != nil {
		_ = sharedCaptureTx.Rollback(ctx)
		t.Fatal(err)
	}
	sharedEventID, err = eventAttendanceEntry(ctx, sharedCaptureTx,
		fixture.organizationID, fixture.conversationID, fixture.sessionID,
		fixture.leadID, sharedBindingID, fixture.suffix+"-reassigned-inbound",
		sharedJoinedAt.Add(time.Second), sharedJoinedAt.Add(2*time.Second),
		sharedIngressCutoff+1)
	if err != nil || sharedEventID != "" {
		_ = sharedCaptureTx.Rollback(ctx)
		t.Fatalf("reassigned lead still captured via grantee attendance = %q, error = %v", sharedEventID, err)
	}
	anyEntryID, err = anyCurrentAttendanceEntry(ctx, sharedCaptureTx,
		fixture.organizationID, fixture.conversationID, fixture.sessionID,
		fixture.leadID, sharedBindingID)
	if err != nil || anyEntryID != "" {
		_ = sharedCaptureTx.Rollback(ctx)
		t.Fatalf("reassigned lead still authorizes automation = %q, error = %v", anyEntryID, err)
	}
	if err := sharedCaptureTx.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	response, err := repo.SendMessage(ctx, recipient, fixture.conversationID, sendMessageInput{
		Text: "shared number", SendSessionID: fixture.sessionID,
		ClientMessageID: fmt.Sprintf("%s-shared", fixture.suffix), ExpectedLeadID: fixture.leadID,
	})
	if err != nil || response.Message == nil {
		t.Fatalf("shared recipient SendMessage = %+v, error = %v", response, err)
	}
	var intentGrantID string
	if err := pool.QueryRow(ctx, `
		select coalesce(metadata->>'session_access_grant_id', '')
		from public.whatsapp_messages where id = $1::uuid
	`, response.Message.ID).Scan(&intentGrantID); err != nil || intentGrantID != accesses[0].ID {
		t.Fatalf("outbound grant identity = %q, want %q, error = %v", intentGrantID, accesses[0].ID, err)
	}
	// A recipient may react in the same assigned conversation. The reaction
	// must carry the exact grant identity through both message and outbox, so
	// revocation can stop it before the provider call.
	if _, err := pool.Exec(ctx, `
		update public.whatsapp_sessions set phone_number = '5511999998888'
		where organization_id = $1::uuid and id = $2::uuid
	`, fixture.organizationID, fixture.sessionID); err != nil {
		t.Fatal(err)
	}
	var reactionTargetID string
	if err := pool.QueryRow(ctx, `
		insert into public.whatsapp_messages (
			organization_id, conversation_id, session_id, lead_id,
			message_id, provider_message_id, from_me, direction, content,
			message_type, remote_jid, status, capture_state, sent_at
		) values (
			$1::uuid, $2::uuid, $3::uuid, $4::uuid,
			$5, $5, false, 'inbound', 'reaction target',
			'text', $6, 'received', 'captured', now()
		) returning id::text
	`, fixture.organizationID, fixture.conversationID, fixture.sessionID,
		fixture.leadID, fixture.suffix+"-reaction-target", fixture.remoteJID).Scan(&reactionTargetID); err != nil {
		t.Fatal(err)
	}
	reactionResponse, err := repo.ReactToMessage(ctx, recipient, fixture.conversationID,
		reactionTargetID, reactToMessageInput{
			Emoji: "👍", ClientReactionID: fixture.suffix + "-shared-reaction",
			ExpectedLeadID: fixture.leadID,
		})
	if err != nil || reactionResponse.Reaction == nil {
		t.Fatalf("shared recipient ReactToMessage = %+v, error = %v", reactionResponse, err)
	}
	var reactionMessageGrantID, reactionOutboxGrantID string
	if err := pool.QueryRow(ctx, `
		select coalesce(message.metadata->>'session_access_grant_id', ''),
		       coalesce(outbox.payload->>'session_access_grant_id', '')
		from public.whatsapp_messages message
		join public.whatsapp_outbox outbox on outbox.message_id = message.id
		where message.id = $1::uuid
	`, reactionResponse.Reaction.ID).Scan(&reactionMessageGrantID, &reactionOutboxGrantID); err != nil ||
		reactionMessageGrantID != intentGrantID || reactionOutboxGrantID != intentGrantID {
		t.Fatalf("shared reaction grant identity = %q/%q, want %q, error = %v",
			reactionMessageGrantID, reactionOutboxGrantID, intentGrantID, err)
	}
	sharedReactionOutbox := pendingWhatsAppOutbox{
		OrganizationID: fixture.organizationID, SessionID: fixture.sessionID,
		ConversationID: fixture.conversationID, MessageRowID: reactionResponse.Reaction.ID,
		Payload: map[string]any{"session_access_grant_id": reactionOutboxGrantID},
	}
	if allowed, err := repo.whatsappOutboxAttendanceCurrent(ctx, sharedReactionOutbox); err != nil || !allowed {
		t.Fatalf("shared reaction preflight = %v, error = %v", allowed, err)
	}
	// A manager can inspect another lead's immutable history, but sharing this
	// number must not turn that lead into a second operational inbox row.
	var otherLeadID, otherConversationID, otherMessageID string
	otherPhone := fmt.Sprintf("55118%08d", time.Now().UnixNano()%100_000_000)
	if err := pool.QueryRow(ctx, `
		insert into public.leads (organization_id, assigned_user_id, name, phone, source)
		values ($1::uuid, $2::uuid, $3, $4, 'whatsapp') returning id::text
	`, fixture.organizationID, fixture.userID, fixture.suffix+"-other-lead", otherPhone).Scan(&otherLeadID); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `
		insert into public.whatsapp_conversations (
			organization_id, session_id, remote_jid, contact_phone,
			contact_name, assigned_user_id
		) values ($1::uuid, $2::uuid, $3, $4, $5, $6::uuid)
		returning id::text
	`, fixture.organizationID, fixture.sessionID, otherPhone+"@s.whatsapp.net",
		otherPhone, fixture.suffix+"-other-conversation", fixture.userID).Scan(&otherConversationID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `
		select public.activate_whatsapp_conversation_lead_binding($1::uuid, $2::uuid, $3::uuid, null)
	`, fixture.organizationID, otherConversationID, otherLeadID); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `
		insert into public.whatsapp_messages (
			organization_id, conversation_id, session_id, lead_id,
			message_id, from_me, direction, content, message_type,
			remote_jid, status, capture_state, sent_at
		) values (
			$1::uuid, $2::uuid, $3::uuid, $4::uuid,
			$5, false, 'inbound', 'history retained', 'text',
			$6, 'received', 'captured', now()
		) returning id::text
	`, fixture.organizationID, otherConversationID, fixture.sessionID,
		otherLeadID, fixture.suffix+"-other-message", otherPhone+"@s.whatsapp.net").Scan(&otherMessageID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `
		update public.whatsapp_conversations set unread_count = 7
		where id = $1::uuid and organization_id = $2::uuid
	`, otherConversationID, fixture.organizationID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `
		update public.organization_members set role = 'manager'
		where organization_id = $1::uuid and user_id = $2::uuid
	`, fixture.organizationID, recipientID); err != nil {
		t.Fatal(err)
	}
	managerRecipient := recipient
	managerRecipient.MemberRole = "manager"
	managerRecipient.Permissions = append(append([]string{}, recipient.Permissions...), "lead_view_all")
	if snapshot, err := repo.GetConversationSnapshot(ctx, managerRecipient, otherConversationID); err != nil || snapshot.ID != otherConversationID {
		t.Fatalf("manager lost other lead history read: %+v, %v", snapshot, err)
	}
	if history, err := repo.GetHistoryAccess(ctx, managerRecipient, HistoryAccessFilter{LeadID: otherLeadID}); err != nil || len(history.Messages) == 0 {
		t.Fatalf("manager lost other lead message history: %+v, %v", history, err)
	}
	if inbox, err := repo.ListConversations(ctx, managerRecipient, ConversationListFilter{Limit: 50}); err != nil || len(inbox) != 1 || inbox[0].ID != fixture.conversationID {
		t.Fatalf("shared manager inbox exposed unassigned lead: %+v, %v", inbox, err)
	}
	if unread, err := repo.CountUnreadMessages(ctx, managerRecipient, ConversationListFilter{}); err != nil || unread != 0 {
		t.Fatalf("shared manager unread count included unassigned lead: %d, %v", unread, err)
	}
	if _, err := pool.Exec(ctx, `
		update public.organization_members set role = 'user'
		where organization_id = $1::uuid and user_id = $2::uuid
	`, fixture.organizationID, recipientID); err != nil {
		t.Fatal(err)
	}
	outboxItem := pendingWhatsAppOutbox{
		OrganizationID: fixture.organizationID, SessionID: fixture.sessionID,
		ConversationID: fixture.conversationID, MessageRowID: response.Message.ID,
		LeaseToken: fixture.suffix + "-disconnect-lease",
		Payload:    map[string]any{"session_access_grant_id": intentGrantID},
	}
	if err := pool.QueryRow(ctx, `
		update public.whatsapp_outbox
		set status = 'processing', locked_by = $2, locked_at = now()
		where message_id = $1::uuid
		returning id::text
	`, outboxItem.MessageRowID, outboxItem.LeaseToken).Scan(&outboxItem.ID); err != nil {
		t.Fatal(err)
	}
	disconnectTx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = disconnectTx.Rollback(ctx) }()
	if _, err := disconnectTx.Exec(ctx, `
		update public.whatsapp_sessions set status = 'disconnected'
		where organization_id = $1::uuid and id = $2::uuid
	`, fixture.organizationID, fixture.sessionID); err != nil {
		t.Fatal(err)
	}
	type providerStartResult struct {
		attempts int
		err      error
	}
	disconnectStartDone := make(chan providerStartResult, 1)
	go func() {
		attempts, startErr := repo.startWhatsAppOutboxProviderAttempt(ctx, outboxItem)
		disconnectStartDone <- providerStartResult{attempts: attempts, err: startErr}
	}()
	disconnectDeadline := time.Now().Add(5 * time.Second)
	for {
		var waiting bool
		if err := pool.QueryRow(ctx, `
			select exists (
			  select 1 from pg_catalog.pg_stat_activity activity
			  where activity.pid <> pg_backend_pid()
			    and activity.wait_event_type = 'Lock'
			    and activity.query like '%for share of session%'
			)
		`).Scan(&waiting); err != nil {
			t.Fatal(err)
		}
		if waiting {
			break
		}
		select {
		case result := <-disconnectStartDone:
			t.Fatalf("provider start escaped pending disconnect: %+v", result)
		default:
		}
		if time.Now().After(disconnectDeadline) {
			t.Fatal("provider start did not wait for session disconnect")
		}
		time.Sleep(20 * time.Millisecond)
	}
	if err := disconnectTx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	select {
	case result := <-disconnectStartDone:
		if !errors.Is(result.err, errWhatsAppOutboxSessionDisconnected) || result.attempts != 0 {
			t.Fatalf("provider start after disconnect = %+v, want defer without attempt", result)
		}
		if err := repo.deferWhatsAppOutboxWithoutAttempt(ctx, outboxItem, result.err); err != nil {
			t.Fatal(err)
		}
	case <-ctx.Done():
		t.Fatal("provider start stayed blocked after disconnect")
	}
	var deferredStatus string
	var deferredAttempts int
	if err := pool.QueryRow(ctx, `
		select status, attempts from public.whatsapp_outbox where id = $1::uuid
	`, outboxItem.ID).Scan(&deferredStatus, &deferredAttempts); err != nil || deferredStatus != "retry" || deferredAttempts != 0 {
		t.Fatalf("disconnected send = %s/%d, error %v, want retry/0", deferredStatus, deferredAttempts, err)
	}
	if _, err := pool.Exec(ctx, `
		update public.whatsapp_sessions set status = 'connected'
		where organization_id = $1::uuid and id = $2::uuid
	`, fixture.organizationID, fixture.sessionID); err != nil {
		t.Fatal(err)
	}
	allowed, err := repo.whatsappOutboxAttendanceCurrent(ctx, outboxItem)
	if err != nil || !allowed {
		t.Fatalf("outbox preflight before revoke = %v, error = %v", allowed, err)
	}
	startTx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := lockWhatsAppOutboxGrantForStart(ctx, startTx, outboxItem); err != nil {
		_ = startTx.Rollback(ctx)
		t.Fatalf("lock shared send grant for provider start: %v", err)
	}
	revokeDone := make(chan error, 1)
	revokeStarted := make(chan struct{})
	go func() {
		close(revokeStarted)
		revokeDone <- repo.RevokeSessionAccess(ctx, fixture.tenant, fixture.sessionID, recipientID)
	}()
	<-revokeStarted
	select {
	case err := <-revokeDone:
		_ = startTx.Rollback(ctx)
		t.Fatalf("revoke returned before the provider-start transaction committed: %v", err)
	case <-time.After(200 * time.Millisecond):
	}
	if err := startTx.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	select {
	case err := <-revokeDone:
		if err != nil {
			t.Fatal(err)
		}
	case <-ctx.Done():
		t.Fatal("revoke did not finish after the provider-start transaction committed")
	}
	checkTx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := lockWhatsAppOutboxGrantForStart(ctx, checkTx, outboxItem); !errors.Is(err, ErrSessionAccessRevoked) {
		t.Fatalf("old intent after revoke = %v, want ErrSessionAccessRevoked", err)
	}
	_ = checkTx.Rollback(ctx)
	allowed, err = repo.whatsappOutboxAttendanceCurrent(ctx, outboxItem)
	if err != nil || allowed {
		t.Fatalf("outbox preflight after revoke = %v, error = %v", allowed, err)
	}
	if allowed, err := repo.whatsappOutboxAttendanceCurrent(ctx, sharedReactionOutbox); err != nil || allowed {
		t.Fatalf("reaction preflight after revoke = %v, error = %v", allowed, err)
	}
	revokedCaptureTx, err := pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	sharedEventID, err = eventAttendanceEntry(ctx, revokedCaptureTx,
		fixture.organizationID, fixture.conversationID, fixture.sessionID,
		fixture.leadID, sharedBindingID, fixture.suffix+"-post-revoke-inbound",
		sharedJoinedAt.Add(time.Second), sharedJoinedAt.Add(2*time.Second),
		sharedIngressCutoff+1)
	if err != nil || sharedEventID != "" {
		_ = revokedCaptureTx.Rollback(ctx)
		t.Fatalf("revoked shared attendance captured new inbound = %q, error = %v", sharedEventID, err)
	}
	anyEntryID, err = anyCurrentAttendanceEntry(ctx, revokedCaptureTx,
		fixture.organizationID, fixture.conversationID, fixture.sessionID,
		fixture.leadID, sharedBindingID)
	if err != nil || anyEntryID != "" {
		_ = revokedCaptureTx.Rollback(ctx)
		t.Fatalf("revoked shared attendance still authorizes automation = %q, error = %v", anyEntryID, err)
	}
	if err := revokedCaptureTx.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.SendMessage(ctx, recipient, fixture.conversationID, sendMessageInput{
		Text: "after revoke", SendSessionID: fixture.sessionID,
		ClientMessageID: fmt.Sprintf("%s-revoked", fixture.suffix), ExpectedLeadID: fixture.leadID,
	}); !errors.Is(err, ErrSessionAccessRevoked) {
		t.Fatalf("send after revoke = %v, want ErrSessionAccessRevoked", err)
	}
	if _, err := repo.GetConversationAttendance(ctx, recipient, fixture.conversationID, attendance); err != nil {
		t.Fatalf("read-only attendance after revoke lost assigned lead history: %v", err)
	}
	if _, err := repo.JoinConversationAttendance(ctx, recipient, fixture.conversationID, attendance); !errors.Is(err, ErrSessionAccessRevoked) {
		t.Fatalf("new attendance after revoke = %v, want ErrSessionAccessRevoked", err)
	}
	if sessions, err := repo.ListSessions(ctx, recipient); err != nil || len(sessions) != 0 {
		t.Fatalf("revoked number remained sendable: %+v, error = %v", sessions, err)
	}
	if conversation, err := repo.GetConversationSnapshot(ctx, recipient, fixture.conversationID); err != nil || conversation.ID != fixture.conversationID {
		t.Fatalf("assigned lead conversation after revoke = %+v, error = %v", conversation, err)
	}
	if conversations, err := repo.ListConversations(ctx, recipient, ConversationListFilter{Limit: 50}); err != nil || len(conversations) != 0 {
		t.Fatalf("revoked number remained in operational inbox = %+v, error = %v", conversations, err)
	}
	if page, err := repo.ListMessages(ctx, recipient, fixture.conversationID, MessageFilter{Limit: 50}); err != nil || len(page.Messages) == 0 {
		t.Fatalf("assigned lead messages after revoke = %+v, error = %v", page, err)
	}
	if history, err := repo.GetHistoryAccess(ctx, recipient, HistoryAccessFilter{LeadID: fixture.leadID}); err != nil || len(history.Messages) == 0 {
		t.Fatalf("assigned lead history after revoke = %+v, error = %v", history, err)
	}
	var historicalMessages int
	if err := pool.QueryRow(ctx, `select count(*) from public.whatsapp_messages where id = $1::uuid`, response.Message.ID).Scan(&historicalMessages); err != nil || historicalMessages != 1 {
		t.Fatalf("captured history after revoke = %d, error = %v", historicalMessages, err)
	}
	if err := repo.GrantSessionAccess(ctx, fixture.tenant, fixture.sessionID, grant); err != nil {
		t.Fatalf("new grant after revoke: %v", err)
	}
	accesses, err = repo.ListSessionAccess(ctx, fixture.tenant, fixture.sessionID)
	if err != nil || len(accesses) != 1 || accesses[0].ID == intentGrantID {
		t.Fatalf("regrant must have a new identity: %+v, error = %v", accesses, err)
	}
	checkTx, err = pool.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if err := lockWhatsAppOutboxGrantForStart(ctx, checkTx, outboxItem); !errors.Is(err, ErrSessionAccessRevoked) {
		t.Fatalf("old intent after regrant = %v, want ErrSessionAccessRevoked", err)
	}
	_ = checkTx.Rollback(ctx)

	if _, err := pool.Exec(ctx, `update public.organization_members set role = 'user' where organization_id = $1::uuid and user_id = $2::uuid`, fixture.organizationID, fixture.userID); err != nil {
		t.Fatal(err)
	}
	if err := repo.GrantSessionAccess(ctx, fixture.tenant, fixture.sessionID, grant); !errors.Is(err, tenant.ErrOrganizationAccessDenied) {
		t.Fatalf("ordinary owner grant = %v, want denied", err)
	}
	var teamID string
	if err := pool.QueryRow(ctx, `insert into public.teams (organization_id, name, is_active) values ($1::uuid, $2, true) returning id::text`, fixture.organizationID, fixture.suffix+"-team").Scan(&teamID); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `
		insert into public.team_members (team_id, organization_id, user_id, is_leader, is_active)
		values ($1::uuid, $2::uuid, $3::uuid, true, true), ($1::uuid, $2::uuid, $4::uuid, false, true)
	`, teamID, fixture.organizationID, fixture.userID, recipientID); err != nil {
		t.Fatal(err)
	}
	if err := repo.GrantSessionAccess(ctx, fixture.tenant, fixture.sessionID, grant); err != nil {
		t.Fatalf("leader granting team member: %v", err)
	}
	accesses, err = repo.ListSessionAccess(ctx, fixture.tenant, fixture.sessionID)
	if err != nil || len(accesses) != 1 || pointerValue(accesses[0].GrantScope) != "team" || pointerValue(accesses[0].GrantTeamID) != teamID {
		t.Fatalf("team grant scope = %+v, error = %v", accesses, err)
	}
	for _, testCase := range []struct {
		name   string
		key    string
		update string
		userID string
	}{
		{
			name: "recipient exits team",
			key:  "recipient-exit",
			update: `update public.team_members set is_active = false
				where team_id = $1::uuid and organization_id = $2::uuid and user_id = $3::uuid`,
			userID: recipientID,
		},
		{
			name: "owner loses leader role",
			key:  "owner-leader-loss",
			update: `update public.team_members set is_leader = false
				where team_id = $1::uuid and organization_id = $2::uuid and user_id = $3::uuid`,
			userID: fixture.userID,
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			// The first membership change can invalidate the old grant. Give
			// each race an independently authorized intent to test the lock,
			// rather than an already-revoked historical message.
			if err := repo.GrantSessionAccess(ctx, fixture.tenant, fixture.sessionID, grant); err != nil {
				t.Fatalf("leader granting fresh access: %v", err)
			}
			if _, err := repo.JoinConversationAttendance(ctx, recipient, fixture.conversationID, attendance); err != nil {
				t.Fatalf("fresh team attendance: %v", err)
			}
			teamSend, err := repo.SendMessage(ctx, recipient, fixture.conversationID, sendMessageInput{
				Text: "team membership fence", SendSessionID: fixture.sessionID,
				ClientMessageID: fixture.suffix + "-team-fence-" + testCase.key,
				ExpectedLeadID:  fixture.leadID,
			})
			if err != nil || teamSend.Message == nil {
				t.Fatalf("team sender could not enqueue: %+v, %v", teamSend, err)
			}
			teamItem := pendingWhatsAppOutbox{
				OrganizationID: fixture.organizationID, SessionID: fixture.sessionID,
				ConversationID: fixture.conversationID, MessageRowID: teamSend.Message.ID,
				LeaseToken: fixture.suffix + "-team-lease-" + testCase.key,
			}
			if err := pool.QueryRow(ctx, `
				update public.whatsapp_outbox
				set status = 'processing', locked_by = $2, locked_at = now()
				where message_id = $1::uuid
				returning id::text
			`, teamItem.MessageRowID, teamItem.LeaseToken).Scan(&teamItem.ID); err != nil {
				t.Fatal(err)
			}
			changeTx, err := pool.Begin(ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer func() { _ = changeTx.Rollback(ctx) }()
			if _, err := changeTx.Exec(ctx, testCase.update, teamID, fixture.organizationID, testCase.userID); err != nil {
				t.Fatal(err)
			}
			type startResult struct {
				attempts int
				err      error
			}
			startDone := make(chan startResult, 1)
			go func() {
				attempts, startErr := repo.startWhatsAppOutboxProviderAttempt(ctx, teamItem)
				startDone <- startResult{attempts: attempts, err: startErr}
			}()
			deadline := time.Now().Add(5 * time.Second)
			for {
				var waiting bool
				if err := pool.QueryRow(ctx, `
					select exists (
					  select 1 from pg_catalog.pg_stat_activity activity
					  where activity.pid <> pg_backend_pid()
					    and activity.wait_event_type = 'Lock'
					    and activity.query like '%from public.team_members%'
					)
				`).Scan(&waiting); err != nil {
					t.Fatal(err)
				}
				if waiting {
					break
				}
				select {
				case result := <-startDone:
					t.Fatalf("provider start escaped pending %s change: attempts=%d error=%v", testCase.name, result.attempts, result.err)
				default:
				}
				if time.Now().After(deadline) {
					t.Fatal("provider start did not wait for membership change")
				}
				time.Sleep(20 * time.Millisecond)
			}
			if err := changeTx.Commit(ctx); err != nil {
				t.Fatal(err)
			}
			select {
			case result := <-startDone:
				if !errors.Is(result.err, ErrSessionAccessRevoked) || result.attempts != 0 {
					t.Fatalf("provider start after %s: attempts=%d error=%v, want revoked without attempt", testCase.name, result.attempts, result.err)
				}
			case <-ctx.Done():
				t.Fatal("provider start stayed blocked after membership change")
			}
			var attempts int
			if err := pool.QueryRow(ctx, `select attempts from public.whatsapp_outbox where id = $1::uuid`, teamItem.ID).Scan(&attempts); err != nil || attempts != 0 {
				t.Fatalf("provider attempt after %s = %d, error %v", testCase.name, attempts, err)
			}
		})
		if testCase.userID == recipientID {
			if _, err := pool.Exec(ctx, `update public.team_members set is_active = true
				where team_id = $1::uuid and organization_id = $2::uuid and user_id = $3::uuid`,
				teamID, fixture.organizationID, recipientID); err != nil {
				t.Fatal(err)
			}
		}
	}
	if _, err := pool.Exec(ctx, `update public.team_members set is_active = false where team_id = $1::uuid and user_id = $2::uuid`, teamID, recipientID); err != nil {
		t.Fatal(err)
	}
	accesses, err = repo.ListSessionAccess(ctx, fixture.tenant, fixture.sessionID)
	if err != nil || len(accesses) != 0 {
		t.Fatalf("team exit did not remove grant = %+v, error = %v", accesses, err)
	}
}
