package stageconfig

import "fmt"

// The inactivity alert editor cannot silently convert a different rule type.
// Existing action_config and extension keys survive threshold/message edits.
func validateInactivityAlertEdit(automation StageAutomation) error {
	config, ok := automation.Config.(map[string]any)
	if !ok {
		return fmt.Errorf("%w: configuração de inatividade inválida", ErrInvalidInput)
	}
	automationType, _ := config["automation_type"].(string)
	if automationType == "" {
		automationType, _ = config["action_type"].(string)
	}
	if automationType != "alert_on_inactivity" {
		return fmt.Errorf("%w: este editor aceita somente alertas de inatividade", ErrInvalidInput)
	}
	return nil
}
