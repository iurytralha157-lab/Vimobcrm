package pipelines

import (
	"encoding/json"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestStageKeyContractLocalPostgres(t *testing.T) {
	f := openPipelineRevisionFixture(t)
	f.exec(`alter table public.cadence_templates add column stage_key text;
 alter table public.stages add constraint synthetic_key_rollback check (name <> 'Reject after first')`)
	pipeline, first, second, archived := stageArchiveFixtureID(101), stageArchiveFixtureID(201), stageArchiveFixtureID(202), stageArchiveFixtureID(204)
	reset := func(t *testing.T) {
		f.t = t
		f.exec(`delete from public.stages where id not in ($1,$2,$3,$4,$5,$6)`, first, second, stageArchiveFixtureID(203), archived, stageArchiveFixtureID(205), stageArchiveFixtureID(211))
		f.reset()
		f.exec(`update public.stages set stage_key='original_'||id::text`)
	}
	request := func(preserve bool) ReorderStagesRequest {
		return ReorderStagesRequest{PreserveStageKeys: preserve, Stages: []StageOrderItem{
			{ID: first, Name: "Renamed first", Color: "#123456", ExpectedUpdatedAt: &f.base},
			{ID: second, Name: "Renamed second", Color: "#123456", ExpectedUpdatedAt: &f.base},
		}}
	}
	save := func(t *testing.T, request ReorderStagesRequest) ([]Stage, error) {
		t.Helper()
		input, err := request.Validate()
		if err != nil {
			return nil, err
		}
		return f.repo.ReorderStages(f.ctx, f.actor, pipeline, input)
	}
	key := func(t *testing.T, id string) string {
		t.Helper()
		var value string
		if err := f.conn.QueryRow(f.ctx, `select stage_key from public.stages where id=$1`, id).Scan(&value); err != nil {
			t.Fatal(err)
		}
		return value
	}
	state := func(t *testing.T) string {
		t.Helper()
		var value string
		if err := f.conn.QueryRow(f.ctx, `select jsonb_agg(to_jsonb(s) order by s.id)::text from public.stages s`).Scan(&value); err != nil {
			t.Fatal(err)
		}
		return value
	}

	t.Run("direct creation bounds every legal long name and ignores foreign aliases", func(t *testing.T) {
		reset(t)
		f.exec(`update public.stages set stage_key=$2 where id=$1`, stageArchiveFixtureID(211), strings.Repeat("a", 80))
		for _, length := range []int{2, 79, 80, 81, 120} {
			name := strings.Repeat("a", length)
			stage, err := f.repo.CreateStage(f.ctx, f.actor, pipeline, createStageInput{Name: name, Color: "#123456"})
			if err != nil || stage.Name != name || stage.StageKey == "" || len(stage.StageKey) > 80 || stage.OrganizationID != f.actor.OrganizationID {
				t.Fatalf("direct creation changed name or exceeded key contract: nameLength=%d stage=%+v err=%v", length, stage, err)
			}
			if length == 80 && stage.StageKey != name {
				t.Fatal("another organization's alias influenced this pipeline")
			}
		}
	})

	t.Run("direct creation and new reorder rows include archived aliases", func(t *testing.T) {
		reset(t)
		base := strings.Repeat("a", 80)
		f.exec(`update public.stages set stage_key=$2 where id=$1`, archived, base)
		created, err := f.repo.CreateStage(f.ctx, f.actor, pipeline, createStageInput{Name: strings.Repeat("a", 120), Color: "#123456"})
		if err != nil || created.StageKey != strings.Repeat("a", 78)+"_2" {
			t.Fatalf("direct create reused archived alias or exceeded length: %+v %v", created, err)
		}
		// Return to the baseline before exercising the complete-set reorder CAS.
		reset(t)
		f.exec(`update public.stages set stage_key=$2 where id=$1`, archived, base)
		input := request(true)
		for _, id := range []int{901, 902} {
			input.Stages = append(input.Stages, StageOrderItem{ID: stageArchiveFixtureID(id), Name: strings.Repeat("a", 120), Color: "#123456", IsNew: true})
		}
		if _, err := save(t, input); err != nil {
			t.Fatal(err)
		}
		if key(t, stageArchiveFixtureID(901)) != strings.Repeat("a", 78)+"_2" || key(t, stageArchiveFixtureID(902)) != strings.Repeat("a", 78)+"_3" || key(t, archived) != base {
			t.Fatal("new reorder rows reused archived/in-batch aliases or rewrote the archive")
		}
	})

	t.Run("actual new HTTP contract renames and reorders legacy identities without rewriting aliases", func(t *testing.T) {
		reset(t)
		legacyA, legacyB, legacyArchive := strings.Repeat("x", 81), strings.Repeat("y", 120), strings.Repeat("z", 120)
		f.exec(`update public.stages set stage_key=case id when $1 then $4 when $2 then $5 else $6 end where pipeline_id=$3;
 insert into public.cadence_templates(id,organization_id,stage_id,stage_key,pipeline_id) values($7,$8,$1,$4,$3),($9,$8,$2,$5,$3)`, first, second, pipeline, legacyA, legacyB, legacyArchive, stageArchiveFixtureID(701), f.actor.OrganizationID, stageArchiveFixtureID(702))
		body := request(true)
		body.Stages[0], body.Stages[1] = body.Stages[1], body.Stages[0]
		payload, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		req := httptest.NewRequest("POST", "/", strings.NewReader(string(payload)))
		req.SetPathValue("id", pipeline)
		req = req.WithContext(tenant.ContextWithTenant(req.Context(), f.actor))
		response := httptest.NewRecorder()
		NewHandler(f.repo).ReorderStages(response, req)
		if response.Code != 200 || key(t, first) != legacyA || key(t, second) != legacyB || key(t, archived) != legacyArchive {
			t.Fatalf("new HTTP save changed persisted aliases: %d %s", response.Code, response.Body.String())
		}
		if f.count(`select count(*) from public.cadence_templates template join public.stages stage on stage.id=template.stage_id where template.stage_key=stage.stage_key and template.pipeline_id=$1`, pipeline) != 2 || f.count(`select count(*) from public.stages where id=$1 and position=0 and name='Renamed second'`, second) != 1 {
			t.Fatal("legacy cadence alias identity or requested order/name was lost")
		}
	})

	t.Run("flag true protects every existing alias even from an explicit replacement", func(t *testing.T) {
		reset(t)
		legacy := strings.Repeat("l", 120)
		f.exec(`update public.stages set stage_key=$2 where id=$1`, first, legacy)
		input := request(true)
		input.Stages[0].StageKey = "must_not_replace"
		if _, err := save(t, input); err != nil || key(t, first) != legacy {
			t.Fatalf("preservation flag allowed explicit key replacement: %v", err)
		}
	})

	t.Run("legacy explicit updates remain accepted and omitted aliases are preserved", func(t *testing.T) {
		reset(t)
		previous := key(t, second)
		input := request(false)
		input.Stages[0].StageKey = "legacy_explicit_update"
		if _, err := save(t, input); err != nil || key(t, first) != "legacy_explicit_update" || key(t, second) != previous {
			t.Fatalf("legacy explicit/missing key compatibility failed: %v", err)
		}
	})

	t.Run("stale revision and a later write failure roll back keys positions and names", func(t *testing.T) {
		reset(t)
		f.exec(`update public.stages set stage_key=$2 where id=$1`, first, strings.Repeat("r", 81))
		before := state(t)
		input := request(true)
		stale := f.base.Add(-time.Microsecond)
		input.Stages[1].ExpectedUpdatedAt = &stale
		if _, err := save(t, input); !errors.Is(err, ErrStagesChanged) || state(t) != before {
			t.Fatalf("stale request changed the original stage set: %v", err)
		}
		input = request(true)
		input.Stages[1].Name = "Reject after first"
		if _, err := save(t, input); err == nil || state(t) != before {
			t.Fatalf("a later SQL failure partially persisted order/name/key changes: %v", err)
		}
	})
}
