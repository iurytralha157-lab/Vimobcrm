package pipelines

import (
	"os"
	"strings"
	"testing"
)

func TestPipelineDefaultRoundRobinUsesCanonicalColumn(t *testing.T) {
	source, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatalf("read repository.go: %v", err)
	}
	repositorySource := string(source)

	if got := strings.Count(repositorySource, "p.default_round_robin_id::text"); got != 2 {
		t.Fatalf(
			"pipeline List/Get canonical default column references = %d, want 2",
			got,
		)
	}

	start := strings.Index(repositorySource, "func (repo Repository) SetDefaultRoundRobin")
	if start < 0 {
		t.Fatal("could not find SetDefaultRoundRobin source")
	}
	end := strings.Index(repositorySource[start:], "func (repo Repository) createDefaultStages")
	if end < 0 {
		t.Fatal("could not isolate SetDefaultRoundRobin source")
	}
	functionSource := repositorySource[start : start+end]

	if !strings.Contains(functionSource, "update public.pipelines") ||
		!strings.Contains(functionSource, "default_round_robin_id") {
		t.Fatal("SetDefaultRoundRobin must write pipelines.default_round_robin_id")
	}
	if strings.Contains(functionSource, "update public.round_robins") {
		t.Fatal("setting a pipeline fallback must not rewrite queue routing scope")
	}
}

func TestUpdateStageSerializesQualifiedMarkerPerPipeline(t *testing.T) {
	source, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatalf("read repository.go: %v", err)
	}
	repositorySource := string(source)

	start := strings.Index(repositorySource, "func (repo Repository) UpdateStage")
	if start < 0 {
		t.Fatal("could not find UpdateStage source")
	}
	end := strings.Index(repositorySource[start:], "func (repo Repository) ReorderStages")
	if end < 0 {
		t.Fatal("could not isolate UpdateStage source")
	}
	functionSource := repositorySource[start : start+end]

	orderedSteps := []string{
		"repo.db.Pool().Begin(ctx)",
		"repo.lockStagePipelineForUpdate(",
		"repo.ensureStageCanBeQualified(",
		"set is_qualified = false",
		"update public.stages as s",
		"tx.Commit(ctx)",
	}
	previous := -1
	for _, step := range orderedSteps {
		position := strings.Index(functionSource, step)
		if position < 0 {
			t.Fatalf("UpdateStage must contain %q", step)
		}
		if position <= previous {
			t.Fatalf("UpdateStage step %q is out of transactional order", step)
		}
		previous = position
	}

	for _, scope := range []string{
		"where organization_id = $1::uuid",
		"and pipeline_id = $2::uuid",
		"and id <> $3::uuid",
		"and is_qualified is true",
	} {
		if !strings.Contains(functionSource, scope) {
			t.Fatalf("qualified-stage reset must contain %q", scope)
		}
	}
	for _, normalization := range []string{
		"qualifiedPatchForStageUpdate(input)",
		"addBool(\"is_qualified\", qualifiedPatch)",
	} {
		if !strings.Contains(functionSource, normalization) {
			t.Fatalf("terminal or inactive updates must contain %q", normalization)
		}
	}

	lockStart := strings.Index(repositorySource, "func (repo Repository) lockStagePipelineForUpdate")
	if lockStart < 0 {
		t.Fatal("could not find lockStagePipelineForUpdate source")
	}
	lockEnd := strings.Index(repositorySource[lockStart:], "func (repo Repository) uniqueStageKey")
	if lockEnd < 0 {
		t.Fatal("could not isolate lockStagePipelineForUpdate source")
	}
	lockSource := repositorySource[lockStart : lockStart+lockEnd]
	for _, contract := range []string{
		"join public.stages as s",
		"where p.organization_id = $1::uuid",
		"and s.organization_id = $1::uuid",
		"and s.id = $2::uuid",
		"for update of p",
	} {
		if !strings.Contains(lockSource, contract) {
			t.Fatalf("qualified-stage pipeline lock must contain %q", contract)
		}
	}

	eligibilityStart := strings.Index(repositorySource, "func (repo Repository) ensureStageCanBeQualified")
	if eligibilityStart < 0 {
		t.Fatal("could not find ensureStageCanBeQualified source")
	}
	eligibilityEnd := strings.Index(repositorySource[eligibilityStart:], "func (repo Repository) uniqueStageKey")
	if eligibilityEnd < 0 {
		t.Fatal("could not isolate ensureStageCanBeQualified source")
	}
	eligibilitySource := repositorySource[eligibilityStart : eligibilityStart+eligibilityEnd]
	for _, contract := range []string{
		"coalesce(is_won, false)",
		"coalesce(is_lost, false)",
		"coalesce(is_active, true)",
		"input.IsWon.Resolve(isWon)",
		"input.IsLost.Resolve(isLost)",
		"!input.IsActive.Resolve(isActive)",
		"ErrInvalidInput",
	} {
		if !strings.Contains(eligibilitySource, contract) {
			t.Fatalf("qualified-stage eligibility must contain %q", contract)
		}
	}
}
