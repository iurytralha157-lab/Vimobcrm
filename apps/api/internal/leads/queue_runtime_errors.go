package leads

import (
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
)

// Match both SQLSTATE and the internal, fixed message. Unrelated constraints,
// lock failures and database details keep the existing internal-error contract.
func writeQueueRuntimeError(w http.ResponseWriter, r *http.Request, err error) bool {
	var databaseError *pgconn.PgError
	if !errors.As(err, &databaseError) {
		return false
	}
	status, code, message := queueRuntimeErrorResponse(databaseError.Code, databaseError.Message)
	if status == 0 {
		return false
	}
	httpserver.WriteError(w, r, status, code, message)
	return true
}

func queueRuntimeErrorResponse(sqlState, reason string) (int, string, string) {
	switch sqlState + ":" + reason {
	case "55P03:queue_configuration_busy":
		return http.StatusConflict, "queue_configuration_busy", "A fila está sendo alterada. Tente novamente."
	case "23514:queue_stage_assignment_rule_or_recipient_invalid":
		return http.StatusUnprocessableEntity, "queue_stage_assignment_invalid", "Revise o responsável e a equipe configurados na regra desta etapa."
	case "23514:queue_stage_assignment_recipient_unavailable", "23514:managed_queue_window_or_recipient_closed":
		return http.StatusConflict, "queue_stage_assignment_unavailable", "A fila ou o responsável da regra está fora da escala. Revise a regra antes de mover o lead."
	case "23514:queue_stage_assignment_round_not_exhausted":
		return http.StatusConflict, "queue_stage_assignment_round_incomplete", "A regra repetiria um responsável antes dos demais elegíveis. Revise o responsável da etapa."
	case "23514:queue_stage_assignment_limit_reached":
		return http.StatusConflict, "queue_stage_assignment_limit_reached", "Este lead atingiu o limite de atribuições automáticas da fila."
	case "23514:queue_stage_assignment_requires_review":
		return http.StatusConflict, "queue_stage_assignment_requires_review", "A atribuição automática está pausada para revisão. Confira o lead antes de transferir."
	case "23514:queue_stage_assignment_existing_owner_drift", "23514:queue_stage_assignment_owner_mismatch",
		"23514:queue_effective_owner_invariant_failed", "42501:managed_queue_ownership_requires_command":
		return http.StatusConflict, "queue_assignment_changed", "A atribuição do lead precisa ser conferida. Atualize o lead e tente novamente."
	case "42501:managed_queue_pool_requires_claim", "42501:queue_pool_activity_requires_claim", "42501:queue_pool_task_requires_claim":
		return http.StatusConflict, "queue_pool_claim_required", "Assuma o lead no bolsão antes de registrar atendimento ou mudar o responsável."
	case "42501:managed_queue_owner_protected":
		return http.StatusConflict, "queue_assignment_protected", "Este lead já tem atendimento ou responsável protegido."
	case "23514:managed_queue_inactive_recipient":
		return http.StatusUnprocessableEntity, "queue_recipient_inactive", "Escolha um responsável ativo na organização."
	case "42501:queue_activity_actor_mismatch":
		return http.StatusForbidden, "queue_activity_actor_mismatch", "O atendimento deve identificar o usuário que realizou a ação."
	default:
		return 0, "", ""
	}
}
