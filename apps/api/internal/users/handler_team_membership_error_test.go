package users

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
)

func TestUserTeamMembershipChangedReturnsActionableConflict(t *testing.T) {
	request := httptest.NewRequest(http.MethodDelete, "/v1/users/00000000-0000-0000-0000-000000000001", nil)
	response := httptest.NewRecorder()
	writeUserError(response, request, fmt.Errorf("%w: exhausted retries", ErrUserTeamMembershipChanged))
	if response.Code != http.StatusConflict {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusConflict)
	}
	var body httpserver.ErrorEnvelope
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode conflict response: %v", err)
	}
	if body.Error.Code != "user_team_membership_changed" {
		t.Fatalf("code = %q", body.Error.Code)
	}
	const wantMessage = "As equipes deste usuário mudaram durante a exclusão. Atualize a página e tente novamente."
	if body.Error.Message != wantMessage {
		t.Fatalf("message = %q, want %q", body.Error.Message, wantMessage)
	}
}
