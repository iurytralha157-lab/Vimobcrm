package teams

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestTeamMemberPayloadRejectsBothFormatsBeforeWrite(t *testing.T) {
	tenantContext := tenant.Context{
		OrganizationID: transactionTestOrganizationID,
		UserID:         transactionTestUserID,
		MemberRole:     "admin",
	}
	transactionStarted := false
	repo := Repository{beginMutationTx: func(context.Context) (pgx.Tx, error) {
		transactionStarted = true
		return nil, errors.New("unexpected mutation transaction")
	}}
	revision := int64(1)
	for _, test := range []struct {
		name   string
		create CreateTeamRequest
		update UpdateTeamRequest
	}{
		{
			name:   "both empty",
			create: CreateTeamRequest{Name: "Equipe", Members: []TeamMemberInput{}, MemberIDs: []string{}},
			update: UpdateTeamRequest{ExpectedRevision: &revision, ExpectedMemberIDs: []string{}, Members: []TeamMemberInput{}, MemberIDs: []string{}},
		},
		{
			name:   "members empty with legacy ids",
			create: CreateTeamRequest{Name: "Equipe", Members: []TeamMemberInput{}, MemberIDs: []string{transactionTestUserID}},
			update: UpdateTeamRequest{ExpectedRevision: &revision, ExpectedMemberIDs: []string{}, Members: []TeamMemberInput{}, MemberIDs: []string{transactionTestUserID}},
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			transactionStarted = false
			if _, err := repo.Create(context.Background(), tenantContext, test.create); !errors.Is(err, ErrInvalidInput) {
				t.Fatalf("Create() error = %v, want invalid input", err)
			}
			if transactionStarted {
				t.Fatal("Create() opened a transaction for ambiguous members")
			}
			if _, err := repo.Update(context.Background(), tenantContext, transactionTestTeamID, test.update); !errors.Is(err, ErrInvalidInput) {
				t.Fatalf("Update() error = %v, want invalid input", err)
			}
			if transactionStarted {
				t.Fatal("Update() opened a transaction for ambiguous members")
			}
		})
	}
}

func TestTeamMemberPayloadAcceptsEachFormatSeparately(t *testing.T) {
	transactionAttempted := errors.New("mutation transaction requested")
	repo := Repository{beginMutationTx: func(context.Context) (pgx.Tx, error) {
		return nil, transactionAttempted
	}}
	tenantContext := tenant.Context{
		OrganizationID: transactionTestOrganizationID,
		UserID:         transactionTestUserID,
		MemberRole:     "admin",
	}
	revision := int64(1)
	for _, request := range []CreateTeamRequest{
		{Name: "Equipe", Members: []TeamMemberInput{}},
		{Name: "Equipe", MemberIDs: []string{}},
	} {
		request.IdempotencyKey = "44444444-4444-4444-8444-444444444444"
		if _, err := repo.Create(context.Background(), tenantContext, request); !errors.Is(err, transactionAttempted) {
			t.Fatalf("Create() with one member format = %v, want transaction attempt", err)
		}
	}
	for _, request := range []UpdateTeamRequest{
		{ExpectedRevision: &revision, ExpectedMemberIDs: []string{}, Members: []TeamMemberInput{}},
		{ExpectedRevision: &revision, ExpectedMemberIDs: []string{}, MemberIDs: []string{}},
	} {
		if _, err := repo.Update(context.Background(), tenantContext, transactionTestTeamID, request); !errors.Is(err, transactionAttempted) {
			t.Fatalf("Update() with one member format = %v, want transaction attempt", err)
		}
	}
}

func TestTeamHandlerRejectsBothMemberFormats(t *testing.T) {
	for _, test := range []struct {
		name   string
		method string
		body   string
		handle func(Handler, http.ResponseWriter, *http.Request)
	}{
		{
			name: "create", method: http.MethodPost,
			body:   `{"name":"Equipe","members":[],"memberIds":[]}`,
			handle: func(h Handler, w http.ResponseWriter, r *http.Request) { h.Create(w, r) },
		},
		{
			name: "create null members", method: http.MethodPost,
			body:   `{"name":"Equipe","members":null,"memberIds":[]}`,
			handle: func(h Handler, w http.ResponseWriter, r *http.Request) { h.Create(w, r) },
		},
		{
			name: "create null legacy ids", method: http.MethodPost,
			body:   `{"name":"Equipe","members":[],"memberIds":null}`,
			handle: func(h Handler, w http.ResponseWriter, r *http.Request) { h.Create(w, r) },
		},
		{
			name: "create only null members", method: http.MethodPost,
			body:   `{"name":"Equipe","members":null}`,
			handle: func(h Handler, w http.ResponseWriter, r *http.Request) { h.Create(w, r) },
		},
		{
			name: "update", method: http.MethodPatch,
			body:   `{"expected_revision":1,"expected_member_ids":[],"members":[],"memberIds":[]}`,
			handle: func(h Handler, w http.ResponseWriter, r *http.Request) { h.Update(w, r) },
		},
		{
			name: "update null members", method: http.MethodPatch,
			body:   `{"expected_revision":1,"expected_member_ids":[],"members":null,"memberIds":[]}`,
			handle: func(h Handler, w http.ResponseWriter, r *http.Request) { h.Update(w, r) },
		},
		{
			name: "update null legacy ids", method: http.MethodPatch,
			body:   `{"expected_revision":1,"expected_member_ids":[],"members":[],"memberIds":null}`,
			handle: func(h Handler, w http.ResponseWriter, r *http.Request) { h.Update(w, r) },
		},
		{
			name: "update only null legacy ids", method: http.MethodPatch,
			body:   `{"expected_revision":1,"expected_member_ids":[],"memberIds":null}`,
			handle: func(h Handler, w http.ResponseWriter, r *http.Request) { h.Update(w, r) },
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(test.method, "/v1/teams/"+transactionTestTeamID, strings.NewReader(test.body))
			request.SetPathValue("id", transactionTestTeamID)
			request = request.WithContext(tenant.ContextWithTenant(context.Background(), tenant.Context{
				OrganizationID: transactionTestOrganizationID,
				UserID:         transactionTestUserID,
				MemberRole:     "admin",
			}))
			response := httptest.NewRecorder()
			test.handle(NewHandler(Repository{}), response, request)
			if response.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400; body = %s", response.Code, response.Body.String())
			}
			var payload struct {
				Error struct {
					Code string `json:"code"`
				} `json:"error"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
				t.Fatalf("decode error response: %v", err)
			}
			if payload.Error.Code != "invalid_team_input" {
				t.Fatalf("error code = %q, want invalid_team_input", payload.Error.Code)
			}
		})
	}
}

func TestTeamRequestMemberPresenceDecodeKeepsUnknownFieldRejection(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "/v1/teams", strings.NewReader(
		`{"name":"Equipe","members":[],"unexpected":true}`,
	))
	request = request.WithContext(tenant.ContextWithTenant(context.Background(), tenant.Context{
		OrganizationID: transactionTestOrganizationID,
		UserID:         transactionTestUserID,
		MemberRole:     "admin",
	}))
	response := httptest.NewRecorder()
	NewHandler(Repository{}).Create(response, request)
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), `"invalid_json"`) {
		t.Fatalf("unexpected response for unknown field: status=%d body=%s", response.Code, response.Body.String())
	}
}
