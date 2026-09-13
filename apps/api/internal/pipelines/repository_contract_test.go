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
		"select pipeline_id::text",
		"repo.ensurePipeline(ctx, tx, organizationID, pipelineID)",
		"and pipeline_id = $3::uuid",
		"for update",
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
		"coalesce(is_qualified, false)",
		"coalesce(is_active, true)",
		"nextIsWon := input.IsWon.Resolve(isWon)",
		"nextIsLost := input.IsLost.Resolve(isLost)",
		"nextIsQualified := qualifiedPatch.Resolve(isQualified)",
		"nextIsActive := input.IsActive.Resolve(isActive)",
		"if nextIsWon && nextIsLost",
		"if isActive && !nextIsActive",
		"and stage_id = $2::uuid",
		"return ErrHasLeads",
		"ErrInvalidInput",
	} {
		if !strings.Contains(eligibilitySource, contract) {
			t.Fatalf("qualified-stage eligibility must contain %q", contract)
		}
	}
}

func TestPipelineAndStageMutationsUseLocksAndAtomicDeleteGuards(t *testing.T) {
	source, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatalf("read repository.go: %v", err)
	}
	repositorySource := string(source)

	for _, contract := range []string{
		"func (repo Repository) lockOrganizationForPipelineMutation",
		"from public.organizations",
		"func (repo Repository) ensurePipeline",
		"from public.pipelines",
		"for update",
		"and not exists (",
		"left join public.stages lead_stage",
		"isForeignKeyViolation(err)",
	} {
		if !strings.Contains(repositorySource, contract) {
			t.Fatalf("mutation locking/delete contract must contain %q", contract)
		}
	}

	reorderStart := strings.Index(repositorySource, "func (repo Repository) ReorderStages")
	reorderEnd := strings.Index(repositorySource[reorderStart:], "func (repo Repository) DeleteStage")
	if reorderStart < 0 || reorderEnd < 0 {
		t.Fatal("could not isolate ReorderStages")
	}
	reorderSource := repositorySource[reorderStart : reorderStart+reorderEnd]
	for _, contract := range []string{
		"repo.ensurePipeline(ctx, tx",
		"order by coalesce(position, 0), created_at, id",
		"for update",
		"set position = position + $3",
		"if tag.RowsAffected() != 1",
	} {
		if !strings.Contains(reorderSource, contract) {
			t.Fatalf("reorder serialization contract must contain %q", contract)
		}
	}
}

func TestFirstPipelineAndDefaultDeletionKeepDefaultInvariant(t *testing.T) {
	source, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatalf("read repository.go: %v", err)
	}
	repositorySource := string(source)
	for _, contract := range []string{
		"if pipelineCount == 0",
		"input.IsDefault = true",
		"set another pipeline as default before unsetting the current default",
		"with replacement as (",
		"set is_default = true",
	} {
		if !strings.Contains(repositorySource, contract) {
			t.Fatalf("default pipeline invariant must contain %q", contract)
		}
	}
}
