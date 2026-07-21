package admin

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestWriteAdminErrorInvitationConflicts(t *testing.T) {
	tests := []struct {
		name        string
		err         error
		wantCode    string
		wantMessage string
	}{
		{
			name:        "existing member",
			err:         ErrInvitationUserAlreadyMember,
			wantCode:    "invitation_user_already_member",
			wantMessage: "Este usuário já está cadastrado na sua imobiliária.",
		},
		{
			name:        "pending invitation",
			err:         ErrInvitationAlreadyPending,
			wantCode:    "invitation_already_pending",
			wantMessage: "Já existe um convite pendente para este usuário nesta imobiliária.",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPost, "/v1/invitations", nil)
			response := httptest.NewRecorder()

			writeAdminError(response, request, test.err)

			if response.Code != http.StatusConflict {
				t.Fatalf("status = %d, want %d", response.Code, http.StatusConflict)
			}

			var payload struct {
				Error struct {
					Code    string `json:"code"`
					Message string `json:"message"`
				} `json:"error"`
			}
			if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			if payload.Error.Code != test.wantCode {
				t.Fatalf("code = %q, want %q", payload.Error.Code, test.wantCode)
			}
			if payload.Error.Message != test.wantMessage {
				t.Fatalf("message = %q, want %q", payload.Error.Message, test.wantMessage)
			}
		})
	}
}

func TestIsPendingInvitationUniqueViolation(t *testing.T) {
	matching := &pgconn.PgError{Code: "23505", ConstraintName: "invitations_pending_org_email_uidx"}
	if !isPendingInvitationUniqueViolation(matching) {
		t.Fatal("expected matching unique violation to be recognized")
	}

	otherConstraint := &pgconn.PgError{Code: "23505", ConstraintName: "another_constraint"}
	if isPendingInvitationUniqueViolation(otherConstraint) {
		t.Fatal("did not expect another constraint to be recognized")
	}
}

func TestWriteAdminErrorInvitationEmailMissing(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "/v1/invitations/00000000-0000-0000-0000-000000000000/resend", nil)
	response := httptest.NewRecorder()

	writeAdminError(response, request, ErrInvitationEmailMissing)

	if response.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusUnprocessableEntity)
	}

	var payload struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if payload.Error.Code != "invitation_email_missing" {
		t.Fatalf("code = %q, want %q", payload.Error.Code, "invitation_email_missing")
	}
}

func TestRandomInvitationToken(t *testing.T) {
	first, err := randomInvitationToken()
	if err != nil {
		t.Fatalf("generate first token: %v", err)
	}
	second, err := randomInvitationToken()
	if err != nil {
		t.Fatalf("generate second token: %v", err)
	}
	if len(first) != 64 {
		t.Fatalf("token length = %d, want 64", len(first))
	}
	if first == second {
		t.Fatal("expected independently generated tokens to differ")
	}
}
