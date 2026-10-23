package leads

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

// Frozen wire DTO from commit 7e490c7, the published API observed during the
// diagnosis. Keep this snapshot without expectedUpdatedAt: it reproduces the
// old/new contract mismatch without a network request or a CRM write.
type publishedMoveStageRequest7e490c7 struct {
	StageID         string      `json:"stageId"`
	ExpectedStageID patchString `json:"expectedStageId,omitempty"`
	IsOwnResource   *bool       `json:"isOwnResource,omitempty"`
	BoardOrderAt    *time.Time  `json:"boardOrderAt,omitempty"`
	LostReason      *string     `json:"lostReason,omitempty"`
	StageEnteredAt  *time.Time  `json:"stageEnteredAt,omitempty"`
}

func TestMoveStageContractReproducesPublishedUnknownRevision(t *testing.T) {
	body := `{"stageId":"` + moveRevisionDestination + `","expectedStageId":"` + moveRevisionStage + `","expectedUpdatedAt":"2026-10-16T12:00:00.123456Z","boardOrderAt":"2026-10-16T11:00:00.123457Z"}`
	var published publishedMoveStageRequest7e490c7
	decoder := json.NewDecoder(strings.NewReader(body))
	decoder.DisallowUnknownFields()
	err := decoder.Decode(&published)
	if err == nil || !strings.Contains(err.Error(), `unknown field "expectedUpdatedAt"`) {
		t.Fatalf("published strict DTO must reject the new revision field: %v", err)
	}
	// The decoder error is mapped through the same public writer as MoveStage.
	response := httptest.NewRecorder()
	httpserver.WriteError(response, httptest.NewRequest(http.MethodPost, "/v1/leads/synthetic/move-stage", nil), http.StatusBadRequest, "invalid_json", "Request body is invalid.")
	if response.Code != http.StatusBadRequest || !strings.Contains(response.Body.String(), `"code":"invalid_json"`) ||
		!strings.Contains(response.Body.String(), "Os dados informados são inválidos") {
		t.Fatalf("published decode rejection must explain the observed generic toast: %d %s", response.Code, response.Body.String())
	}

	var current MoveStageRequest
	decoder = json.NewDecoder(strings.NewReader(body))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&current); err != nil {
		t.Fatalf("current DTO rejected the compatible request: %v", err)
	}
	input, err := current.Validate()
	if err != nil || input.ExpectedUpdatedAt == nil || input.ExpectedUpdatedAt.Nanosecond() != 123456000 ||
		input.BoardOrderAt == nil || input.BoardOrderAt.Nanosecond() != 123457000 {
		t.Fatalf("current contract must preserve exact revision/order microseconds: %+v %v", input, err)
	}
}

func TestMoveStageContractKeepsStrictDecodeAndExpectedStagePresence(t *testing.T) {
	for _, test := range []struct {
		name, extra string
		decodeError bool
		validateErr bool
	}{
		{"legacy omitted revision", ``, false, false},
		{"explicit unassigned stage", `,"expectedStageId":null`, false, false},
		{"current exact revision", `,"expectedUpdatedAt":"2026-10-16T12:00:00.123456Z"`, false, false},
		{"current equivalent timezone", `,"expectedUpdatedAt":"2026-10-16T09:00:00.123456-03:00"`, false, false},
		{"unknown field", `,"expectedRevisionTypo":"2026-10-16T12:00:00Z"`, true, false},
		{"malformed revision", `,"expectedUpdatedAt":"malformed"`, true, false},
		{"numeric revision", `,"expectedUpdatedAt":123`, true, false},
		{"zero revision", `,"expectedUpdatedAt":"0001-01-01T00:00:00Z"`, false, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			var request MoveStageRequest
			decoder := json.NewDecoder(strings.NewReader(`{"stageId":"` + moveRevisionDestination + `"` + test.extra + `}`))
			decoder.DisallowUnknownFields()
			err := decoder.Decode(&request)
			if (err != nil) != test.decodeError {
				t.Fatalf("strict decode error=%v want rejected=%t", err, test.decodeError)
			}
			if err != nil {
				return
			}
			input, err := request.Validate()
			if errors.Is(err, ErrInvalidInput) != test.validateErr || (!test.validateErr && err != nil) {
				t.Fatalf("validation=%v want invalid=%t", err, test.validateErr)
			}
			if test.name == "explicit unassigned stage" && (!input.ExpectedStageID.Set || input.ExpectedStageID.Value != nil) {
				t.Fatal("explicit null expectedStageId lost its optimistic concurrency meaning")
			}
		})
	}
}

func TestMoveStageCapabilitiesRequiresTenantAndDoesNotOpenDatabase(t *testing.T) {
	for _, test := range []struct {
		name string
		ctx  *tenant.Context
		want int
	}{
		{"no tenant", nil, http.StatusForbidden},
		{"missing organization", &tenant.Context{UserID: "synthetic"}, http.StatusForbidden},
		{"active tenant", &tenant.Context{OrganizationID: moveRevisionOrg, UserID: "synthetic"}, http.StatusOK},
	} {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, "/v1/leads/capabilities/move-stage", nil)
			if test.ctx != nil {
				request = request.WithContext(tenant.ContextWithTenant(request.Context(), *test.ctx))
			}
			response := httptest.NewRecorder()
			// A zero-value repository deliberately provides no database. Session
			// and permission checks run at the registered route, tested separately.
			(Handler{}).ShowMoveStageCapabilities(response, request)
			if response.Code != test.want || response.Header().Get("Cache-Control") != "private, no-store" {
				t.Fatalf("status=%d cache=%q body=%s", response.Code, response.Header().Get("Cache-Control"), response.Body.String())
			}
			if test.want != http.StatusOK {
				if strings.Contains(response.Body.String(), "revision-v1") {
					t.Fatal("missing tenant exposed the contract")
				}
				return
			}
			var actual map[string]map[string]string
			if err := json.Unmarshal(response.Body.Bytes(), &actual); err != nil || len(actual) != 1 ||
				len(actual["data"]) != 1 || actual["data"]["contract"] != "revision-v1" {
				t.Fatalf("unexpected capability envelope: %s %v", response.Body.String(), err)
			}
		})
	}
}
