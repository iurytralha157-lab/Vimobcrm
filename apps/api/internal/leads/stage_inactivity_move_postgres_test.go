package leads

import (
	"strings"
	"testing"
)

// The stage rule move goes through the canonical board move: the lead changes
// column, and the activity records that a stage rule (not a person) moved it.
func TestStageInactivityMoveLocalPostgres(t *testing.T) {
	f := newAutomationStageFixture(t)
	follow, other, ruleID := pipelinePostgresID(8), pipelinePostgresID(9), pipelinePostgresID(10)
	f.exec(t, `insert into public.stages(id,organization_id,pipeline_id,name,stage_key,is_won,is_lost) values($1,$2,$3,'Follow-up','follow',false,false)`, follow, f.org, f.pipeline)
	f.exec(t, `insert into public.pipelines(id,organization_id,name) values($1,$2,'Other pipeline')`, pipelinePostgresID(11), f.org)
	f.exec(t, `insert into public.stages(id,organization_id,pipeline_id,name,stage_key,is_won,is_lost) values($1,$2,$3,'Elsewhere','elsewhere',false,false)`, other, f.org, pipelinePostgresID(11))
	episode := strings.Repeat("a", 64)

	move := func(t *testing.T, input StageInactivityMove) StageInactivityMoveOutcome {
		t.Helper()
		tx, err := f.db.Pool().Begin(f.ctx)
		if err != nil {
			t.Fatal(err)
		}
		defer tx.Rollback(f.ctx)
		outcome, err := f.repo.MoveLeadForStageInactivity(f.ctx, tx, f.resolver, input)
		if err != nil {
			t.Fatalf("move: %v", err)
		}
		if err := tx.Commit(f.ctx); err != nil {
			t.Fatal(err)
		}
		return outcome
	}
	lead := func(t *testing.T, sequence int) string {
		t.Helper()
		id := pipelinePostgresID(sequence)
		f.exec(t, `insert into public.leads(id,organization_id,name,source,deal_status,pipeline_id,stage_id,assigned_user_id) values($1,$2,'Synthetic lead','manual','open',$3,$4,$5)`, id, f.org, f.pipeline, f.open, f.user)
		return id
	}
	input := func(leadID, target string) StageInactivityMove {
		return StageInactivityMove{OrganizationID: f.org, ActorID: f.user, LeadID: leadID, FromStageID: f.open, ToStageID: target, AutomationID: ruleID, EpisodeKey: episode}
	}

	t.Run("moves through the canonical board move", func(t *testing.T) {
		id := lead(t, 200)
		if outcome := move(t, input(id, follow)); outcome != StageInactivityMoved {
			t.Fatalf("outcome=%s", outcome)
		}
		if status, stage := f.status(t, id); status != "open" || stage != follow {
			t.Fatalf("lead is %s/%s", status, stage)
		}
		var origin, automated, rule string
		if err := f.conn.QueryRow(f.ctx, `select metadata->>'origin', metadata->>'is_automated', metadata->>'stage_automation_id'
			from public.activities where lead_id=$1 order by created_at desc limit 1`, id).Scan(&origin, &automated, &rule); err != nil {
			t.Fatal(err)
		}
		if origin != "stage_rule" || automated != "true" || rule != ruleID {
			t.Fatalf("activity provenance %s/%s/%s", origin, automated, rule)
		}
		if f.count(t, "public.audit_logs") == 0 {
			t.Fatal("move without audit log")
		}
		// Running the same episode again finds the lead elsewhere and does nothing.
		if outcome := move(t, input(id, follow)); outcome != StageInactivityLeadChanged {
			t.Fatalf("replay outcome=%s", outcome)
		}
	})
	t.Run("never crosses pipelines or enters terminal columns", func(t *testing.T) {
		for index, target := range []string{other, f.won, f.lost} {
			id := lead(t, 300+index)
			if outcome := move(t, input(id, target)); outcome != StageInactivityTargetInvalid {
				t.Fatalf("target %s outcome=%s", target, outcome)
			}
			if _, stage := f.status(t, id); stage != f.open {
				t.Fatalf("lead left the column for %s", target)
			}
		}
	})
	t.Run("stops when the rule owner loses access", func(t *testing.T) {
		id := lead(t, 400)
		f.exec(t, `update public.organization_modules set is_enabled=false where organization_id=$1 and module_name='automations'`, f.org)
		defer f.exec(t, `update public.organization_modules set is_enabled=true where organization_id=$1 and module_name='automations'`, f.org)
		if outcome := move(t, input(id, follow)); outcome != StageInactivityActorForbidden {
			t.Fatalf("outcome=%s", outcome)
		}
		if _, stage := f.status(t, id); stage != f.open {
			t.Fatal("forbidden actor moved the lead")
		}
	})
}
