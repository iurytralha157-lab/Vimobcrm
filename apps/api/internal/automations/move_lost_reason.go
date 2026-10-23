package automations

import "strings"

func validateMoveLostReason(config map[string]any) error {
	value, exists := config["lost_reason"]
	if !exists || value == nil {
		return nil // The canonical command checks whether the destination requires it.
	}
	reason, ok := value.(string)
	if !ok || len([]rune(strings.TrimSpace(reason))) > 300 {
		return invalidFlow("lost_reason must be text with at most 300 characters")
	}
	return nil
}
