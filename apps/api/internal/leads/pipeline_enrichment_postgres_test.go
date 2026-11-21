package leads

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestPipelineEnrichmentBatchesQueueProjectionAgainstPostgres(t *testing.T) {
	ctx, writer := openLeadPipelinePostgresFixture(t)
	for _, statement := range []string{
		`create schema private`,
		`alter table public.leads add column property_id uuid, add column interest_property_id uuid`,
		`create table public.lead_tasks(organization_id uuid, lead_id uuid, is_done boolean)`,
		`create table public.meta_integrations(organization_id uuid, page_id text, page_name text)`,
		`create table private.fixture_queue_audience(organization_id uuid, lead_id uuid, user_id uuid, revoke_after_seed boolean)`,
		`create sequence private.fixture_queue_reads`,
		`create function private.queue_pool_read_access(uuid,uuid,uuid) returns boolean language sql volatile as $$
		  select case when revoke_after_seed then nextval('private.fixture_queue_reads') = 1 else true end
		  from private.fixture_queue_audience where organization_id = $1 and lead_id = $2 and user_id = $3
		$$`,
		`create function private.queue_pool_metadata(uuid,uuid,uuid) returns jsonb language sql stable as $$
		  select jsonb_build_object('state','pool_ready','canClaim',true)
		  from private.fixture_queue_audience where organization_id = $1 and lead_id = $2 and user_id = $3
		$$`,
	} {
		pipelinePostgresExec(t, ctx, writer, statement)
	}
	repo := openPipelineLegacyHistoryRepository(t, ctx, writer)
	org, user, ordinaryID, poolID, otherID := pipelinePostgresID(1), pipelinePostgresID(2), pipelinePostgresID(3), pipelinePostgresID(4), pipelinePostgresID(5)
	pipelinePostgresExec(t, ctx, writer, `insert into public.users(id,organization_id,name) values($1,$2,'Broker')`, user, org)
	pipelinePostgresExec(t, ctx, writer, `insert into public.organization_members(organization_id,user_id) values($1,$2)`, org, user)
	pipelinePostgresExec(t, ctx, writer, `insert into public.leads(id,organization_id,assigned_user_id) values($1,$2,$3),($4,$2,null),($5,$2,$6)`,
		ordinaryID, org, user, poolID, otherID, pipelinePostgresID(6))
	pipelinePostgresExec(t, ctx, writer, `insert into private.fixture_queue_audience values($1,$2,$3,false)`, org, poolID, user)
	pipelinePostgresExec(t, ctx, writer, `insert into public.lead_tasks values($1,$2,false),($1,$2,true)`, org, ordinaryID)
	actor := tenant.Context{OrganizationID: org, UserID: user, MemberRole: "user", Permissions: []string{permissions.LeadViewOwn, permissions.LeadOperate}}

	t.Run("board uses two acquisitions and keeps enrichment and pool metadata", func(t *testing.T) {
		ordinary := &PipelineBoardLead{ID: ordinaryID, CanOperate: true}
		queued := &PipelineBoardLead{ID: poolID, CanOperate: true}
		before := repo.db.Pool().Stat().AcquireCount()
		if err := repo.attachPipelineBoardLeadEnrichments(ctx, actor, []*PipelineBoardLead{ordinary, queued}); err != nil {
			t.Fatal(err)
		}
		if got := repo.db.Pool().Stat().AcquireCount() - before; got != 2 {
			t.Fatalf("enrichment acquisitions = %d, want seed and one batch", got)
		}
		if !ordinary.CanOperate || ordinary.QueuePool != nil || ordinary.Assignee == nil || ordinary.Assignee.ID != user ||
			ordinary.TasksCount.Pending != 1 || ordinary.TasksCount.Completed != 1 {
			t.Fatalf("unexpected ordinary enrichment: %+v", ordinary)
		}
		if queued.CanOperate || queued.QueuePool == nil || queued.QueuePool.State != "pool_ready" || !queued.QueuePool.CanClaim {
			t.Fatalf("unexpected queue projection: %+v", queued)
		}
	})

	t.Run("board fails closed if an ordinary card left the actor scope", func(t *testing.T) {
		before := repo.db.Pool().Stat().AcquireCount()
		err := repo.attachPipelineBoardLeadEnrichments(ctx, actor, []*PipelineBoardLead{{ID: ordinaryID}, {ID: otherID}})
		if !errors.Is(err, ErrLeadNotFound) || repo.db.Pool().Stat().AcquireCount()-before != 1 {
			t.Fatalf("stale card must fail at seed and skip the batch: %v", err)
		}
	})

	pipelinePostgresExec(t, ctx, writer, `update private.fixture_queue_audience set revoke_after_seed = true`)
	t.Run("board respects a denial after scoped seeds", func(t *testing.T) {
		pipelinePostgresExec(t, ctx, writer, `select setval('private.fixture_queue_reads', 1, false)`)
		var signed atomic.Int32
		storage := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
			signed.Add(1)
			_, _ = w.Write([]byte(`{"signedURL":"/object/sign/whatsapp-media/fixture?token=avatar"}`))
		}))
		defer storage.Close()
		boardRepo := newAvatarSigningTestRepository(storage)
		boardRepo.db = repo.db
		storagePath := avatarTestStoragePath(org, poolID)
		card := &PipelineBoardLead{ID: poolID, OrganizationID: org, WhatsAppAvatarStoragePath: &storagePath}
		before := repo.db.Pool().Stat().AcquireCount()
		err := boardRepo.attachPipelineBoardLeadEnrichments(ctx, actor, []*PipelineBoardLead{card})
		if !errors.Is(err, ErrLeadNotFound) || card.QueuePool != nil || signed.Load() != 1 ||
			repo.db.Pool().Stat().AcquireCount()-before != 2 {
			t.Fatalf("late pool denial must fail closed in the same batch: %v", err)
		}
	})

	t.Run("public enrichments retain scoped partial results", func(t *testing.T) {
		pipelinePostgresExec(t, ctx, writer, `select setval('private.fixture_queue_reads', 1, false)`)
		got, err := repo.ListEnrichments(ctx, actor, []string{ordinaryID, otherID, poolID})
		if err != nil || len(got) != 2 || got[0].LeadID != ordinaryID || got[1].LeadID != poolID {
			t.Fatalf("public enrichment scope or order changed: %+v, %v", got, err)
		}
	})
}
