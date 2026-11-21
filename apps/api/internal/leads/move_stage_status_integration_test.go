package leads

import (
	"errors"
	"testing"
	"time"
)

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
}
