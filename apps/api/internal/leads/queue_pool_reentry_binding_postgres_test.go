package leads

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestQueuePoolReentryBindingRechecksBeforeHistoryRPCWithPostgres(t *testing.T) {
	for _, mode := range []string{"manual", "keyed_import"} {
		t.Run(mode, func(t *testing.T) {
			f := newQueuePostLockFixture(t)
			request := queueReentryRequest(t, f, mode)
			f.actor.EnabledModules = []string{"whatsapp"}
			var session, conversation string
			if err := f.db.Pool().QueryRow(f.ctx, `insert into public.whatsapp_sessions
				(organization_id,instance_name,instance_id,owner_user_id,provider,status,is_active,advanced_settings)
				values($1::uuid,$2,$2,$3::uuid,'evolution_go','connected',true,'{}'::jsonb) returning id::text`,
				f.org, "reentry-binding-"+f.lead, f.actor.UserID).Scan(&session); err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() {
				ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
				defer cancel()
				// Confirmed history deliberately uses ON DELETE RESTRICT. Remove
				// only this synthetic organization's private proofs before its epoch.
				for _, statement := range []string{
					`delete from private.whatsapp_unlinked_promotion_authorizations where organization_id=$1::uuid`,
					`delete from private.whatsapp_unlinked_history_links where organization_id=$1::uuid`,
					`delete from public.whatsapp_messages where organization_id=$1::uuid`,
					`delete from public.whatsapp_conversations where organization_id=$1::uuid`,
					`delete from public.whatsapp_sessions where organization_id=$1::uuid`,
				} {
					if _, err := f.db.Pool().Exec(ctx, statement, f.org); err != nil {
						t.Errorf("cleanup synthetic binding fixture: %v", err)
					}
				}
			})
			if err := f.db.Pool().QueryRow(f.ctx, `insert into public.whatsapp_conversations
				(organization_id,session_id,remote_jid,contact_phone,contact_name,unlinked_retention_v1)
				values($1::uuid,$2::uuid,$3,$4,'Synthetic unlinked reentry',true) returning id::text`,
				f.org, session, request.Phone+"@s.whatsapp.net", request.Phone).Scan(&conversation); err != nil {
				t.Fatal(err)
			}
			if _, err := f.db.Pool().Exec(f.ctx, `insert into public.whatsapp_messages
				(organization_id,session_id,conversation_id,message_id,provider_message_id,content,from_me,direction,capture_state,metadata)
				values($1::uuid,$2::uuid,$3::uuid,$4,$4,'Synthetic unlinked private history',false,'inbound','unlinked_ephemeral','{}')`,
				f.org, session, conversation, "reentry-message-"+f.lead); err != nil {
				t.Fatal(err)
			}
			request.ConversationID, request.ExpectedPreviousLeadID, request.ConfirmHistoryLink = conversation, "unlinked", true
			if _, err := request.Validate(); err != nil {
				t.Fatalf("binding request must satisfy the real creation input: %v", err)
			}
			warmQueueReentryBindingConnections(t, f)
			holder, err := f.db.Pool().Begin(f.ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer holder.Rollback(f.ctx)
			var holderPID int32
			if err := holder.QueryRow(f.ctx, `select pg_backend_pid()`).Scan(&holderPID); err != nil {
				t.Fatal(err)
			}
			for _, operation := range []struct{ sql, id string }{
				{`select id from public.round_robins where organization_id=$1::uuid and id=$2::uuid for share`, f.queue},
				{`select id from public.leads where organization_id=$1::uuid and id=$2::uuid for no key update`, f.lead},
				{`select private.queue_runtime_pool($1::uuid,$2::uuid,'queue_closed',clock_timestamp(),'{"open":false}'::jsonb)`, f.lead},
			} {
				if _, err := holder.Exec(f.ctx, operation.sql, f.org, operation.id); err != nil {
					t.Fatal(err)
				}
			}
			before := queueReentryFingerprint(t, f, holder)
			response := httptest.NewRecorder()
			httpRequest := queueReentryHTTP(t, f, f.actor, request)
			done := make(chan struct{})
			go func() { NewHandler(f.repo).Create(response, httpRequest); close(done) }()
			waiting := false
			var observation string
			for deadline := time.Now().Add(10 * time.Second); time.Now().Before(deadline); {
				if err := f.db.Pool().QueryRow(f.ctx, `select coalesce(bool_or(wait_event_type='Lock'
					and $1::int=any(pg_blocking_pids(pid)) and query like '%for share of l%'),false),
					coalesce(jsonb_agg(jsonb_build_object('pid',pid,'state',state,'wait_type',wait_event_type,
					'wait_event',wait_event,'blocking_pids',pg_blocking_pids(pid),'query',left(query,1500)) order by pid),'[]'::jsonb)::text
					from pg_stat_activity where datname=current_database() and backend_type='client backend'
					and pid<>pg_backend_pid() and pid<>$1::int and (state<>'idle' or wait_event_type='Lock')`, holderPID).Scan(&waiting, &observation); err != nil {
					t.Fatal(err)
				}
				if waiting {
					break
				}
				time.Sleep(20 * time.Millisecond)
			}
			t.Logf("binding lock observation before close release: holder_pid=%d target_wait=%t sessions=%s", holderPID, waiting, observation)
			if !waiting {
				_ = holder.Rollback(f.ctx)
				<-done
				t.Fatalf("explicit binding did not reach the real target FOR SHARE wait: status=%d body=%s", response.Code, response.Body.String())
			}
			if err := holder.Commit(f.ctx); err != nil {
				t.Fatal(err)
			}
			select {
			case <-done:
			case <-time.After(15 * time.Second):
				t.Fatal("binding reentry did not finish after closing lock release")
			}
			queueReentryExpectError(t, response, http.StatusConflict, "queue_pool_changed")
			if after := queueReentryFingerprint(t, f, f.db.Pool()); after != before {
				t.Fatal("blocked binding changed pool/contact, private history, conversation, binding epoch or import receipt")
			}
			// Positive control: the exact same owner/identity/retention fixture can
			// bind its observed history after the dedicated claim actually commits.
			f.claim(t)
			queueReentryExpectSuccess(t, f, queueReentryPost(t, f, f.actor, request), request)
			var bound bool
			if err := f.db.Pool().QueryRow(f.ctx, `select c.lead_id=$3::uuid
				and exists(select 1 from private.whatsapp_unlinked_history_links h where h.organization_id=c.organization_id and h.conversation_id=c.id and h.lead_id=$3::uuid)
				and exists(select 1 from public.whatsapp_messages m where m.organization_id=c.organization_id and m.conversation_id=c.id and m.lead_id=$3::uuid and m.content='Synthetic unlinked private history')
				from public.whatsapp_conversations c where c.organization_id=$1::uuid and c.id=$2::uuid`, f.org, conversation, f.lead).Scan(&bound); err != nil || !bound {
				t.Fatalf("legitimately claimed reentry did not bind the exact confirmed history: bound=%t error=%v", bound, err)
			}
		})
	}
}

func warmQueueReentryBindingConnections(t *testing.T, f queuePostLockFixture) {
	t.Helper()
	// Keep every acquisition until all three are live: holder, real handler and
	// observer must not race cold transport/connection startup inside the wait
	// budget. Distinct backend PIDs prove this did not just reuse one connection.
	seen := make(map[int32]bool, 3)
	for i := 0; i < 3; i++ {
		connection, err := f.db.Pool().Acquire(f.ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer connection.Release()
		var pid int32
		if err := connection.QueryRow(f.ctx, `select pg_backend_pid()`).Scan(&pid); err != nil {
			t.Fatal(err)
		}
		if seen[pid] {
			t.Fatal("binding regression requires three independently live PostgreSQL backends")
		}
		seen[pid] = true
	}
	t.Logf("warmed three independent binding regression backends: %v", seen)
}
