package stageconfig

import "fmt"

// The inactivity alert editor cannot silently convert a different rule type.
// Existing action_config and extension keys survive threshold/message edits.
func validateInactivityAlertEdit(automation StageAutomation) error {
	return validateInactivityEdit(automation, InactivityActionNotify)
}

// An inactivity rule keeps its action: an alert never becomes a move (or the
// reverse) by editing, because their history and side effects differ.
func validateInactivityEdit(automation StageAutomation, action string) error {
	config, ok := automation.Config.(map[string]any)
	if !ok {
		return fmt.Errorf("%w: configuração de inatividade inválida", ErrInvalidInput)
	}
	automationType, _ := config["automation_type"].(string)
	if automationType == "" {
		automationType, _ = config["action_type"].(string)
	}
	if automationType != inactivityAutomationType(action) {
		return fmt.Errorf("%w: esta regra é de outro tipo e não pode ser convertida", ErrInvalidInput)
	}
	return nil
}

func inactivityAutomationType(action string) string {
	switch action {
	case InactivityActionMoveStage:
		return StageAutomationMoveOnInactivity
	case InactivityActionRedistribute:
		return stageAutomationRedistributeOnInactivity
	default:
		return "alert_on_inactivity"
	}
}

// StageAutomationMoveOnInactivity is the stage automation type of a
// "move to another stage after X days without interaction" rule.
const StageAutomationMoveOnInactivity = "move_stage_on_inactivity"
const stageAutomationRedistributeOnInactivity = "redistribute_on_inactivity"
