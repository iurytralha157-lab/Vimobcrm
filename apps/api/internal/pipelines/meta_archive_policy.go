package pipelines

// References are resolved by the archive query against active, same-tenant
// stages and pipelines. Order follows meta.resolveDestinationWithRoundRobin.
type metaArchiveRoute struct {
	QueueRequired                 bool   `json:"queue_required"`
	QueueAvailable                bool   `json:"queue_available"`
	FormStage                     string `json:"form_stage"`
	QueueStage                    string `json:"queue_stage"`
	QueuePipeline                 string `json:"queue_pipeline"`
	FormPipeline                  string `json:"form_pipeline"`
	FormPipelineFirstStage        string `json:"form_pipeline_first_stage"`
	IntegrationStage              string `json:"integration_stage"`
	IntegrationPipeline           string `json:"integration_pipeline"`
	IntegrationPipelineFirstStage string `json:"integration_pipeline_first_stage"`
	DefaultStage                  string `json:"default_stage"`
}

func metaArchiveDestination(route metaArchiveRoute) (stageID, category string) {
	// A required inactive/missing queue is rejected before Meta considers form
	// defaults. Do not invent a fallback for a currently nonfunctional route.
	if route.QueueRequired && !route.QueueAvailable {
		return "", ""
	}
	if route.FormStage != "" {
		return route.FormStage, "meta_forms"
	}
	if route.QueueStage != "" || route.QueuePipeline != "" {
		return route.QueueStage, "meta_forms"
	}
	if route.FormPipeline != "" {
		return route.FormPipelineFirstStage, "meta_forms"
	}
	if route.IntegrationStage != "" {
		return route.IntegrationStage, "meta_default"
	}
	if route.IntegrationPipeline != "" {
		return route.IntegrationPipelineFirstStage, "meta_default"
	}
	return route.DefaultStage, "meta_default"
}
