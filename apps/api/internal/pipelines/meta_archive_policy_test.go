package pipelines

import (
	"context"
	"errors"
	"testing"
)

func TestArchiveUsesActualMetaRoutingPrecedence(t *testing.T) {
	for _, scenario := range []struct {
		name            string
		route           metaArchiveRoute
		stage, category string
	}{
		{"explicit form stage wins queue", metaArchiveRoute{QueueRequired: true, QueueAvailable: true, FormStage: "form-stage", QueueStage: "queue-stage", QueuePipeline: "queue-pipeline", FormPipeline: "form-pipeline", FormPipelineFirstStage: "form-first"}, "form-stage", "meta_forms"},
		{"queue stage wins form pipeline", metaArchiveRoute{QueueRequired: true, QueueAvailable: true, QueueStage: "queue-stage", QueuePipeline: "queue-pipeline", FormPipeline: "form-pipeline", FormPipelineFirstStage: "form-first"}, "queue-stage", "meta_forms"},
		{"queue pipeline empty does not invent fallback", metaArchiveRoute{QueueRequired: true, QueueAvailable: true, QueuePipeline: "empty-pipeline", FormPipeline: "form-pipeline", FormPipelineFirstStage: "form-first"}, "", "meta_forms"},
		{"inactive required queue rejects route", metaArchiveRoute{QueueRequired: true, QueueAvailable: false, FormStage: "form-stage", FormPipeline: "form-pipeline", FormPipelineFirstStage: "form-first", DefaultStage: "default"}, "", ""},
		{"untargeted active queue allows form fallback", metaArchiveRoute{QueueRequired: true, QueueAvailable: true, FormPipeline: "form-pipeline", FormPipelineFirstStage: "form-first"}, "form-first", "meta_forms"},
		{"form pipeline wins integration stage", metaArchiveRoute{FormPipeline: "form-pipeline", FormPipelineFirstStage: "form-first", IntegrationStage: "integration-stage"}, "form-first", "meta_forms"},
		{"integration stage wins its pipeline", metaArchiveRoute{IntegrationStage: "integration-stage", IntegrationPipeline: "integration-pipeline", IntegrationPipelineFirstStage: "integration-first"}, "integration-stage", "meta_default"},
		{"integration pipeline", metaArchiveRoute{IntegrationPipeline: "integration-pipeline", IntegrationPipelineFirstStage: "integration-first", DefaultStage: "default"}, "integration-first", "meta_default"},
		{"all null routing uses org fallback", metaArchiveRoute{DefaultStage: "default"}, "default", "meta_default"},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			stage, category := metaArchiveDestination(scenario.route)
			if stage != scenario.stage || category != scenario.category {
				t.Fatalf("got %q/%q, want %q/%q", stage, category, scenario.stage, scenario.category)
			}
		})
	}
}

func TestArchiveGuardDoesNotBlockUnusedFormPipelineAndDeduplicatesMetaCategory(t *testing.T) {
	queue := metaArchiveRoute{QueueRequired: true, QueueAvailable: true, QueueStage: "queue-stage", QueuePipeline: "queue-pipeline", FormPipeline: "form-pipeline", FormPipelineFirstStage: "form-first"}
	query := &archiveQuery{meta: []metaArchiveRoute{queue}}
	if err := (Repository{}).ensureStageArchiveRoutingSafe(context.Background(), query, "org", "form-pipeline", "form-first"); err != nil {
		t.Fatalf("unused form destination blocked: %v", err)
	}
	query = &archiveQuery{meta: []metaArchiveRoute{queue, queue}}
	err := (Repository{}).ensureStageArchiveRoutingSafe(context.Background(), query, "org", "queue-pipeline", "queue-stage")
	var blocked *StageArchiveDependenciesError
	if !errors.As(err, &blocked) || len(blocked.Categories) != 1 || blocked.Categories[0] != "meta_forms" {
		t.Fatalf("expected one effective Meta dependency: %v", err)
	}
}
