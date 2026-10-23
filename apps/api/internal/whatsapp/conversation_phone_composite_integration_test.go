package whatsapp

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func addPhoneDestination(t *testing.T, ctx context.Context, pool *pgxpool.Pool, f sessionConversationLockFixture, phone string) string {
	t.Helper()
	var id string
	if err := pool.QueryRow(ctx, `insert into public.whatsapp_conversations(organization_id,session_id,remote_jid,contact_phone,contact_name)
	 values($1::uuid,$2::uuid,$3,$4,'Synthetic destination owner-only history') returning id::text`, f.organizationID, f.sessionID, phone+"@s.whatsapp.net", phone).Scan(&id); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `insert into public.whatsapp_messages(organization_id,session_id,conversation_id,message_id,provider_message_id,content,from_me,direction,status,capture_state)
	 values($1::uuid,$2::uuid,$3::uuid,$4,$4,'Synthetic destination retained history',false,'inbound','received','unlinked_ephemeral')`, f.organizationID, f.sessionID, id, f.suffix+"-destination-history"); err != nil {
		t.Fatal(err)
	}
	return id
}

func phoneConfirmationRequest(f sessionConversationLockFixture, phone string) StartConversationRequest {
	return StartConversationRequest{Phone: phone, LeadID: f.leadID, SessionID: f.sessionID, ExpectedPreviousLeadID: f.leadID,
		ConfirmPhoneChange: true, ExpectedPreviousConversationID: f.conversationID}
}

func assertPhoneOldRouteUntouched(t *testing.T, ctx context.Context, pool *pgxpool.Pool, f sessionConversationLockFixture) {
	t.Helper()
	var intact bool
	if err := pool.QueryRow(ctx, `select retired_at is null and lead_id=$2::uuid and remote_jid=$3 from public.whatsapp_conversations where id=$1::uuid`, f.conversationID, f.leadID, f.remoteJID).Scan(&intact); err != nil || !intact {
		t.Fatalf("phone CAS failed to rollback old route: %t %v", intact, err)
	}
}

func TestLocalWhatsAppCompositePhoneHistoryConsent(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	db := openLocalOutboundDatabase(t, ctx)
	repo := NewRepository(db, nil, StorageConfig{})
	f := outboundHardeningFixture(t, ctx, db, repo, "phone-composite")
	phone := "5511333388888"
	destinationID := addPhoneDestination(t, ctx, db.Pool(), f, phone)
	if _, err := db.Pool().Exec(ctx, `update public.leads set phone=$2 where id=$1::uuid`, f.leadID, phone); err != nil {
		t.Fatal(err)
	}
	request := phoneConfirmationRequest(f, phone)
	request.ConfirmPhoneChange = false
	request.ExpectedPreviousConversationID = ""
	_, err := repo.StartConversation(ctx, f.tenant, request)
	var snapshot *phoneChangeConfirmationError
	if !errors.As(err, &snapshot) || snapshot.DestinationConversationID == nil || *snapshot.DestinationConversationID != destinationID || !snapshot.RequiresDestinationHistoryConfirmation {
		t.Fatalf("composite snapshot before history_required: %+v %v", snapshot, err)
	}
	request = phoneConfirmationRequest(f, phone)
	if _, err := repo.StartConversation(ctx, f.tenant, request); !errors.Is(err, ErrConversationBindingChanged) {
		t.Fatalf("missing explicit destination consent accepted: %v", err)
	}
	assertPhoneOldRouteUntouched(t, ctx, db.Pool(), f)
	request.ConfirmDestinationHistory = true
	request.ExpectedDestinationConversationID = "00000000-0000-4000-8000-000000000099"
	if _, err := repo.StartConversation(ctx, f.tenant, request); !errors.Is(err, ErrConversationBindingChanged) {
		t.Fatalf("wrong destination snapshot accepted: %v", err)
	}
	assertPhoneOldRouteUntouched(t, ctx, db.Pool(), f)
	request.ExpectedDestinationConversationID = destinationID
	opened, err := repo.StartConversation(ctx, f.tenant, request)
	if err != nil || opened.ID != destinationID || pointerValue(opened.LeadID) != f.leadID {
		t.Fatalf("composite confirmed physical destination: %+v %v", opened, err)
	}
	var consented, noAttendance bool
	if err := db.Pool().QueryRow(ctx, `select exists(select 1 from public.whatsapp_messages where conversation_id=$1::uuid and lead_id=$2::uuid and capture_state='promoted_unlinked' and content='Synthetic destination retained history'),not exists(select 1 from public.whatsapp_attendance_entries where conversation_id=$1::uuid)`, destinationID, f.leadID).Scan(&consented, &noAttendance); err != nil || !consented || !noAttendance {
		t.Fatalf("composite import/attendance contract: %t %t %v", consented, noAttendance, err)
	}
	replayed, err := repo.StartConversation(ctx, f.tenant, request)
	if err != nil || replayed.ID != destinationID {
		t.Fatalf("confirmed replay did not return same route: %+v %v", replayed, err)
	}
	request.ExpectedPreviousConversationID = "00000000-0000-4000-8000-000000000099"
	if _, err := repo.StartConversation(ctx, f.tenant, request); !errors.Is(err, ErrConversationBindingChanged) {
		t.Fatalf("forged retired snapshot replay accepted: %v", err)
	}
}

func TestLocalWhatsAppPhoneDestinationChangesRollback(t *testing.T) {
	for _, scenario := range []string{"expired", "rebound", "deleted", "staleOldLead"} {
		t.Run(scenario, func(t *testing.T) {
			ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
			defer cancel()
			db := openLocalOutboundDatabase(t, ctx)
			repo := NewRepository(db, nil, StorageConfig{})
			f := outboundHardeningFixture(t, ctx, db, repo, "phone-destination-"+scenario)
			phone := "5511666677777"
			destinationID := addPhoneDestination(t, ctx, db.Pool(), f, phone)
			if _, err := db.Pool().Exec(ctx, `update public.leads set phone=$2 where id=$1::uuid`, f.leadID, phone); err != nil {
				t.Fatal(err)
			}
			request := phoneConfirmationRequest(f, phone)
			request.ConfirmDestinationHistory = true
			request.ExpectedDestinationConversationID = destinationID
			switch scenario {
			case "expired":
				_, err := db.Pool().Exec(ctx, `update public.whatsapp_conversations set created_at=clock_timestamp()-interval '8 days' where id=$1::uuid`, destinationID)
				if err != nil {
					t.Fatal(err)
				}
			case "deleted":
				_, err := db.Pool().Exec(ctx, `update public.whatsapp_conversations set deleted_at=clock_timestamp() where id=$1::uuid`, destinationID)
				if err != nil {
					t.Fatal(err)
				}
			case "rebound":
				var otherLead string
				if err := db.Pool().QueryRow(ctx, `insert into public.leads(organization_id,assigned_user_id,name,phone,source)values($1::uuid,$2::uuid,'Synthetic other destination lead','5511555577777','whatsapp')returning id::text`, f.organizationID, f.userID).Scan(&otherLead); err != nil {
					t.Fatal(err)
				}
				if _, err := db.Pool().Exec(ctx, `select public.confirm_whatsapp_unlinked_history_binding($1::uuid,$2::uuid,$3::uuid,null,$4::uuid,'manual_link')`, f.organizationID, destinationID, otherLead, f.userID); err != nil {
					t.Fatal(err)
				}
			case "staleOldLead":
				request.ExpectedPreviousLeadID = "00000000-0000-4000-8000-000000000099"
			}
			_, err := repo.StartConversation(ctx, f.tenant, request)
			if !errors.Is(err, ErrConversationBindingChanged) && !errors.Is(err, ErrInvalidInput) {
				t.Fatalf("changed destination was accepted: %v", err)
			}
			assertPhoneOldRouteUntouched(t, ctx, db.Pool(), f)
		})
	}
}

func TestLocalWhatsAppSharedStartsAssignedLeadAndCorrectsPhone(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	db := openLocalOutboundDatabase(t, ctx)
	repo := NewRepository(db, nil, StorageConfig{})
	f := createLocalSharedOutboundFixture(t, ctx, db.Pool(), "shared-start")
	var leadID string
	phone := "5511444488888"
	if err := db.Pool().QueryRow(ctx, `insert into public.leads(organization_id,assigned_user_id,name,phone,source)values($1::uuid,$2::uuid,'Synthetic newly assigned shared lead',$3,'whatsapp')returning id::text`, f.organizationID, f.tenant.UserID, phone).Scan(&leadID); err != nil {
		t.Fatal(err)
	}
	opened, err := repo.StartConversation(ctx, f.tenant, StartConversationRequest{Phone: phone, LeadID: leadID, SessionID: f.sessionID, ExpectedPreviousLeadID: unlinkedConversationLeadSnapshot})
	if err != nil || pointerValue(opened.LeadID) != leadID || opened.SessionID != f.sessionID {
		t.Fatalf("valid assigned shared lead cannot start: %+v %v", opened, err)
	}
	if _, err := repo.JoinConversationAttendance(ctx, f.tenant, opened.ID, attendanceInput{ExpectedLeadID: leadID, SendSessionID: f.sessionID}); err != nil {
		t.Fatal(err)
	}
	queueHardeningMessage(t, ctx, repo, sessionConversationLockFixture{tenant: f.tenant, leadID: leadID, sessionID: f.sessionID, conversationID: opened.ID}, sendMessageInput{Text: "Synthetic assigned shared intent", ClientMessageID: f.suffix + "-new-assigned"})
	phone = "5511444499999"
	if _, err := db.Pool().Exec(ctx, `update public.leads set phone=$2 where id=$1::uuid`, f.leadID, phone); err != nil {
		t.Fatal(err)
	}
	request := phoneConfirmationRequest(f, phone)
	request.ConfirmPhoneChange = false
	request.ExpectedPreviousConversationID = ""
	if _, err := repo.StartConversation(ctx, f.tenant, request); !errors.Is(err, ErrPhoneChangeConfirmationRequired) {
		t.Fatalf("shared old active phone cannot confirm: %v", err)
	}
	request = phoneConfirmationRequest(f, phone)
	corrected, err := repo.StartConversation(ctx, f.tenant, request)
	if err != nil || corrected.ID == f.conversationID || pointerValue(corrected.LeadID) != f.leadID {
		t.Fatalf("shared own assigned phone correction: %+v %v", corrected, err)
	}
	// The next correction meets a private destination. The grant never grants
	// preview/import; no owner-only destination reference may be returned.
	privatePhone := "5511444477777"
	addPhoneDestination(t, ctx, db.Pool(), f, privatePhone)
	if _, err := db.Pool().Exec(ctx, `update public.leads set phone=$2 where id=$1::uuid`, f.leadID, privatePhone); err != nil {
		t.Fatal(err)
	}
	_, err = repo.StartConversation(ctx, f.tenant, StartConversationRequest{Phone: privatePhone, LeadID: f.leadID, SessionID: f.sessionID, ExpectedPreviousLeadID: f.leadID})
	var snapshot *phoneChangeConfirmationError
	if !errors.Is(err, ErrConversationHistoryLinkRequired) || errors.As(err, &snapshot) {
		t.Fatalf("shared grant exposed/imported private destination: %v", err)
	}
	if _, err := db.Pool().Exec(ctx, `update public.whatsapp_session_access set can_send=false where session_id=$1::uuid and user_id=$2::uuid`, f.sessionID, f.tenant.UserID); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.StartConversation(ctx, f.tenant, StartConversationRequest{Phone: privatePhone, LeadID: f.leadID, SessionID: f.sessionID, ExpectedPreviousLeadID: f.leadID}); !errors.Is(err, ErrSessionNotFound) {
		t.Fatalf("revoked shared start accepted: %v", err)
	}
}
