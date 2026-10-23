package stageconfig

import "time"

type StageAutomationDeleteRequest struct {
	ExpectedUpdatedAt string `json:"expected_updated_at"`
}

type stageAutomationDeleteInput struct {
	ExpectedUpdatedAt time.Time
}

func (request StageAutomationDeleteRequest) Validate() (stageAutomationDeleteInput, error) {
	revision, err := parseRequiredStageAutomationRevision(request.ExpectedUpdatedAt)
	if err != nil {
		return stageAutomationDeleteInput{}, err
	}
	return stageAutomationDeleteInput{ExpectedUpdatedAt: revision}, nil
}
