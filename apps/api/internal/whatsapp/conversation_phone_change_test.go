package whatsapp

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestPhoneChangeConfirmationErrorReturnsAuthorizedSnapshot(t *testing.T) {
	snapshot := PhoneChangeConfirmation{ConversationID: "10000000-0000-4000-8000-000000000001", LeadID: "20000000-0000-4000-8000-000000000002", SessionID: "30000000-0000-4000-8000-000000000003"}
	response := httptest.NewRecorder()
	writeWhatsAppError(response, httptest.NewRequest(http.MethodPost, "/v1/whatsapp/conversations/start", nil), &phoneChangeConfirmationError{snapshot})
	var body struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
		Data PhoneChangeConfirmation `json:"data"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if response.Code != http.StatusConflict || body.Error.Code != "whatsapp_phone_change_confirmation_required" || body.Data != snapshot {
		t.Fatalf("confirmation error contract: status=%d body=%s", response.Code, response.Body.String())
	}
}

func TestStartPhoneChangeRequiresCompleteConfirmationPairs(t *testing.T) {
	base := StartConversationRequest{LeadID: "20000000-0000-4000-8000-000000000002", SessionID: "30000000-0000-4000-8000-000000000003", ExpectedPreviousLeadID: "20000000-0000-4000-8000-000000000002", ExpectedPreviousConversationID: "10000000-0000-4000-8000-000000000001", ConfirmPhoneChange: true}
	for _, scenario := range []struct {
		name   string
		mutate func(*StartConversationRequest)
	}{
		{"previousWithoutConfirm", func(r *StartConversationRequest) { r.ConfirmPhoneChange = false }},
		{"noExplicitLead", func(r *StartConversationRequest) { r.LeadID = "" }},
		{"noExplicitSession", func(r *StartConversationRequest) { r.SessionID = "" }},
		{"invalidPrevious", func(r *StartConversationRequest) { r.ExpectedPreviousConversationID = "invalid" }},
		{"differentPreviousLead", func(r *StartConversationRequest) { r.ExpectedPreviousLeadID = "40000000-0000-4000-8000-000000000004" }},
		{"destinationWithoutConsent", func(r *StartConversationRequest) {
			r.ExpectedDestinationConversationID = "40000000-0000-4000-8000-000000000004"
		}},
		{"consentWithoutDestination", func(r *StartConversationRequest) { r.ConfirmDestinationHistory = true }},
		{"destinationWithoutPhoneConfirm", func(r *StartConversationRequest) {
			r.ConfirmPhoneChange = false
			r.ExpectedPreviousConversationID = ""
			r.ConfirmDestinationHistory = true
			r.ExpectedDestinationConversationID = "40000000-0000-4000-8000-000000000004"
		}},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			request := base
			scenario.mutate(&request)
			if err := validateStartPhoneConfirmation(request); !errors.Is(err, ErrInvalidInput) {
				t.Fatalf("incomplete confirmation accepted: %v", err)
			}
		})
	}
	if err := validateStartPhoneConfirmation(base); err != nil {
		t.Fatal(err)
	}
	base.ConfirmDestinationHistory = true
	base.ExpectedDestinationConversationID = "40000000-0000-4000-8000-000000000004"
	if err := validateStartPhoneConfirmation(base); err != nil {
		t.Fatal(err)
	}
}
