package leads

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestManualActivityTransactionRejectsInvalidInputBeforeBegin(t *testing.T) {
	for _, scenario := range []string{"reserved type", "unknown type", "origin", "kind", "property", "correlation", "object channel", "null notes", "invalid channel", "invalid outcome", "NUL content"} {
		t.Run(scenario, func(t *testing.T) {
			_, actor, input := newActivityCreateFixture()
			input.Type, input.Metadata = "call", map[string]any{"channel": "phone"}
			switch scenario {
			case "reserved type":
				input.Type = "status_change"
			case "unknown type":
				input.Type = "future_system_event"
			case "origin":
				input.Metadata["origin"] = "manual_activity"
			case "kind":
				input.Metadata["kind"] = "feedback"
			case "property":
				input.Metadata["property_id"] = "synthetic"
			case "correlation":
				input.Metadata["operation_id"] = "synthetic"
			case "object channel":
				input.Metadata["channel"] = map[string]any{"toString": nil}
			case "null notes":
				input.Metadata["notes"] = nil
			case "invalid channel":
				input.Metadata["channel"] = "whatsapp"
			case "invalid outcome":
				input.Metadata["outcome"] = "replied"
			case "NUL content":
				content := "Synthetic\x00content"
				input.Content = &content
			}
			began := false
			begin := func(context.Context) (pgx.Tx, error) { began = true; return nil, errors.New("must not begin") }
			activity, err := createActivityWithTransaction(context.Background(), begin, actor, input)
			if !errors.Is(err, ErrInvalidInput) || began || activity.ID != "" {
				t.Fatal("direct tx entry bypassed the manual contract")
			}
		})
	}
}

func TestManualActivityTransactionStampsCurrentActorAndClonesBeforeBegin(t *testing.T) {
	fixture, actor, input := newActivityCreateFixture()
	content := " Ligação iniciada "
	input.Type, input.Content = " call_initiated ", &content
	input.Metadata = map[string]any{"phone": " +5522999998888 ", "channel": " phone "}
	begin := func(ctx context.Context) (pgx.Tx, error) {
		content = "Mutated after validation"
		input.Metadata["phone"], input.Metadata["origin"] = "Foreign phone", "system"
		return fixture.begin(ctx)
	}
	activity, err := createActivityWithTransaction(context.Background(), begin, actor, input)
	if err != nil || fixture.inserts != 1 || fixture.commits != 1 || fixture.locks != 1 || fixture.poolReads != 1 {
		t.Fatal("real call initiation failed its authorized transaction", err)
	}
	want := map[string]any{"phone": "+5522999998888", "channel": "phone", "origin": "manual_activity"}
	if activity.Type != "call_initiated" || activity.Content == nil || *activity.Content != "Ligação iniciada" ||
		activity.OrganizationID != actor.OrganizationID || activity.UserID == nil || *activity.UserID != actor.UserID ||
		!reflect.DeepEqual(activity.Metadata, want) {
		t.Fatal("caller replaced normalized payload, provenance or session attribution")
	}
}

func TestManualActivityInvalidJSONAndPublicErrorsAreSafe(t *testing.T) {
	for _, metadata := range []string{"[]", "123", "true", `"text"`} {
		response := httptest.NewRecorder()
		request := httptest.NewRequest(http.MethodPost, "/v1/activities", strings.NewReader(`{"lead_id":"30000000-0000-4000-8000-000000000001","type":"call","metadata":`+metadata+`}`))
		request = request.WithContext(tenant.ContextWithTenant(request.Context(), tenant.Context{OrganizationID: historyPageTestOrg, UserID: historyPageTestOtherOrg}))
		(Handler{}).CreateActivity(response, request)
		if response.Code != 400 || !strings.Contains(response.Body.String(), "invalid_json") {
			t.Fatal("invalid metadata shape reached storage")
		}
	}
	response := httptest.NewRecorder()
	_, err := (ActivityCreateRequest{LeadID: "30000000-0000-4000-8000-000000000001", Type: "note", Metadata: map[string]any{"origin": "sensitive synthetic payload"}}).Validate()
	writeLeadError(response, httptest.NewRequest(http.MethodPost, "/v1/activities", nil), err)
	if response.Code != 400 || !strings.Contains(response.Body.String(), "invalid_lead_input") || strings.Contains(response.Body.String(), "sensitive synthetic") {
		t.Fatal("invalid activity error exposed caller data or lost its stable code")
	}
}
