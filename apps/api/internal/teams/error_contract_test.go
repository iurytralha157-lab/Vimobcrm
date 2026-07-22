package teams

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestTeamInUseForeignKeyViolationUsesStableConflictContract(t *testing.T) {
	databaseError := &pgconn.PgError{
		Code:           "23503",
		ConstraintName: "round_robin_members_team_id_fkey",
	}
	if !isTeamInUseForeignKeyViolation(databaseError) {
		t.Fatal("expected round_robin_members_team_id_fkey to be recognized")
	}

	request := httptest.NewRequest(http.MethodDelete, "/v1/teams/11111111-1111-4111-8111-111111111111", nil)
	response := httptest.NewRecorder()
	writeTeamError(response, request, ErrTeamInUse)

	if response.Code != http.StatusConflict {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusConflict)
	}

	var payload struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.Error.Code != "team_in_use" {
		t.Fatalf("error code = %q, want team_in_use", payload.Error.Code)
	}
	const expectedMessage = "Não é possível excluir esta equipe porque ela está sendo usada em uma fila de distribuição. Remova-a da fila antes de tentar novamente."
	if payload.Error.Message != expectedMessage {
		t.Fatalf("error message = %q, want %q", payload.Error.Message, expectedMessage)
	}
}

func TestTeamInUseForeignKeyViolationRejectsUnrelatedDatabaseErrors(t *testing.T) {
	tests := []struct {
		name string
		err  error
	}{
		{
			name: "different constraint",
			err: &pgconn.PgError{
				Code:           "23503",
				ConstraintName: "unrelated_team_id_fkey",
			},
		},
		{
			name: "different error code",
			err: &pgconn.PgError{
				Code:           "23505",
				ConstraintName: "round_robin_members_team_id_fkey",
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if isTeamInUseForeignKeyViolation(test.err) {
				t.Fatalf("did not expect %v to be recognized", test.err)
			}
		})
	}
}
