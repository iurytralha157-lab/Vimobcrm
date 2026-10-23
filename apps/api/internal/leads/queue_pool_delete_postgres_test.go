package leads

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

// The unlocked delete preflight sees the committed automatic owner while a
// concurrent close owns the lead. Authorize again from the post-lock runtime,
// then prove that the exact same permitted deletion works after a real claim.
func TestQueuePoolDeleteRechecksAfterClosingLockAgainstPostgres(t *testing.T) {
	f := newQueuePostLockFixture(t)
	holder, err := f.db.Pool().Begin(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer holder.Rollback(f.ctx)
	var holderPID int32
	if err := holder.QueryRow(f.ctx, `select pg_backend_pid()`).Scan(&holderPID); err != nil {
		t.Fatal(err)
	}
	if _, err := holder.Exec(f.ctx, `select id from public.round_robins where organization_id=$1::uuid and id=$2::uuid for share`, f.org, f.queue); err != nil {
		t.Fatal(err)
	}
	if _, err := holder.Exec(f.ctx, `select private.queue_runtime_pool($1::uuid,$2::uuid,'queue_closed',clock_timestamp(),'{"open":false}'::jsonb)`, f.org, f.lead); err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodDelete, "/v1/leads/"+f.lead, nil)
	request.SetPathValue("id", f.lead)
	request = request.WithContext(tenant.ContextWithTenant(f.ctx, f.actor))
	response := httptest.NewRecorder()
	done := make(chan struct{})
	go func() { NewHandler(f.repo).Delete(response, request); close(done) }()
	waiting := false
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		if err := f.db.Pool().QueryRow(f.ctx, `select exists(select 1 from pg_stat_activity where datname=current_database()
		 and wait_event_type='Lock' and $1::int=any(pg_blocking_pids(pid)) and query like '%for update of l%')`, holderPID).Scan(&waiting); err != nil {
			t.Fatal(err)
		}
		if waiting {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if !waiting {
		holder.Rollback(f.ctx)
		<-done
		t.Fatal("DELETE did not prove its actual post-preflight lead-lock wait")
	}
	if err := holder.Commit(f.ctx); err != nil {
		t.Fatal(err)
	}
	<-done
	if response.Code != http.StatusConflict {
		t.Fatalf("pooled DELETE after wait: status=%d, want409; body=%s", response.Code, response.Body.String())
	}
	var intact bool
	if err := f.db.Pool().QueryRow(f.ctx, `select r.state='pool_waiting' and l.assigned_user_id is null
	 and exists(select 1 from public.lead_tasks where organization_id=l.organization_id and lead_id=l.id and id=$3::uuid)
	 and not exists(select 1 from private.queue_pool_claim_receipts where organization_id=l.organization_id and lead_id=l.id)
	 and not exists(select 1 from public.audit_logs where organization_id=l.organization_id and entity_type='lead' and entity_id=l.id::text and action='delete')
	 from public.leads l join private.queue_lead_runtime r on r.organization_id=l.organization_id and r.lead_id=l.id
	 where l.organization_id=$1::uuid and l.id=$2::uuid`, f.org, f.lead, f.task).Scan(&intact); err != nil || !intact {
		t.Fatalf("rejected DELETE changed or removed pooled lead: intact=%t error=%v", intact, err)
	}
	f.claim(t)
	claimedDelete := httptest.NewRequest(http.MethodDelete, "/v1/leads/"+f.lead, nil)
	claimedDelete.SetPathValue("id", f.lead)
	claimedDelete = claimedDelete.WithContext(tenant.ContextWithTenant(f.ctx, f.actor))
	claimedResponse := httptest.NewRecorder()
	NewHandler(f.repo).Delete(claimedResponse, claimedDelete)
	if claimedResponse.Code != http.StatusNoContent {
		t.Fatalf("permitted DELETE after legitimate claim: status=%d body=%s", claimedResponse.Code, claimedResponse.Body.String())
	}
	var removed bool
	if err := f.db.Pool().QueryRow(f.ctx, `select not exists(select 1 from public.leads where organization_id=$1::uuid and id=$2::uuid)
	 and exists(select 1 from public.audit_logs where organization_id=$1::uuid and entity_type='lead' and entity_id=$2::text and action='delete')`, f.org, f.lead).Scan(&removed); err != nil || !removed {
		t.Fatalf("post-claim DELETE failed its persisted control: removed=%t error=%v", removed, err)
	}
	t.Log("actual DELETE waited behind pool close, returned409 with zero claims and intact lead/task; same real admin deleted successfully only after claim")
}
