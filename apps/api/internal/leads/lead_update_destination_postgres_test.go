package leads

import (
	"errors"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/distribution"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

// Reuses only the explicit loopback opt-in and random owned database from the
// automation fixture. Actual repository SQL runs on baseline table definitions;
// targeted triggers below model changed effective destinations, not deployed RLS
// or the full production trigger graph. No migrations or remote data are used.
type leadUpdateDestinationFixture struct {
	*automationStageFixture
	actor                         tenant.Context
	otherPipeline, otherStage     string
	foreignPipeline, foreignStage string
}

func newLeadUpdateDestinationFixture(t *testing.T) *leadUpdateDestinationFixture {
	t.Helper()
	f := &leadUpdateDestinationFixture{automationStageFixture: newAutomationStageFixture(t), otherPipeline: pipelinePostgresID(710), otherStage: pipelinePostgresID(711), foreignPipeline: pipelinePostgresID(712), foreignStage: pipelinePostgresID(713)}
	var err error
	f.actor, err = f.resolver.Resolve(f.ctx, f.user, f.org)
	if err != nil {
		t.Fatal(err)
	}
	f.exec(t, `insert into public.pipelines(id,organization_id,name) values($1,$3,'Other local pipeline'),($2,$4,'Foreign pipeline')`, f.otherPipeline, f.foreignPipeline, f.org, pipelinePostgresID(99))
	f.exec(t, `insert into public.stages(id,organization_id,pipeline_id,name,stage_key) values($1,$3,$4,'Other local stage','other-local'),($2,$5,$6,'Foreign stage','other-foreign')`, f.otherStage, f.foreignStage, f.org, f.otherPipeline, pipelinePostgresID(99), f.foreignPipeline)
	f.exec(t, `create function public.fixture_lead_update_destination() returns trigger language plpgsql as $$
declare target jsonb;
begin
 if new.metadata ? '_fixture_wait' then perform pg_advisory_xact_lock(710201); end if;
 if new.metadata ? '_fixture_target' then
  target := new.metadata->'_fixture_target';
  new.pipeline_id := nullif(target->>'pipeline','')::uuid;
  new.stage_id := nullif(target->>'stage','')::uuid;
  insert into public.notifications(organization_id,user_id,lead_id,title)
   values(new.organization_id,new.assigned_user_id,new.id,'Synthetic trigger notification');
 end if;
 return new;
end $$;
create trigger fixture_lead_update_destination before update on public.leads
for each row execute function public.fixture_lead_update_destination();`)
	return f
}

func (f *leadUpdateDestinationFixture) seed(t *testing.T, sequence int) (string, time.Time) {
	t.Helper()
	id := pipelinePostgresID(sequence)
	f.exec(t, `insert into public.leads(id,organization_id,name,source,deal_status,pipeline_id,stage_id,assigned_user_id,stage_entered_at,board_order_at)
 values($1,$2,'Synthetic update lead','manual','open',$3,$4,$5,now(),now())`, id, f.org, f.pipeline, f.open, f.user)
	return id, f.revision(t, id)
}

func (f *leadUpdateDestinationFixture) revision(t *testing.T, id string) time.Time {
	t.Helper()
	var revision time.Time
	if err := f.conn.QueryRow(f.ctx, `select updated_at from public.leads where id=$1`, id).Scan(&revision); err != nil {
		t.Fatal(err)
	}
	return revision
}

type leadUpdateDestinationState struct {
	lead                                       string
	audits, activities, notifications, history int
}

func (f *leadUpdateDestinationFixture) state(t *testing.T, id string) leadUpdateDestinationState {
	t.Helper()
	var state leadUpdateDestinationState
	if err := f.conn.QueryRow(f.ctx, `select to_jsonb(l)::text from public.leads l where id=$1`, id).Scan(&state.lead); err != nil {
		t.Fatal(err)
	}
	state.audits = f.count(t, "public.audit_logs")
	state.activities = f.count(t, "public.activities")
	state.notifications = f.count(t, "public.notifications")
	state.history = f.count(t, "public.assignments_log")
	return state
}

func (f *leadUpdateDestinationFixture) expectDestination(t *testing.T, id, pipeline, stage string) {
	t.Helper()
	var actualPipeline, actualStage string
	if err := f.conn.QueryRow(f.ctx, `select coalesce(pipeline_id::text,''),coalesce(stage_id::text,'') from public.leads where id=$1`, id).Scan(&actualPipeline, &actualStage); err != nil || actualPipeline != pipeline || actualStage != stage {
		t.Fatalf("destination=%s/%s want=%s/%s error=%v", actualPipeline, actualStage, pipeline, stage, err)
	}
}

func TestLeadUpdateDestinationLocalPostgres(t *testing.T) {
	f := newLeadUpdateDestinationFixture(t)
	t.Run("null stage retaining selected pipeline rejects before effects and preserves CAS", func(t *testing.T) {
		id, revision := f.seed(t, 720)
		before := f.state(t, id)
		input := updateInput{ExpectedUpdatedAt: &revision, StageID: patchString{Set: true}, Feedback: patchString{Set: true, Value: stringPointer("Should not be written")}}
		if _, err := f.repo.Update(f.ctx, f.actor, id, input); !errors.Is(err, distribution.ErrIntakeDestinationUnavailable) {
			t.Fatalf("null stage was accepted: %v", err)
		}
		input.ExpectedUpdatedAt = timePointer(revision.Add(-time.Microsecond))
		if _, err := f.repo.Update(f.ctx, f.actor, id, input); !errors.Is(err, ErrLeadChanged) {
			t.Fatalf("CAS must precede destination precheck: %v", err)
		}
		if after := f.state(t, id); after != before {
			t.Fatalf("rejected patch changed stored lead or effects: before=%+v after=%+v", before, after)
		}
	})
	t.Run("explicit clear both and pipeline only preserve intentional no funnel", func(t *testing.T) {
		for index, input := range []updateInput{{PipelineID: patchString{Set: true}, StageID: patchString{Set: true}}, {PipelineID: patchString{Set: true}}} {
			id, revision := f.seed(t, 721+index)
			input.ExpectedUpdatedAt = &revision
			if _, err := f.repo.Update(f.ctx, f.actor, id, input); err != nil {
				t.Fatal(err)
			}
			f.expectDestination(t, id, "", "")
			if _, err := f.repo.Update(f.ctx, f.actor, id, updateInput{StageID: patchString{Set: true}}); err != nil {
				t.Fatalf("null stage on unscoped lead: %v", err)
			}
			f.expectDestination(t, id, "", "")
		}
	})
	t.Run("valid stage move commits a visible destination", func(t *testing.T) {
		id, revision := f.seed(t, 723)
		if _, err := f.repo.Update(f.ctx, f.actor, id, updateInput{ExpectedUpdatedAt: &revision, StageID: patchString{Set: true, Value: &f.otherStage}}); err != nil {
			t.Fatal(err)
		}
		f.expectDestination(t, id, f.otherPipeline, f.otherStage)
	})
	t.Run("foreign and mismatched requested references reject without effects", func(t *testing.T) {
		id, revision := f.seed(t, 724)
		before := f.state(t, id)
		for _, input := range []updateInput{{StageID: patchString{Set: true, Value: &f.foreignStage}}, {PipelineID: patchString{Set: true, Value: &f.pipeline}, StageID: patchString{Set: true, Value: &f.otherStage}}} {
			input.ExpectedUpdatedAt = &revision
			if _, err := f.repo.Update(f.ctx, f.actor, id, input); !errors.Is(err, ErrInvalidReference) {
				t.Fatalf("foreign/mismatched request=%v", err)
			}
		}
		foreignActor := f.actor
		foreignActor.OrganizationID = pipelinePostgresID(99)
		if _, err := f.repo.Update(f.ctx, foreignActor, id, updateInput{StageID: patchString{Set: true}}); !errors.Is(err, ErrLeadNotFound) {
			t.Fatalf("foreign actor accessed lead destination: %v", err)
		}
		if after := f.state(t, id); after != before {
			t.Fatal("rejected foreign/mismatched patch changed stored state")
		}
	})
	t.Run("unrelated profile edit preserves legacy orphan", func(t *testing.T) {
		id, _ := f.seed(t, 725)
		f.exec(t, `update public.leads set stage_id=null where id=$1`, id)
		revision := f.revision(t, id)
		if _, err := f.repo.Update(f.ctx, f.actor, id, updateInput{ExpectedUpdatedAt: &revision, Name: patchString{Set: true, Value: stringPointer("Updated legacy name")}}); err != nil {
			t.Fatal(err)
		}
		f.expectDestination(t, id, f.pipeline, "")
	})
	t.Run("effective trigger destinations are validated before commit with rollback", func(t *testing.T) {
		for index, scenario := range []struct{ name, pipeline, stage, inactive string }{
			{"missing stage", f.otherPipeline, "", ""},
			{"missing parent", "", f.otherStage, ""},
			{"foreign destination", f.foreignPipeline, f.foreignStage, ""},
			{"mismatched parent", f.pipeline, f.otherStage, ""},
			{"inactive parent", f.otherPipeline, f.otherStage, "pipelines"},
			{"inactive stage", f.otherPipeline, f.otherStage, "stages"},
			{"nonexistent stage", f.otherPipeline, pipelinePostgresID(799), ""},
		} {
			t.Run(scenario.name, func(t *testing.T) {
				id, revision := f.seed(t, 730+index)
				if scenario.inactive != "" {
					target := f.otherPipeline
					if scenario.inactive == "stages" {
						target = f.otherStage
					}
					f.exec(t, "update public."+scenario.inactive+" set is_active=false where id=$1", target)
					defer f.exec(t, "update public."+scenario.inactive+" set is_active=true where id=$1", target)
				}
				before := f.state(t, id)
				input := updateInput{ExpectedUpdatedAt: &revision, PipelineID: patchString{Set: true}, Feedback: patchString{Set: true, Value: stringPointer("Synthetic feedback")}, MetadataSet: true, Metadata: map[string]any{"_fixture_target": map[string]any{"pipeline": scenario.pipeline, "stage": scenario.stage}}}
				if _, err := f.repo.Update(f.ctx, f.actor, id, input); !errors.Is(err, distribution.ErrIntakeDestinationUnavailable) {
					t.Fatalf("invalid trigger destination committed: %v", err)
				}
				if after := f.state(t, id); after != before {
					t.Fatalf("trigger rejection did not roll back lead/audit/activity/notification/history: before=%+v after=%+v", before, after)
				}
			})
		}
	})
}
