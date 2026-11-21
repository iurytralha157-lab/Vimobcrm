package leads

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

// The wrapper observes the actual pgx batch. The second connection commits
// after the read snapshot is established and before either query is sent.
type boardSnapshotBarrier struct {
	beginner    pipelineBoardReadBeginner
	beforeBatch func() error
	options     pgx.TxOptions
	queries     []string
	err         error
	batches     int
}

type boardSnapshotBarrierTx struct {
	pgx.Tx
	barrier *boardSnapshotBarrier
}

func (fixture *boardSnapshotBarrier) BeginTx(ctx context.Context, options pgx.TxOptions) (pgx.Tx, error) {
	fixture.options = options
	tx, err := fixture.beginner.BeginTx(ctx, options)
	if err != nil {
		return nil, err
	}
	return &boardSnapshotBarrierTx{Tx: tx, barrier: fixture}, nil
}

func (tx *boardSnapshotBarrierTx) SendBatch(ctx context.Context, batch *pgx.Batch) pgx.BatchResults {
	tx.barrier.batches++
	for _, query := range batch.QueuedQueries {
		tx.barrier.queries = append(tx.barrier.queries, query.SQL)
	}
	tx.barrier.err = tx.barrier.beforeBatch()
	return tx.Tx.SendBatch(ctx, batch)
}

func TestPipelineBoardSnapshotTwoConnectionsKeepCardsAndMetricsCoherent(t *testing.T) {
	ctx, writer := openLeadPipelinePostgresFixture(t)
	for _, statement := range pipelineBoardSnapshotSchema {
		pipelinePostgresExec(t, ctx, writer, statement)
	}
	// Reuse the owned generated database and the existing one-connection pool
	// helper. The writer above is an independent connection, not a second pool.
	repo := openPipelineLegacyHistoryRepository(t, ctx, writer)
	org, foreignOrg, actor := pipelinePostgresID(1), pipelinePostgresID(2), pipelinePostgresID(3)
	pipeline, stageA, stageB, lead := pipelinePostgresID(4), pipelinePostgresID(5), pipelinePostgresID(6), pipelinePostgresID(7)
	at := time.Date(2026, 10, 20, 12, 0, 0, 123456000, time.UTC)
	pipelinePostgresExec(t, ctx, writer, `insert into public.pipelines(id,organization_id,is_default,position,created_at) values($1,$2,true,0,$3)`, pipeline, org, at)
	pipelinePostgresExec(t, ctx, writer, `insert into public.stages(id,organization_id,pipeline_id,name,stage_key,position,created_at,updated_at) values($1,$2,$3,'A','a',0,$5,$5),($4,$2,$3,'B','b',1,$5,$5)`, stageA, org, pipeline, stageB, at)
	viewer := tenant.Context{OrganizationID: org, UserID: actor, MemberRole: "admin"}
	filter := PipelineBoardFilter{PipelineID: pipeline, Limit: 1}
	fallbackPipeline, emptyPipeline, foreignPipeline := pipelinePostgresID(12), pipelinePostgresID(13), pipelinePostgresID(14)
	fallbackStage, inactiveStage, inconsistentForeignStage := pipelinePostgresID(15), pipelinePostgresID(16), pipelinePostgresID(17)
	pipelinePostgresExec(t, ctx, writer, `insert into public.pipelines(id,organization_id,is_default,position,created_at)
		values($1,$4,null,-1,$6),($2,$4,false,1,$6),($3,$5,true,-2,$6)`, fallbackPipeline, emptyPipeline, foreignPipeline, org, foreignOrg, at)
	pipelinePostgresExec(t, ctx, writer, `insert into public.stages(id,organization_id,pipeline_id,name,position,is_active,created_at,updated_at)
		values($1,$7,$4,'Fallback',0,true,$8,$8),($2,$7,$5,'Archived',0,false,$8,$8),($3,$7,$6,'Foreign pipeline',0,true,$8,$8)`,
		fallbackStage, inactiveStage, inconsistentForeignStage, fallbackPipeline, emptyPipeline, foreignPipeline, org, at)

	t.Run("implicit default then legacy fallback", func(t *testing.T) {
		board, err := repo.readPipelineBoardSnapshot(ctx, repo.db.Pool(), viewer, PipelineBoardFilter{Limit: 1})
		if err != nil || len(board) != 2 || board[0].ID != stageA || board[1].ID != stageB {
			t.Fatalf("implicit default pipeline changed: %v, %v", board, err)
		}
		pipelinePostgresExec(t, ctx, writer, `update public.pipelines set is_default=false where id=$1`, pipeline)
		board, err = repo.readPipelineBoardSnapshot(ctx, repo.db.Pool(), viewer, PipelineBoardFilter{Limit: 1})
		if err != nil || len(board) != 1 || board[0].ID != fallbackStage || board[0].PipelineID != fallbackPipeline {
			t.Fatalf("implicit fallback pipeline changed: %v, %v", board, err)
		}
	})
	t.Run("explicit empty and foreign pipeline", func(t *testing.T) {
		board, err := repo.readPipelineBoardSnapshot(ctx, repo.db.Pool(), viewer, PipelineBoardFilter{PipelineID: emptyPipeline})
		if err != nil || board == nil || len(board) != 0 {
			t.Fatalf("valid empty pipeline changed: %v, %v", board, err)
		}
		board, err = repo.readPipelineBoardSnapshot(ctx, repo.db.Pool(), viewer, PipelineBoardFilter{PipelineID: foreignPipeline})
		if !errors.Is(err, ErrInvalidReference) || board != nil {
			t.Fatalf("foreign pipeline reached board: %v, %v", board, err)
		}
	})

	for _, action := range []string{"move A to B", "insert into A", "delete last A"} {
		t.Run(action, func(t *testing.T) {
			pipelinePostgresExec(t, ctx, writer, `truncate public.leads`)
			pipelinePostgresExec(t, ctx, writer, `insert into public.leads(id,organization_id,name,stage_id,pipeline_id,assigned_user_id,valor_interesse,created_at,updated_at,board_order_at) values($1,$2,'Owned lead',$3,$4,$5,100,$6,$6,$6),($7,$8,'Foreign lead',$3,$4,$5,999,$6,$6,$6)`, lead, org, stageA, pipeline, actor, at, pipelinePostgresID(8), foreignOrg)
			barrier := &boardSnapshotBarrier{beginner: repo.db.Pool(), beforeBatch: func() error {
				switch action {
				case "move A to B":
					_, err := writer.Exec(ctx, `update public.leads set stage_id=$2 where id=$1`, lead, stageB)
					return err
				case "insert into A":
					_, err := writer.Exec(ctx, `insert into public.leads(id,organization_id,name,stage_id,pipeline_id,assigned_user_id,valor_interesse,created_at,updated_at,board_order_at) values($1,$2,'Inserted lead',$3,$4,$5,50,$6,$6,$6)`, pipelinePostgresID(9), org, stageA, pipeline, actor, at.Add(time.Second))
					return err
				default:
					_, err := writer.Exec(ctx, `delete from public.leads where id=$1`, lead)
					return err
				}
			}}
			before, err := repo.readPipelineBoardSnapshot(ctx, barrier, viewer, filter)
			if err != nil {
				t.Fatal(err)
			}
			if barrier.batches != 1 || barrier.err != nil || len(barrier.queries) != 2 ||
				!strings.Contains(barrier.queries[0], "with requested_stages(stage_id)") ||
				!strings.Contains(barrier.queries[1], "group by l.stage_id") {
				t.Fatalf("actual cards/metrics barrier was not crossed once: %+v", barrier)
			}
			assertBoardSnapshot(t, before, stageA, stageB, lead, 1, 0, 100, 0)
			after, err := repo.readPipelineBoardSnapshot(ctx, repo.db.Pool(), viewer, filter)
			if err != nil {
				t.Fatal(err)
			}
			switch action {
			case "move A to B":
				assertBoardSnapshot(t, after, stageA, stageB, lead, 0, 1, 0, 100)
			case "insert into A":
				assertBoardSnapshot(t, after, stageA, stageB, pipelinePostgresID(9), 2, 0, 150, 0)
			default:
				assertBoardSnapshot(t, after, stageA, stageB, "", 0, 0, 0, 0)
			}
			if repo.db.Pool().Config().MaxConns != 1 || repo.db.Pool().Stat().AcquiredConns() != 0 {
				t.Fatal("snapshot held a connection after completion or used more than the bounded reader pool")
			}
		})
	}
}

func assertBoardSnapshot(t *testing.T, board []PipelineBoardStage, stageA, stageB, lead string, totalA, totalB int64, valueA, valueB float64) {
	t.Helper()
	if len(board) != 2 || board[0].ID != stageA || board[1].ID != stageB {
		t.Fatalf("stage identity/order changed: %+v", board)
	}
	for index, want := range []struct {
		total int64
		value float64
	}{{totalA, valueA}, {totalB, valueB}} {
		stage := board[index]
		visible := int64(len(stage.Leads))
		if stage.TotalLeadCount != want.total || stage.TotalValue != want.value || visible > want.total || stage.HasMore != (want.total > visible) {
			t.Fatalf("cards and metrics came from different snapshots in stage %d: %+v, want count=%d value=%v", index, stage, want.total, want.value)
		}
		if want.total > 0 && (visible != 1 || stage.Leads[0].ID != lead || stage.Leads[0].StageID == nil || *stage.Leads[0].StageID != stage.ID) {
			t.Fatalf("limited card is missing, foreign or out of order: %+v", stage)
		}
	}
}

// Minimal, owned SQL fixture for the actual production read projection. These
// functions model the test audience only, never deployed RLS or business logic.
var pipelineBoardSnapshotSchema = []string{
	`create schema private`,
	`create function private.queue_pool_read_access(uuid,uuid,uuid) returns boolean language sql stable as 'select null::boolean'`,
	`create table public.pipelines(id uuid primary key,organization_id uuid,is_default boolean,position int,created_at timestamptz)`,
	`alter table public.stages add column pipeline_id uuid,add column color text,add column stage_key text,
	 add column position int,add column is_won boolean default false,add column is_lost boolean default false,
	 add column is_qualified boolean default false,add column sla_hours int,add column is_active boolean default true,
	 add column created_at timestamptz,add column updated_at timestamptz`,
	`alter table public.leads add column name text,add column phone text,add column email text,add column updated_at timestamptz,
	 add column stage_id uuid,add column team_id uuid,add column pipeline_id uuid,add column message text,
	 add column stage_entered_at timestamptz,add column board_order_at timestamptz,add column last_entry_at timestamptz,
	 add column reentry_count int default 0,add column whatsapp_avatar_url text,add column whatsapp_avatar_storage_path text,
	 add column deal_status text default 'open',add column valor_interesse numeric,add column property_id uuid,
	 add column lost_reason text,add column won_at timestamptz,add column lost_at timestamptz,
	 add column interest_property_id uuid,add column sla_status text,add column sla_seconds_elapsed int`,
	`create table public.properties(id uuid primary key,organization_id uuid,preco numeric,responsible_user_id uuid,created_by uuid)`,
}
