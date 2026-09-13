package properties

import (
	"fmt"
	"strings"
	"time"
)

const (
	expectedPropertyUpdatedAtField = "expected_updated_at"
	internalPropertyVersionField   = "__expected_updated_at"
)

func extractExpectedPropertyUpdatedAt(request propertyRequest) (propertyRequest, time.Time, bool, error) {
	raw, supplied := request[expectedPropertyUpdatedAtField]
	if !supplied {
		return nil, time.Time{}, false, fmt.Errorf("%w: expected_updated_at is required", ErrInvalidInput)
	}

	text, ok := raw.(string)
	if !ok || strings.TrimSpace(text) == "" {
		return nil, time.Time{}, false, fmt.Errorf("%w: expected_updated_at is invalid", ErrInvalidInput)
	}
	expected, err := time.Parse(time.RFC3339Nano, strings.TrimSpace(text))
	if err != nil {
		return nil, time.Time{}, false, fmt.Errorf("%w: expected_updated_at is invalid", ErrInvalidInput)
	}

	withoutVersion := make(propertyRequest, len(request)-1)
	for key, value := range request {
		if key != expectedPropertyUpdatedAtField {
			withoutVersion[key] = value
		}
	}
	return withoutVersion, expected, true, nil
}

func popExpectedPropertyUpdatedAt(input propertyRequest) (time.Time, bool, error) {
	raw, supplied := input[internalPropertyVersionField]
	delete(input, internalPropertyVersionField)
	if !supplied {
		return time.Time{}, false, fmt.Errorf("%w: expected_updated_at is required", ErrInvalidInput)
	}
	expected, ok := raw.(time.Time)
	if !ok {
		return time.Time{}, false, fmt.Errorf("%w: expected_updated_at is invalid", ErrInvalidInput)
	}
	return expected, true, nil
}

func propertyVersionMatches(current time.Time, expected time.Time) bool {
	return current.Equal(expected)
}
