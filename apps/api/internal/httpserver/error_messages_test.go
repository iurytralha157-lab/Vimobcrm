package httpserver

import (
	"net/http"
	"testing"
)

func TestUserFacingErrorMessage(t *testing.T) {
	tests := []struct {
		name     string
		code     string
		original string
		status   int
		want     string
	}{
		{name: "permission", code: "permission_denied", original: "You do not have permission.", status: http.StatusForbidden, want: "Você não tem permissão para realizar esta ação."},
		{name: "organization", code: "organization_required", original: "Organization context is required.", status: http.StatusForbidden, want: "Não foi possível identificar a organização. Atualize a página e tente novamente."},
		{name: "invalid input", code: "invalid_round_robin_input", original: "invalid round robin input", status: http.StatusBadRequest, want: "Os dados informados são inválidos. Revise os campos e tente novamente."},
		{name: "not found", code: "property_not_found", original: "Property was not found.", status: http.StatusNotFound, want: "O registro solicitado não foi encontrado. Ele pode ter sido removido."},
		{name: "operation", code: "property_operation_failed", original: "Unable to complete property operation.", status: http.StatusInternalServerError, want: "Não foi possível concluir a operação. Tente novamente."},
		{name: "team in use", code: "team_in_use", original: "Team is used by a distribution queue.", status: http.StatusConflict, want: "Não é possível excluir esta equipe porque ela está sendo usada em uma fila de distribuição. Remova-a da fila antes de tentar novamente."},
		{name: "dynamic conflict", code: "round_robin_condition_conflict", original: `Esta condição já está na fila "Equipe A".`, status: http.StatusConflict, want: `Esta condição já está na fila "Equipe A".`},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := userFacingErrorMessage(test.code, test.original, test.status); got != test.want {
				t.Fatalf("userFacingErrorMessage() = %q, want %q", got, test.want)
			}
		})
	}
}
