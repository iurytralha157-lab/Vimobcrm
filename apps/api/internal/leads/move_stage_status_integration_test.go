package leads

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/realtime"
)

func TestManualMoveStageCommitsWithRealtimeEvent(t *testing.T) {
	f := newAutomationStageFixture(t, "commissions", "financial_entries")
	migration, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "supabase", "migrations", "20261123043951_serialize_realtime_event_cursor_allocation.sql"))
	if err != nil {
		t.Fatal(err)
	}
	_, function, hasFunction := strings.Cut(string(migration), "create function")
	function, _, hasPermissions := strings.Cut(function, "revoke all on function")
	_, trigger, hasTrigger := strings.Cut(string(migration), "create trigger")
	trigger, _, hasCommit := strings.Cut(trigger, "commit;")
	if !hasFunction || !hasPermissions || !hasTrigger || !hasCommit {
		t.Fatal("cannot locate the production cursor function and trigger statements")
	}
	f.exec(t, "create function"+function+"create trigger"+trigger)

	actor, err := f.resolver.Resolve(f.ctx, f.user, f.org)
	if err != nil {
		t.Fatal(err)
	}
	destination, leadID := pipelinePostgresID(720), pipelinePostgresID(721)
	f.exec(t, `insert into public.stages(id,organization_id,pipeline_id,name,stage_key)
		values($1,$2,$3,'Ordinary','ordinary')`, destination, f.org, f.pipeline)
	f.exec(t, `insert into public.leads(id,organization_id,name,source,deal_status,pipeline_id,stage_id,assigned_user_id)
		values($1,$2,'Synthetic lead','manual','open',$3,$4,$5)`, leadID, f.org, f.pipeline, f.open, f.user)

	store := realtime.NewPostgresStore(f.db)
	f.exec(t, `alter table private.realtime_events add constraint fail_test_publish check (event_type <> 'lead.stage_moved')`)
	if _, err := f.repo.MoveStage(f.ctx, actor, leadID, moveStageInput{StageID: destination}); err == nil {
		t.Fatal("expected failed event append to abort the stage move")
	}
	if status, stage := f.status(t, leadID); status != "open" || stage != f.open {
		t.Fatalf("stage/status after failed append = %s/%s", stage, status)
	}
	if count := f.count(t, "private.realtime_events"); count != 0 {
		t.Fatalf("failed move left %d realtime events", count)
	}
	f.exec(t, `alter table private.realtime_events drop constraint fail_test_publish`)

	// Match the inbound order: write to the feed first, then try to update the lead.
	competitor, err := f.conn.Begin(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer competitor.Rollback(f.ctx)
	if _, err := competitor.Exec(f.ctx, `insert into private.realtime_events (organization_id,event_type,data,created_at)
		values ($1,'test.inbound','{}',now())`, f.org); err != nil {
		t.Fatal(err)
	}
	attempts := 0
	move := moveStageInput{StageID: destination}
	_, err = retryLeadRealtimeWrite(f.ctx, func() (moveStageResult, error) {
		attempts++
		ctx, cancel := context.WithTimeout(f.ctx, time.Second)
		defer cancel()
		result, moveErr := f.repo.MoveStage(ctx, actor, leadID, move)
		if attempts == 1 {
			if !errors.Is(moveErr, errLeadRealtimeBusy) {
				t.Fatalf("move must release the lead while the feed is locked: %v", moveErr)
			}
			if _, err := competitor.Exec(ctx, `update public.leads set name = name where id = $1`, leadID); err != nil {
				t.Fatalf("inbound transaction could not acquire the lead after rollback: %v", err)
			}
			if err := competitor.Rollback(ctx); err != nil {
				t.Fatal(err)
			}
		}
		return result, moveErr
	})
	if err != nil || attempts != 2 {
		t.Fatalf("move after cursor release: attempts=%d, err=%v", attempts, err)
	}
	if _, err := f.repo.MoveStage(f.ctx, actor, leadID, move); err != nil {
		t.Fatal(err)
	}
	cursor, err := store.LatestID(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	events, err := store.ListSubscriberAfter(f.ctx, f.org, f.user, 0, cursor, 10)
	if err != nil || len(events) != 2 {
		t.Fatalf("expected two stored realtime events, got %d, %v", len(events), err)
	}
	for i, eventType := range []string{"lead.stage_moved", "lead.reordered"} {
		event := events[i]
		if event.Type != eventType || event.UserID != f.user || event.Data["leadId"] != leadID || event.Data["stageId"] != destination || event.Data["pipelineId"] != f.pipeline {
			t.Fatalf("unexpected realtime event %d: %+v", i, event)
		}
	}
	crossTenant, err := store.ListSubscriberAfter(f.ctx, pipelinePostgresID(99), f.user, 0, cursor, 10)
	if err != nil || len(crossTenant) != 0 {
		t.Fatalf("another organization got %d events, %v", len(crossTenant), err)
	}

	update := updateInput{StageID: patchString{Set: true, Value: &f.open}}
	f.exec(t, `alter table private.realtime_events add constraint fail_test_publish check (event_type <> 'lead.updated')`)
	if _, err := f.repo.Update(f.ctx, actor, leadID, update); err == nil {
		t.Fatal("expected failed event append to abort the patch")
	}
	if _, stage := f.status(t, leadID); stage != destination {
		t.Fatalf("stage after failed patch = %s, want %s", stage, destination)
	}
	f.exec(t, `alter table private.realtime_events drop constraint fail_test_publish`)
	if _, err := f.repo.Update(f.ctx, actor, leadID, update); err != nil {
		t.Fatal(err)
	}
	latest, err := store.LatestID(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	events, err = store.ListSubscriberAfter(f.ctx, f.org, f.user, cursor, latest, 10)
	if err != nil || len(events) != 1 || events[0].Type != "lead.updated" || events[0].Data["stageId"] != f.open || events[0].Data["assignedUserId"] != f.user {
		t.Fatalf("unexpected patch event: %+v, %v", events, err)
	}

	const batchSize = 30
	results := make(chan error, batchSize)
	start := make(chan struct{})
	for i := range batchSize {
		id := pipelinePostgresID(730 + i)
		f.exec(t, `insert into public.leads(id,organization_id,name,source,deal_status,pipeline_id,stage_id,assigned_user_id)
			values($1,$2,'Synthetic concurrent lead','manual','open',$3,$4,$5)`, id, f.org, f.pipeline, f.open, f.user)
		go func() {
			<-start
			_, err := retryLeadRealtimeWrite(f.ctx, func() (moveStageResult, error) {
				return f.repo.MoveStage(f.ctx, actor, id, move)
			})
			results <- err
		}()
	}
	close(start)
	for range batchSize {
		if err := <-results; err != nil {
			t.Errorf("concurrent move: %v", err)
		}
	}
	last, err := store.LatestID(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	events, err = store.ListSubscriberAfter(f.ctx, f.org, f.user, latest, last, batchSize+1)
	if err != nil || len(events) != batchSize {
		t.Fatalf("concurrent moves yielded %d events, want %d, error %v", len(events), batchSize, err)
	}
}

func TestMoveStageOutcomeLocalPostgres(t *testing.T) {
	f := newAutomationStageFixture(t, "commissions", "financial_entries")
	actor, err := f.resolver.Resolve(f.ctx, f.user, f.org)
	if err != nil {
		t.Fatal(err)
	}
	ordinary, automated := pipelinePostgresID(700), pipelinePostgresID(701)
	f.exec(t, `insert into public.stages(id,organization_id,pipeline_id,name,stage_key)
		values($1,$3,$4,'Ordinary','ordinary'),($2,$3,$4,'Automated loss','automated-loss')`, ordinary, automated, f.org, f.pipeline)
	f.exec(t, `insert into public.stage_automations(organization_id,stage_id,trigger_type,action_type,automation_type,action_config)
		values($1,$2,'on_enter','update','change_deal_status_on_enter','{"deal_status":"lost"}')`, f.org, automated)

	for _, test := range []struct {
		name, source, status, wantStatus string
		sequence                         int
		patch                            bool
		wantError                        error
	}{
		{name: "manual win through drag", source: f.open, status: "won", wantStatus: "won", sequence: 710},
		{name: "manual loss through patch", source: f.open, status: "lost", wantStatus: "lost", sequence: 711, patch: true},
		{name: "leave terminal flag", source: f.lost, status: "lost", wantStatus: "open", sequence: 712},
		{name: "leave terminal automation", source: automated, status: "lost", wantStatus: "open", sequence: 713, patch: true},
		{name: "terminal win without verified reservation", source: f.won, status: "won", wantStatus: "won", sequence: 714, wantError: ErrLeadReservationUnverified},
	} {
		t.Run(test.name, func(t *testing.T) {
			leadID := pipelinePostgresID(test.sequence)
			f.exec(t, `insert into public.leads(id,organization_id,name,source,deal_status,pipeline_id,stage_id,assigned_user_id,property_id,interest_property_id,lost_reason)
				values($1,$2,'Synthetic lead','manual',$3,$4,$5,$6,$7,$7,'Synthetic reason')`, leadID, f.org, test.status, f.pipeline, test.source, f.user, f.property)
			var revision time.Time
			if err := f.conn.QueryRow(f.ctx, `select updated_at from public.leads where id=$1`, leadID).Scan(&revision); err != nil {
				t.Fatal(err)
			}
			var err error
			if test.patch {
				_, err = f.repo.Update(f.ctx, actor, leadID, updateInput{StageID: patchString{Set: true, Value: &ordinary}, ExpectedUpdatedAt: &revision})
			} else {
				_, err = f.repo.MoveStage(f.ctx, actor, leadID, moveStageInput{StageID: ordinary, ExpectedUpdatedAt: &revision})
			}
			if !errors.Is(err, test.wantError) {
				t.Fatalf("stage move = %v, want %v", err, test.wantError)
			}
			wantStage := ordinary
			if test.wantError != nil {
				wantStage = test.source
			}
			if status, stage := f.status(t, leadID); status != test.wantStatus || stage != wantStage {
				t.Fatalf("persisted stage/status = %s/%s, want %s/%s", stage, status, wantStage, test.wantStatus)
			}
			var propertyStatus string
			if err := f.conn.QueryRow(f.ctx, `select status from public.properties where id=$1`, f.property).Scan(&propertyStatus); err != nil || propertyStatus != "active" {
				t.Fatalf("property status = %q, %v", propertyStatus, err)
			}
		})
	}

	t.Run("inactive property records a win without changing inventory", func(t *testing.T) {
		leadID := pipelinePostgresID(715)
		f.exec(t, `insert into public.leads(id,organization_id,name,source,deal_status,pipeline_id,stage_id,assigned_user_id,property_id,interest_property_id)
			values($1,$2,'Synthetic lead','manual','open',$3,$4,$5,$6,$6)`, leadID, f.org, f.pipeline, f.open, f.user, f.property)
		setProperty := func(status string, listed bool) time.Time {
			t.Helper()
			var revision time.Time
			err := f.conn.QueryRow(f.ctx, `update public.properties
				set status=$2, published_on_site=$3, anunciar=$3, updated_at=now()
				where id=$1 returning updated_at`, f.property, status, listed).Scan(&revision)
			if err != nil {
				t.Fatal(err)
			}
			return revision
		}
		setLead := func(status string) error {
			t.Helper()
			var revision time.Time
			if err := f.conn.QueryRow(f.ctx, `select updated_at from public.leads where id=$1`, leadID).Scan(&revision); err != nil {
				t.Fatal(err)
			}
			_, err := f.repo.Update(f.ctx, actor, leadID, updateInput{
				DealStatus:        patchString{Set: true, Value: &status},
				ExpectedUpdatedAt: &revision,
			})
			return err
		}
		assertProperty := func(wantStatus string, wantListed, wantMarker bool, unchangedSince time.Time) {
			t.Helper()
			var status string
			var published, advertised, marker bool
			var revision time.Time
			err := f.conn.QueryRow(f.ctx, `select status,published_on_site,anunciar,
				coalesce(metadata ? '_vimob_won_lead_reservation_event_id', false),updated_at
				from public.properties where id=$1`, f.property).Scan(&status, &published, &advertised, &marker, &revision)
			if err != nil || status != wantStatus || published != wantListed || advertised != wantListed || marker != wantMarker ||
				(!unchangedSince.IsZero() && !revision.Equal(unchangedSince)) {
				t.Fatalf("property = %q/%v/%v marker %v revision %s, %v", status, published, advertised, marker, revision, err)
			}
		}
		assertLead := func(wantStatus string, wantWon bool) {
			t.Helper()
			var status, property, interest string
			var won bool
			err := f.conn.QueryRow(f.ctx, `select deal_status,property_id::text,interest_property_id::text,won_at is not null
				from public.leads where id=$1`, leadID).Scan(&status, &property, &interest, &won)
			if err != nil || status != wantStatus || property != f.property || interest != f.property || won != wantWon {
				t.Fatalf("lead = %q/%q/%q won %v, %v", status, property, interest, won, err)
			}
		}

		for _, inactiveStatus := range []string{"inactive", "inativo"} {
			propertyRevision := setProperty(inactiveStatus, false)
			if err := setLead("won"); err != nil {
				t.Fatalf("record win for %s property: %v", inactiveStatus, err)
			}
			assertLead("won", true)
			assertProperty(inactiveStatus, false, false, propertyRevision)
			var historical, propertyEvents int
			err := f.conn.QueryRow(f.ctx, `select count(*) filter (where e.event_type='lead_won_on_inactive_property'
					and e.status='processed' and e.entity_type='lead' and e.entity_id=$3::uuid
					and e.payload->>'property_id'=$2::uuid::text
					and e.payload->'won_at'=to_jsonb(l.won_at at time zone 'UTC')),
				count(*) filter (where e.entity_type='property' and e.entity_id=$2::uuid
					and e.event_type in ('property_reserved_by_won_lead','lead_won_on_inactive_property'))
				from public.events e join public.leads l on l.id=$3::uuid
				where e.organization_id=$1`,
				f.org, f.property, leadID).Scan(&historical, &propertyEvents)
			if err != nil || historical != 1 || propertyEvents != 0 {
				t.Fatalf("historical lead event/property events = %d/%d, %v", historical, propertyEvents, err)
			}
			currentStatus, listed := inactiveStatus, false
			if inactiveStatus == "inativo" {
				currentStatus, listed = "active", true
				propertyRevision = setProperty(currentStatus, listed)
			}
			if err := setLead("open"); err != nil {
				t.Fatalf("reopen win recorded with %s property: %v", inactiveStatus, err)
			}
			assertLead("open", false)
			assertProperty(currentStatus, listed, false, propertyRevision)
		}

		// An earlier historical win must not exempt a later real reservation from release.
		if err := setLead("won"); err != nil {
			t.Fatalf("record new win for reactivated property: %v", err)
		}
		assertProperty("reserved", false, true, time.Time{})
		if err := setLead("open"); err != nil {
			t.Fatalf("release verified reservation: %v", err)
		}
		assertLead("open", false)
		assertProperty("active", true, false, time.Time{})

		for _, blocked := range []string{"sold", "rented", "reserved", "draft", "archived"} {
			propertyRevision := setProperty(blocked, false)
			if err := setLead("won"); !errors.Is(err, ErrLeadPropertyUnavailable) {
				t.Fatalf("win for %s property = %v, want ErrLeadPropertyUnavailable", blocked, err)
			}
			assertLead("open", false)
			assertProperty(blocked, false, false, propertyRevision)
		}
	})
}
