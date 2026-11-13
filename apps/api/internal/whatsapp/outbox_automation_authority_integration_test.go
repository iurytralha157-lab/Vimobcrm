package whatsapp

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestLocalAutomationOutboxStartsWithoutAttendance(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	db := openLocalOutboundDatabase(t, ctx)
	pool := db.Pool()
	f := createLocalSharedOutboundFixture(t, ctx, pool, "automation-authority")
	foreign := createLocalSharedOutboundFixture(t, ctx, pool, "automation-authority-foreign")
	var calls atomic.Int32
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		var request struct{ ID, Number string }
		if err := json.NewDecoder(r.Body).Decode(&request); err != nil || r.URL.Path != "/send/text" || request.Number != f.phone {
			t.Errorf("unexpected synthetic provider request: %s %#v, %v", r.URL.Path, request, err)
			http.Error(w, "unexpected synthetic provider request", http.StatusBadRequest)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]string{"messageId": request.ID})
	}))
	defer provider.Close()
	repo := NewRepository(db, nil, StorageConfig{EvolutionGo: EvolutionGoConfig{APIURL: provider.URL, APIKey: "synthetic"}})

	if _, err := pool.Exec(ctx, `
		update public.leads set assigned_user_id=null where organization_id=$1::uuid and id=$2::uuid;
		insert into public.organization_modules(organization_id,module_name,is_enabled) values($1::uuid,'automations',true)
	`, f.organizationID, f.leadID); err != nil {
		t.Fatal(err)
	}
	var noAttendance bool
	if err := pool.QueryRow(ctx, `select not exists (
		select 1 from public.whatsapp_attendance_entries where organization_id=$1::uuid and conversation_id=$2::uuid
	)`, f.organizationID, f.conversationID).Scan(&noAttendance); err != nil || !noAttendance {
		t.Fatalf("synthetic conversation already has attendance: %v", err)
	}

	item, _ := queueAutomationOutboxFixture(t, ctx, pool, f)
	if err := repo.processClaimedWhatsAppOutbox(ctx, item, whatsappOutboxLaneFast); err != nil {
		t.Fatal(err)
	}
	assertLocalOutboundState(t, ctx, pool, item, "sent", 1)
	if calls.Load() != 1 {
		t.Fatalf("provider received %d calls, want one", calls.Load())
	}

	item, executionID := queueAutomationOutboxFixture(t, ctx, pool, f)
	foreignItem := item
	foreignItem.OrganizationID = foreign.organizationID
	if _, err := repo.startWhatsAppOutboxProviderAttempt(ctx, foreignItem); !errors.Is(err, ErrSessionAccessRevoked) {
		t.Fatalf("foreign tenant start: got %v, want ErrSessionAccessRevoked", err)
	}
	if _, err := pool.Exec(ctx, `
		update public.automation_executions set status='cancelled',cancellation_requested_at=now()
		where organization_id=$1::uuid and id=$2::uuid
	`, f.organizationID, executionID); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.startWhatsAppOutboxProviderAttempt(ctx, item); !errors.Is(err, ErrSessionAccessRevoked) {
		t.Fatalf("cancelled execution start: got %v, want ErrSessionAccessRevoked", err)
	}

	item, _ = queueAutomationOutboxFixture(t, ctx, pool, f)
	if _, err := pool.Exec(ctx, `
		update public.organization_members set is_active=false
		where organization_id=$1::uuid and user_id=$2::uuid
	`, f.organizationID, f.userID); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.startWhatsAppOutboxProviderAttempt(ctx, item); !errors.Is(err, ErrSessionAccessRevoked) {
		t.Fatalf("inactive publisher start: got %v, want ErrSessionAccessRevoked", err)
	}
	if err := repo.processClaimedWhatsAppOutbox(ctx, item, whatsappOutboxLaneFast); err != nil {
		t.Fatal(err)
	}
	assertLocalOutboundState(t, ctx, pool, item, "failed", 0)
	if calls.Load() != 1 {
		t.Fatalf("provider received %d calls, want one", calls.Load())
	}
}

func queueAutomationOutboxFixture(t *testing.T, ctx context.Context, pool *pgxpool.Pool, f sessionConversationLockFixture) (pendingWhatsAppOutbox, string) {
	t.Helper()
	var executionID string
	if err := pool.QueryRow(ctx, `
		with automation as (
		  insert into public.automations(organization_id,name,is_active,trigger_type,trigger_config,flow_definition)
		  values($1::uuid,'Synthetic outbox authority',false,'manual','{}','{}') returning id
		), flow as (
		  insert into public.automation_flow_versions(automation_id,organization_id,version,trigger_type,trigger_config,
		    graph,graph_checksum,first_node_key,requires_review,created_by)
		  select id,$1::uuid,1,'manual','{}',jsonb_build_object('nodes',jsonb_build_array(jsonb_build_object(
		    'id','text','type','action','action_type','send_whatsapp','config',jsonb_build_object('session_id',$4::text))),
		    'connections','[]'::jsonb,'settings','{}'::jsonb),id::text,'text',false,$5::uuid
		  from automation returning id,automation_id
		)
		insert into public.automation_executions(automation_id,flow_version_id,organization_id,lead_id,conversation_id,
		  status,current_node_key,locked_by,locked_at,attempt_count)
		select automation_id,id,$1::uuid,$2::uuid,$3::uuid,'running','text','synthetic-execution-lease',now(),1
		from flow returning id::text
	`, f.organizationID, f.leadID, f.conversationID, f.sessionID, f.userID).Scan(&executionID); err != nil {
		t.Fatal(err)
	}
	effectKey := "automation:" + executionID + ":text:send_whatsapp"
	if _, err := pool.Exec(ctx, `
		insert into public.automation_effect_dispatches(organization_id,execution_id,node_key,effect_key,effect_type,status,request)
		values($1::uuid,$2::uuid,'text',$3,'send_whatsapp','sending',
		  jsonb_build_object('delivery_contract','canonical_whatsapp_outbox_v1','session_id',$4::text));
		select public.enqueue_automation_whatsapp_outbox($1::uuid,$2::uuid,'text','synthetic-execution-lease',$3,
		  $5::uuid,$4::uuid,$3,'text','Synthetic automation message',null,null,null,null);
	`, f.organizationID, executionID, effectKey, f.sessionID, f.conversationID); err != nil {
		t.Fatal(err)
	}
	return leaseLocalOutbound(t, ctx, pool, f.organizationID, effectKey), executionID
}
