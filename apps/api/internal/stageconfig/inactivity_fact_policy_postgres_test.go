package stageconfig

import (
	"context"
	"strings"
	"testing"
	"time"
)

func prepareInactivityFactPolicyFixture(f inactivityPostgresFixture, mutation string, values ...int) {
	f.t.Helper()
	f.seed(true, InactivityClockLastInteraction, InactivityIncludeOverdue)
	f.exec(`truncate public.leads cascade`)
	arguments := make([]any, len(values))
	for index, value := range values {
		arguments[index] = inactivityFixtureID(value)
	}
	if mutation != "" {
		f.exec(mutation, arguments...)
	}
	f.exec(`insert into public.leads(id,organization_id,stage_id,pipeline_id,stage_entered_at,created_at,assigned_user_id)
 values($1,$2,$3,$4,now()-interval '10 days',now()-interval '12 days',$5)`, inactivityFixtureID(501), inactivityFixtureID(1), inactivityFixtureID(201), inactivityFixtureID(101), inactivityFixtureID(401))
}

func assertInactivityFactPolicyCounts(f inactivityPostgresFixture, facts, scopes, jobs int) {
	f.t.Helper()
	for _, expected := range []struct {
		table string
		count int
	}{
		{"public.lead_action_facts", facts},
		{"private.stage_inactivity_lead_scopes", scopes},
		{"private.stage_inactivity_jobs", jobs},
	} {
		if actual := f.count(`select count(*) from ` + expected.table); actual != expected.count {
			f.t.Fatalf("%s count = %d, want %d", expected.table, actual, expected.count)
		}
	}
}

// Exercise the actual predecessor before installing the forward migration.
// The existing on-enter regression assertion remains unchanged in the suite.
func TestStageInactivityFactPolicyPredecessorLocalPostgres(t *testing.T) {
	f := openInactivityPostgresFixtureAtFactPolicyGate(t, false)
	prepareInactivityFactPolicyFixture(f, `update public.stage_automations set trigger_type='on_enter'`)
	f.fact(1, 501, 1, false, false, "1 minute")
	f.cycle()
	assertInactivityFactPolicyCounts(f, 1, 0, 0)
	installInactivityFactPolicyGate(f)
	f.fact(1, 501, 2, false, false, "1 minute")
	f.cycle()
	assertInactivityFactPolicyCounts(f, 1, 0, 0)
	if f.count(`select count(*) from public.lead_action_facts where source_id='1'`) != 1 ||
		f.count(`select count(*) from public.lead_action_facts where source_id='2'`) != 0 {
		t.Fatal("forward migration must reject new orphan-policy facts without deleting historical facts")
	}
}

func TestStageInactivityFactPolicyIdentityLocalPostgres(t *testing.T) {
	f := openInactivityPostgresFixture(t)
	for _, scenario := range []struct {
		name     string
		mutation string
		values   []int
	}{
		{"on-enter policy orphan", `update public.stage_automations set trigger_type='on_enter'`, nil},
		{"stale automation revision by one microsecond", `update public.stage_automations set updated_at=updated_at+interval '1 microsecond'`, nil},
		{"policy points to another tenant automation", `update private.stage_inactivity_policies set automation_id=$1::uuid`, []int{302}},
		{"automation tenant differs from policy", `update public.stage_automations set organization_id=$1::uuid where id=$2::uuid`, []int{2, 301}},
		{"automation stage differs from policy", `update public.stage_automations set stage_id=$1::uuid where id=$2::uuid`, []int{202, 301}},
		{"policy tenant differs from lead", `update private.stage_inactivity_policies set organization_id=$1::uuid`, []int{2}},
		{"policy stage differs from lead", `update private.stage_inactivity_policies set stage_id=$1::uuid`, []int{202}},
		{"automation has no explicit policy", `delete from private.stage_inactivity_policies`, nil},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			f.t = t
			f.reset()
			prepareInactivityFactPolicyFixture(f, scenario.mutation, scenario.values...)
			f.fact(1, 501, 1, false, false, "1 minute")
			f.fact(2, 501, 2, false, false, "1 minute")
			f.cycle()
			assertInactivityFactPolicyCounts(f, 0, 0, 0)
			if f.count(`select count(*) from public.notifications`) != 0 {
				t.Fatal("invalid policy identity created a notification")
			}
		})
	}
}

func TestStageInactivityFactPolicyPausedCoverageLocalPostgres(t *testing.T) {
	f := openInactivityPostgresFixture(t)
	for _, scenario := range []struct {
		name     string
		mutation string
	}{
		{"policy disabled", `update private.stage_inactivity_policies set is_enabled=false`},
		{"automation inactive", `update public.stage_automations set is_active=false`},
		{"both paused", `update private.stage_inactivity_policies set is_enabled=false; update public.stage_automations set is_active=false`},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			f.t = t
			f.reset()
			prepareInactivityFactPolicyFixture(f, scenario.mutation)
			f.fact(1, 501, 1, false, false, "1 minute")
			f.fact(1, 501, 2, true, false, "30 seconds")
			f.fact(1, 501, 3, false, true, "10 seconds")
			f.cycle()
			assertInactivityFactPolicyCounts(f, 3, 0, 0)
			if f.count(`select count(*) from public.lead_action_facts where source_id='2' and is_inbound=true and is_automated=false and qualifies_stage_inactivity=true`) != 1 ||
				f.count(`select count(*) from public.lead_action_facts where source_id='3' and is_automated=true`) != 1 {
				t.Fatal("pausing changed interaction classification")
			}
			// Preserve the exact source revision during the pause. A dedicated
			// writer synchronizes its new revision atomically when activating.
			f.exec(`update public.stage_automations set is_active=true,updated_at=greatest(clock_timestamp(),updated_at+interval '1 microsecond');
 update private.stage_inactivity_policies policy set is_enabled=true,revision=revision+1,activation_epoch=gen_random_uuid(),activated_at=now(),next_scan_at=now(),automation_updated_at=automation.updated_at
 from public.stage_automations automation where automation.id=policy.automation_id`)
			if result := f.cycle(); result.Notified != 0 {
				t.Fatalf("retained paused-period human interaction was ignored: %#v", result)
			}
			assertInactivityFactPolicyCounts(f, 3, 1, 1)
			if f.count(`select count(*) from private.stage_inactivity_jobs job
 join public.lead_action_facts fact on fact.organization_id=job.organization_id and fact.lead_id=job.lead_id and fact.source_id='2'
 where job.baseline_at=fact.occurred_at and job.due_at=fact.occurred_at+interval '1 day' and job.status='pending'`) != 1 {
				t.Fatal("activation must use the retained qualifying human reply, excluding automated work")
			}
		})
	}
}

func TestStageInactivityFactPolicyPreservesOtherDomainsLocalPostgres(t *testing.T) {
	f := openInactivityPostgresFixture(t)
	for _, scenario := range []struct {
		name  string
		setup string
		facts int
	}{
		{"legacy attention eligibility", `update public.leads set attention_eligible=true`, 1},
		{"legacy attention eligibility for closed lead", `update public.leads set attention_eligible=true,deal_status='won'`, 1},
		{"cadence enabled", `insert into public.stage_operational_configs(organization_id,stage_id,config,cadence_enabled) values($1,$2,'{"operational_rules_version":"1"}',true)`, 1},
		{"local shadow attention", `insert into public.stage_operational_configs(organization_id,stage_id,config,attention_mode) values($1,$2,'{"operational_rules_version":"1","attention_source_mode":"local"}','shadow')`, 1},
		{"local enabled attention", `insert into public.stage_operational_configs(organization_id,stage_id,config,attention_mode) values($1,$2,'{"operational_rules_version":"1","attention_source_mode":"local"}','enabled')`, 1},
		{"cadence without current operational version", `insert into public.stage_operational_configs(organization_id,stage_id,cadence_enabled) values($1,$2,true)`, 0},
		{"inherited attention does not expand coverage", `insert into public.stage_operational_configs(organization_id,stage_id,config,attention_mode) values($1,$2,'{"operational_rules_version":"1","attention_source_mode":"inherit"}','shadow')`, 0},
		{"disabled local attention", `insert into public.stage_operational_configs(organization_id,stage_id,config,attention_mode) values($1,$2,'{"operational_rules_version":"1","attention_source_mode":"local"}','disabled')`, 0},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			f.t = t
			f.reset()
			prepareInactivityFactPolicyFixture(f, `update public.stage_automations set trigger_type='on_enter'`)
			if strings.HasPrefix(scenario.setup, "insert") {
				f.exec(scenario.setup, inactivityFixtureID(1), inactivityFixtureID(201))
			} else {
				f.exec(scenario.setup)
			}
			f.fact(1, 501, 1, true, false, "1 minute")
			f.cycle()
			assertInactivityFactPolicyCounts(f, scenario.facts, 0, 0)
			if scenario.facts == 1 && f.count(`select count(*) from public.lead_action_facts where is_inbound=true and is_automated=false and qualifies_first_outreach=false and qualifies_stage_inactivity=true and is_effective_contact=false`) != 1 {
				t.Fatal("inactivity validation changed another domain's canonical fact classification")
			}
		})
	}
}

func TestStageInactivityFactPolicyReadsCommittedConfigurationLocalPostgres(t *testing.T) {
	f := openInactivityPostgresFixture(t)
	prepareInactivityFactPolicyFixture(f, "")
	editing, err := f.db.Pool().Begin(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer rollbackInactivityTransaction(editing)
	if _, err := editing.Exec(f.ctx, `update public.stage_automations set trigger_type='on_enter',updated_at=updated_at+interval '1 microsecond' where id=$1::uuid`, inactivityFixtureID(301)); err != nil {
		t.Fatal(err)
	}
	// The pending edit must not discard a legitimate interaction or acquire
	// automation locks in the opposite order from the worker's parent locks.
	interactionCtx, cancel := context.WithTimeout(f.ctx, 5*time.Second)
	defer cancel()
	interacting := f
	interacting.ctx = interactionCtx
	interacting.fact(1, 501, 1, false, false, "1 minute")
	if f.count(`select count(*) from public.lead_action_facts`) != 1 {
		t.Fatal("an uncommitted reclassification lost a valid interaction")
	}
	if err := editing.Commit(f.ctx); err != nil {
		t.Fatal(err)
	}
	f.fact(1, 501, 2, false, false, "30 seconds")
	if f.count(`select count(*) from public.lead_action_facts where source_id='2'`) != 0 {
		t.Fatal("a committed reclassification continued capturing through an orphan policy")
	}
}

func TestStageInactivityFactPolicyFunctionPrivilegesLocalPostgres(t *testing.T) {
	f := openInactivityPostgresFixture(t)
	const signature = "private.record_lead_action_fact(uuid,uuid,uuid,text,text,timestamp with time zone,boolean,boolean,boolean,boolean,boolean,text,text,jsonb)"
	for _, role := range []string{"anon", "authenticated", "service_role"} {
		want := 0
		if role == "service_role" {
			want = 1
		}
		if actual := f.count(`select count(*) where has_function_privilege($1,$2,'execute')`, role, signature); actual != want {
			t.Fatalf("function execute privilege for %s = %d, want %d", role, actual, want)
		}
	}
}
