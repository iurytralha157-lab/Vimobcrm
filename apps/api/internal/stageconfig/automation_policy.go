package stageconfig

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
)

type automationPolicyQueryer interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

func validateNativeStageAutomationStatus(isWon, isLost bool, status string) error {
	if isWon && isLost {
		return fmt.Errorf("%w: a etapa possui configurações de Ganho e Perdido conflitantes", ErrInvalidInput)
	}
	if (isWon && status != "won") || (isLost && status != "lost") {
		return fmt.Errorf("%w: o status da automação deve respeitar o resultado de Ganho ou Perdido desta etapa", ErrInvalidInput)
	}
	return nil
}
