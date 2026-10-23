package developments

import (
	"context"
	"errors"
	"net/url"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func TestQueuePoolReviewReservationCurrentScopeAndWaitPostgres(t *testing.T) {
	raw := os.Getenv("REVIEW_DATABASE_URL")
	if raw == "" {
		t.Skip("REVIEW_DATABASE_URL is not set: requires the attested disposable review fixture")
	}
	target, err := url.Parse(raw)
	if err != nil || target.Hostname() != "127.0.0.1" || target.Path != "/vimob_review_distribution_20261016_83dfa4ae" {
		t.Fatal("unapproved local review target")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	database, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: raw, MaxConns: 6, HealthTimeout: 10 * time.Second})
	if err != nil {
		t.Fatal("local review connection failed")
	}
	defer database.Close()
	var runID string
	if err := database.Pool().QueryRow(ctx, `select run_id::text from vimob_local_bootstrap.sentinel where singleton`).Scan(&runID); err != nil || runID != "fb4b49ef-b2c8-477f-9b8b-c3da63b7eb3d" {
		t.Fatal("local sentinel mismatch")
	}
	const org = "d1610001-0000-4000-8000-000000000001"
	const pooled = "d1610005-0000-4000-8000-000000009002"
	const queue = "d1610006-0000-4000-8000-000000000001"
	admin := tenant.Context{OrganizationID: org, UserID: "d1610002-0000-4000-8000-000000000006", MemberRole: "admin", Permissions: []string{"*"}}
	outsider := tenant.Context{OrganizationID: org, UserID: "d1610002-0000-4000-8000-000000000007", MemberRole: "user", Permissions: []string{permissions.PropertyManage, permissions.LeadViewAll}}
	for _, actor := range []tenant.Context{admin, outsider} {
		tx, err := database.Pool().Begin(ctx)
		if err != nil {
			t.Fatal(err)
		}
		scope, err := loadReservationLeadScope(ctx, tx, org, pooled, actor.UserID)
		if err != nil {
			tx.Rollback(ctx)
			t.Fatal(err)
		}
		wantRead := actor.UserID == admin.UserID
		if scope.QueuePoolReadAccess == nil || *scope.QueuePoolReadAccess != wantRead || canViewReservationLead(actor, scope) != wantRead {
			t.Fatal("reservation projection ignored current private audience")
		}
		if err := requireReservationLeadMutation(ctx, tx, actor, Reservation{LeadID: &[]string{pooled}[0]}); !errors.Is(err, ErrNotFound) {
			t.Fatalf("reservation operation bypassed claim: %v", err)
		}
		if err := tx.Rollback(ctx); err != nil {
			t.Fatal(err)
		}
	}
	var leadID string
	if err := database.Pool().QueryRow(ctx, `insert into public.leads(organization_id,name,source,pipeline_id,stage_id,origin_round_robin_id,metadata)
	 select $1::uuid,'Synthetic reservation pool wait review','manual',q.pipeline_id,q.target_stage_id,q.id,'{"distribution_deferred":true}'::jsonb from public.round_robins q where q.organization_id=$1::uuid and q.id=$2::uuid returning id::text`, org, queue).Scan(&leadID); err != nil {
		t.Fatal(err)
	}
	defer func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if _, err := database.Pool().Exec(cleanup, `delete from public.leads where organization_id=$1::uuid and id=$2::uuid`, org, leadID); err != nil {
			t.Error("reservation wait fixture cleanup failed")
		}
	}()
	var result string
	if err := database.Pool().QueryRow(ctx, `select private.distribute_lead($1::uuid,$2::uuid,'reservation-review-'||$2::text,$3::uuid,false,'meta')::text`, org, leadID, queue).Scan(&result); err != nil {
		t.Fatal(err)
	}
	initial, err := loadReservationLeadScope(ctx, database.Pool(), org, leadID, admin.UserID)
	if err != nil || initial.QueuePoolReadAccess != nil {
		t.Fatal("positive control must start outside pool")
	}
	if !canOperateReservation(admin, initial, Reservation{LeadID: &leadID}) {
		t.Fatal("ordinary reservation link lost its original management scope")
	}
	holder, err := database.Pool().Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer holder.Rollback(ctx)
	var holderPID int32
	if err := holder.QueryRow(ctx, `select pg_backend_pid()`).Scan(&holderPID); err != nil {
		t.Fatal(err)
	}
	if _, err := holder.Exec(ctx, `select id from public.round_robins where id=$1::uuid for share`, queue); err != nil {
		t.Fatal(err)
	}
	if _, err := holder.Exec(ctx, `select private.queue_runtime_pool($1::uuid,$2::uuid,'queue_closed',clock_timestamp(),'{"open":false}'::jsonb)`, org, leadID); err != nil {
		t.Fatal(err)
	}
	type outcome struct {
		scope reservationLeadScope
		err   error
	}
	done := make(chan outcome, 1)
	go func() {
		scope, err := loadReservationLeadScope(ctx, database.Pool(), org, leadID, admin.UserID)
		done <- outcome{scope, err}
	}()
	waited := false
	deadline := time.Now().Add(8 * time.Second)
	for time.Now().Before(deadline) {
		var waiting bool
		if err := database.Pool().QueryRow(ctx, `select exists(select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and $1::int=any(pg_blocking_pids(pid)) and query like '%from public.leads as lead%')`, holderPID).Scan(&waiting); err != nil {
			t.Fatal(err)
		}
		if waiting {
			waited = true
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if !waited {
		holder.Rollback(ctx)
		<-done
		t.Fatal("did not observe the actual reservation lead-lock wait")
	}
	if err := holder.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	after := <-done
	if after.err != nil || after.scope.QueuePoolReadAccess == nil || !*after.scope.QueuePoolReadAccess || canOperateReservation(admin, after.scope, Reservation{LeadID: &leadID}) {
		t.Fatalf("post-wait pool scope was stale: %v", after.err)
	}
	_, err = loadReservationLeadScope(ctx, database.Pool(), "d1610001-0000-4000-8000-000000000002", leadID, outsider.UserID)
	if !errors.Is(err, pgx.ErrNoRows) {
		t.Fatal("reservation lead lookup crossed tenants")
	}
	t.Log("real scope loads preserve private reads, deny all pool mutations, and refresh runtime after an observed concurrent pool commit")
}
