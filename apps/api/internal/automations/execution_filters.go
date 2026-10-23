package automations

import "strings"

func executionStatusFilterValues(value string) ([]string, bool) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "running":
		return []string{"queued", "running", "waiting"}, true
	case "queued":
		return []string{"queued"}, true
	case "waiting":
		return []string{"waiting"}, true
	case "completed":
		return []string{"completed"}, true
	case "failed":
		return []string{"failed"}, true
	case "cancelled", "canceled":
		return []string{"cancelled", "canceled"}, true
	default:
		return nil, false
	}
}
