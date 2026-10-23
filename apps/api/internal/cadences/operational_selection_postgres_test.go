package cadences

import (
	"context"
	"errors"
	"testing"
	"time"
)

func TestOperationalCadenceSelectionLocalPostgres(t *testing.T) {
	f := openOperationalSelectionFixture(t)
	reset := func() {
		f.exec(`truncate public.cadence_tasks_template,public.cadence_templates;update public.stage_operational_configs set config='{}'`)
	}
	t.Run("legacy active populated fallback beats inactive or empty", func(t *testing.T) {
		f.t = t
		reset()
		f.template(301, 1, 201, 101, false, true, "Paused stage")
		f.template(302, 1, 0, 101, true, false, "")
		f.template(303, 1, 0, 0, true, true, "Runnable global")
		f.template(304, 2, 0, 0, true, true, "Foreign")
		rules := f.rules()
		if len(rules.Cadence.Tasks) != 1 || rules.Cadence.Tasks[0].Title != "Runnable global" || rules.Cadence.TemplateID != nil || rules.Cadence.Tasks[0].ID != nil {
			t.Fatalf("selection=%+v", rules.Cadence)
		}
	})
	t.Run("active scope priority stays stage pipeline global", func(t *testing.T) {
		f.t = t
		reset()
		f.template(301, 1, 201, 101, true, true, "Stage")
		f.template(302, 1, 0, 101, true, true, "Pipeline")
		f.template(303, 1, 0, 0, true, true, "Global")
		if rules := f.rules(); rules.Cadence.Tasks[0].Title != "Stage" {
			t.Fatalf("stage priority=%+v", rules.Cadence)
		}
		f.exec(`update public.cadence_templates set is_active=false where id=$1`, operationalSelectionID(301))
		if rules := f.rules(); rules.Cadence.Tasks[0].Title != "Pipeline" {
			t.Fatalf("pipeline priority=%+v", rules.Cadence)
		}
	})
	t.Run("paused dedicated own template and task identities preserved", func(t *testing.T) {
		f.t = t
		reset()
		f.template(301, 1, 201, 101, false, true, "Owned paused")
		f.template(302, 1, 201, 101, true, true, "Competitor")
		f.exec(`update public.stage_operational_configs set config=jsonb_build_object('operational_rules_version',1,'cadence_template_id',$1::text)`, operationalSelectionID(301))
		rules := f.rules()
		if rules.Cadence.TemplateID == nil || *rules.Cadence.TemplateID != operationalSelectionID(301) || len(rules.Cadence.Tasks) != 1 || rules.Cadence.Tasks[0].Title != "Owned paused" || rules.Cadence.Tasks[0].ID == nil {
			t.Fatalf("owned paused=%+v", rules.Cadence)
		}
		f.exec(`truncate public.cadence_tasks_template`)
		rules = f.rules()
		if rules.Cadence.TemplateID == nil || *rules.Cadence.TemplateID != operationalSelectionID(301) || len(rules.Cadence.Tasks) != 0 {
			t.Fatalf("owned empty=%+v", rules.Cadence)
		}
	})
	for _, scenario := range []struct {
		name    string
		pointer any
	}{
		{"missing", nil}, {"empty", ""}, {"invalid", "bad"}, {"absent", operationalSelectionID(399)},
		{"foreign organization", operationalSelectionID(304)}, {"other stage", operationalSelectionID(305)}, {"global pointer", operationalSelectionID(303)},
	} {
		t.Run("version one has no fallback/"+scenario.name, func(t *testing.T) {
			f.t = t
			reset()
			f.template(301, 1, 201, 101, true, true, "Stage")
			f.template(303, 1, 0, 0, true, true, "Global")
			f.template(304, 2, 201, 101, true, true, "Foreign")
			f.template(305, 1, 211, 101, true, true, "Wrong stage")
			f.exec(`update public.stage_operational_configs set config=jsonb_build_object('operational_rules_version',1,'cadence_template_id',$1::text)`, scenario.pointer)
			rules := f.rules()
			if rules.Cadence.TemplateID != nil || len(rules.Cadence.Tasks) != 0 {
				t.Fatalf("invalid v1 pointer fell back: %+v", rules.Cadence)
			}
		})
	}
	t.Run("legacy pointer to inherited template does not become owned", func(t *testing.T) {
		f.t = t
		reset()
		f.template(303, 1, 0, 0, true, true, "Global")
		f.exec(`update public.stage_operational_configs set config=jsonb_build_object('cadence_template_id',$1::text)`, operationalSelectionID(303))
		rules := f.rules()
		if rules.Cadence.TemplateID != nil || len(rules.Cadence.Tasks) != 1 || rules.Cadence.Tasks[0].ID != nil {
			t.Fatalf("inherited identities leaked into dedicated editor: %+v", rules.Cadence)
		}
	})
}

func TestOperationalCadenceParentFirstLockLocalPostgres(t *testing.T) {
	f := openOperationalSelectionFixture(t)
	for _, move := range []bool{false, true} {
		t.Run(map[bool]string{false: "no stage to parent deadlock", true: "revalidate moved stage"}[move], func(t *testing.T) {
			parent, err := f.conn.Begin(f.ctx)
			if err != nil {
				t.Fatal(err)
			}
			defer parent.Rollback(f.ctx)
			if _, err := parent.Exec(f.ctx, `select id from public.pipelines where id=$1 for update`, operationalSelectionID(101)); err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(f.ctx, 5*time.Second)
			defer cancel()
			out := make(chan error, 1)
			go func() {
				tx, err := f.db.Pool().Begin(ctx)
				if err != nil {
					out <- err
					return
				}
				defer tx.Rollback(ctx)
				_, err = f.repo.lockOperationalStageParentFirst(ctx, tx, operationalSelectionID(1), operationalSelectionID(201))
				out <- err
			}()
			for {
				var waiting bool
				if _, err := parent.Exec(ctx, `select pg_stat_clear_snapshot()`); err != nil {
					t.Fatal(err)
				}
				if err := parent.QueryRow(ctx, `select exists(select 1 from pg_stat_activity where datname=current_database() and pid<>pg_backend_pid() and wait_event_type='Lock' and query like '%for key share%')`).Scan(&waiting); err != nil {
					t.Fatal(err)
				}
				if waiting {
					break
				}
				select {
				case err := <-out:
					t.Fatalf("cadence helper did not wait for parent: %v", err)
				default:
				}
			}
			// NOWAIT proves the waiter did not take the stage before its parent.
			if _, err := parent.Exec(ctx, `select id from public.stages where id=$1 for update nowait`, operationalSelectionID(201)); err != nil {
				t.Fatalf("stage/parent lock inversion: %v", err)
			}
			if move {
				if _, err := parent.Exec(ctx, `update public.stages set pipeline_id=$1 where id=$2`, operationalSelectionID(102), operationalSelectionID(201)); err != nil {
					t.Fatal(err)
				}
			}
			if err := parent.Commit(ctx); err != nil {
				t.Fatal(err)
			}
			err = <-out
			if move {
				if !errors.Is(err, ErrOperationalRulesConflict) {
					t.Fatalf("moved stage=%v", err)
				}
			} else if err != nil {
				t.Fatal(err)
			}
		})
	}
}
