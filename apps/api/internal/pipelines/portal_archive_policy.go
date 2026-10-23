package pipelines

// The query resolves the explicit integration/queue stage first, then validates
// its pipeline. A missing stage falls back to the chosen pipeline; an inactive
// pipeline falls back to the organization, matching portals intake.
type portalArchiveRoute struct {
	Stage        string `json:"stage"`
	Pipeline     string `json:"pipeline"`
	FirstStage   string `json:"first_stage"`
	DefaultStage string `json:"default_stage"`
}

func portalArchiveDestination(route portalArchiveRoute) string {
	if route.Stage != "" {
		return route.Stage
	}
	if route.Pipeline != "" {
		return route.FirstStage
	}
	return route.DefaultStage
}
