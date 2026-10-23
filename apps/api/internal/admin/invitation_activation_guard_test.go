package admin

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
)

type invitationProfileQueryRowStub struct {
	userID string
	err    error
}

func (row invitationProfileQueryRowStub) Scan(dest ...any) error {
	if row.err != nil {
		return row.err
	}
	*dest[0].(*string) = row.userID
	return nil
}

type invitationProfileQueryerStub struct {
	row   pgx.Row
	query string
	args  []any
}

func (queryer *invitationProfileQueryerStub) QueryRow(_ context.Context, query string, args ...any) pgx.Row {
	queryer.query = query
	queryer.args = args
	return queryer.row
}

func TestInvitationProfileActivationPreservesGlobalSuspension(t *testing.T) {
	const userID = "11111111-1111-1111-1111-111111111111"
	invitation := invitationRecord{
		OrganizationID: "22222222-2222-2222-2222-222222222222",
		Email:          "person@example.com",
	}
	storageFailure := errors.New("database unavailable")
	tests := []struct {
		name                    string
		invitationOwnedIdentity bool
		row                     pgx.Row
		wantErr                 error
	}{
		{
			name:                    "existing inactive profile is rejected",
			invitationOwnedIdentity: false,
			row:                     invitationProfileQueryRowStub{err: pgx.ErrNoRows},
			wantErr:                 ErrInvitationAccountInactive,
		},
		{
			name:                    "existing active profile is accepted",
			invitationOwnedIdentity: false,
			row:                     invitationProfileQueryRowStub{userID: userID},
		},
		{
			name:                    "invitation owned provisional profile can activate",
			invitationOwnedIdentity: true,
			row:                     invitationProfileQueryRowStub{userID: userID},
		},
		{
			name:                    "storage failure is not mistaken for suspension",
			invitationOwnedIdentity: false,
			row:                     invitationProfileQueryRowStub{err: storageFailure},
			wantErr:                 storageFailure,
		},
		{
			name:                    "unexpected profile identity is rejected",
			invitationOwnedIdentity: false,
			row:                     invitationProfileQueryRowStub{userID: invitation.OrganizationID},
			wantErr:                 ErrInvalidInput,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			queryer := &invitationProfileQueryerStub{row: test.row}
			err := upsertInvitationProfile(context.Background(), queryer, invitation, userID, "Person", nil, test.invitationOwnedIdentity)
			if !errors.Is(err, test.wantErr) {
				t.Fatalf("activation error = %v, want %v", err, test.wantErr)
			}
			if len(queryer.args) != 5 || queryer.args[0] != userID || queryer.args[2] != invitation.Email || queryer.args[4] != test.invitationOwnedIdentity {
				t.Fatalf("activation query arguments = %#v, want user, e-mail, and identity ownership", queryer.args)
			}
			for _, guard := range []string{
				"on conflict (id)",
				"where public.users.is_active is true or $5::boolean",
				"returning id::text",
			} {
				if !strings.Contains(queryer.query, guard) {
					t.Fatalf("activation query is missing %q", guard)
				}
			}
			if strings.Contains(queryer.query, "organization_id =") {
				t.Fatal("profile must not create a default membership before the invited role is written")
			}
		})
	}
}

func TestInvitationProfileSuspensionGuardRunsBeforeMembership(t *testing.T) {
	activation := invitationFunctionSource(t, "invitation_accept.go", "activateInvitationForUser")
	claim := strings.Index(activation, "claimInvitationForActivation(ctx, tx, invitation)")
	profile := strings.Index(activation, "upsertInvitationProfile(ctx, tx, invitation, userID, name, whatsapp, requireInvitationOwnedIdentity)")
	membership := strings.Index(activation, "insert into public.organization_members")
	profileOrganization := strings.Index(activation, "set organization_id = $2::uuid")
	commit := strings.Index(activation, "tx.Commit(ctx)")
	if claim < 0 || profile <= claim || membership <= profile || profileOrganization <= membership || commit <= profileOrganization {
		t.Fatal("invitation claim, profile guard, invited membership, profile organization, and commit must share one ordered transaction")
	}
	if !strings.Contains(activation, "defer tx.Rollback(ctx)") ||
		!strings.Contains(activation, "lockInvitationOwnedAuthIdentity(ctx, tx, invitation, userID)") {
		t.Fatal("provisional identity and transaction rollback must remain protected")
	}
}

func TestInactiveInvitationAccountReturnsForbidden(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "/v1/invitations/token/accept", nil)
	response := httptest.NewRecorder()
	writeAdminError(response, request, ErrInvitationAccountInactive)
	if response.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusForbidden)
	}
	var payload struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatalf("decode error response: %v", err)
	}
	if payload.Error.Code != "invitation_account_inactive" {
		t.Fatalf("error code = %q, want invitation_account_inactive", payload.Error.Code)
	}
}
