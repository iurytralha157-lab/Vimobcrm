package pipelines

import (
	"fmt"
	"time"
)

type DeleteStageRequest struct {
	ExpectedUpdatedAt string `json:"expectedUpdatedAt"`
}

type deleteStageInput struct {
	ExpectedUpdatedAt time.Time
}

func (request DeleteStageRequest) Validate() (deleteStageInput, error) {
	if request.ExpectedUpdatedAt == "" {
		return deleteStageInput{}, ErrStagesChanged
	}
	revision, err := time.Parse(time.RFC3339Nano, request.ExpectedUpdatedAt)
	if err != nil || revision.IsZero() {
		return deleteStageInput{}, fmt.Errorf("%w: expectedUpdatedAt must be the exact RFC3339 timestamp returned by the API", ErrInvalidInput)
	}
	return deleteStageInput{ExpectedUpdatedAt: revision}, nil
}
