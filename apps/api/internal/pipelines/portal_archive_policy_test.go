package pipelines

import (
	"context"
	"errors"
	"testing"
)

func TestPortalArchiveRespectsQueueStageAndPipelineFallback(t *testing.T) {
	for _, scenario := range []struct {
		name  string
		route portalArchiveRoute
		want  string
	}{
		{"resolved queue stage overrides integration pipeline", portalArchiveRoute{Stage: "queue-stage", Pipeline: "queue-pipeline", FirstStage: "integration-first", DefaultStage: "default"}, "queue-stage"},
		{"missing stage uses valid chosen pipeline", portalArchiveRoute{Pipeline: "chosen-pipeline", FirstStage: "chosen-first", DefaultStage: "default"}, "chosen-first"},
		{"empty valid pipeline does not invent default", portalArchiveRoute{Pipeline: "empty-pipeline", DefaultStage: "default"}, ""},
		{"inactive chosen pipeline uses org default", portalArchiveRoute{DefaultStage: "default"}, "default"},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			if got := portalArchiveDestination(scenario.route); got != scenario.want {
				t.Fatalf("got=%q want=%q", got, scenario.want)
			}
		})
	}
	query := &archiveQuery{portals: []portalArchiveRoute{{Stage: "queue-stage", Pipeline: "queue-pipeline", FirstStage: "integration-first"}}}
	if err := (Repository{}).ensureStageArchiveRoutingSafe(context.Background(), query, "org", "integration-pipeline", "integration-first"); err != nil {
		t.Fatalf("unused portal default blocked: %v", err)
	}
	err := (Repository{}).ensureStageArchiveRoutingSafe(context.Background(), query, "org", "queue-pipeline", "queue-stage")
	var blocked *StageArchiveDependenciesError
	if !errors.As(err, &blocked) || blocked.Categories[0] != "portals" {
		t.Fatalf("queue destination not protected: %v", err)
	}
}
