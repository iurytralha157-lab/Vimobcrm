package whatsapp

import (
	"errors"
	"net/url"
	"reflect"
	"testing"
)

func TestParseFindConversationFilterAcceptsSingleCombinedLookup(t *testing.T) {
	filter, err := ParseFindConversationFilter(url.Values{
		"leadId":    {"11111111-1111-4111-8111-111111111111"},
		"phone":     {"+5511999999999"},
		"sessionId": {"22222222-2222-4222-8222-222222222222"},
	})
	if err != nil {
		t.Fatalf("ParseFindConversationFilter() error = %v", err)
	}
	if filter.LeadID != "11111111-1111-4111-8111-111111111111" ||
		filter.Phone != "+5511999999999" ||
		filter.SessionID != "22222222-2222-4222-8222-222222222222" {
		t.Fatalf("combined find filter = %#v", filter)
	}
}

func TestResolveConversationFindScopesLeadLookupToSelectedSession(t *testing.T) {
	wanted := &Conversation{
		ID:        "conversation-for-lead",
		SessionID: "selected-session",
	}
	phoneCalled := false

	got, err := resolveConversationFind(
		FindConversationFilter{
			LeadID:    "lead-id",
			Phone:     "+5511999999999",
			SessionID: "selected-session",
		},
		func(leadID string, sessionID string) (*Conversation, error) {
			if leadID != "lead-id" {
				t.Fatalf("lead lookup id = %q", leadID)
			}
			if sessionID != "selected-session" {
				t.Fatalf("lead lookup session = %q", sessionID)
			}
			return wanted, nil
		},
		func(string, string) (*Conversation, error) {
			phoneCalled = true
			return nil, nil
		},
	)
	if err != nil {
		t.Fatalf("resolveConversationFind() error = %v", err)
	}
	if got != wanted {
		t.Fatalf("resolveConversationFind() = %#v, want lead conversation %#v", got, wanted)
	}
	if phoneCalled {
		t.Fatal("phone fallback must not run after a lead conversation is found")
	}
}

func TestResolveConversationFindFallsBackToPhoneInsideSelectedSession(t *testing.T) {
	wanted := &Conversation{
		ID:        "conversation-for-phone",
		SessionID: "selected-session",
	}
	calls := []string{}

	got, err := resolveConversationFind(
		FindConversationFilter{
			LeadID:    "lead-id",
			Phone:     "+5511999999999",
			SessionID: "selected-session",
		},
		func(leadID string, sessionID string) (*Conversation, error) {
			calls = append(calls, "lead:"+leadID+":"+sessionID)
			return nil, nil
		},
		func(phone string, sessionID string) (*Conversation, error) {
			calls = append(calls, "phone:"+phone+":"+sessionID)
			if sessionID != "selected-session" {
				t.Fatalf("phone lookup session = %q", sessionID)
			}
			return wanted, nil
		},
	)
	if err != nil {
		t.Fatalf("resolveConversationFind() error = %v", err)
	}
	if got != wanted {
		t.Fatalf("resolveConversationFind() = %#v, want phone conversation %#v", got, wanted)
	}
	wantCalls := []string{"lead:lead-id:selected-session", "phone:+5511999999999:selected-session"}
	if !reflect.DeepEqual(calls, wantCalls) {
		t.Fatalf("lookup order = %#v, want %#v", calls, wantCalls)
	}
}

func TestResolveConversationFindFailsClosedWhenLeadLookupIsDenied(t *testing.T) {
	denied := errors.New("lead access denied")
	phoneCalled := false

	got, err := resolveConversationFind(
		FindConversationFilter{
			LeadID:    "lead-id",
			Phone:     "+5511999999999",
			SessionID: "selected-session",
		},
		func(string, string) (*Conversation, error) {
			return nil, denied
		},
		func(string, string) (*Conversation, error) {
			phoneCalled = true
			return nil, nil
		},
	)
	if got != nil {
		t.Fatalf("resolveConversationFind() = %#v, want nil", got)
	}
	if !errors.Is(err, denied) {
		t.Fatalf("resolveConversationFind() error = %v, want %v", err, denied)
	}
	if phoneCalled {
		t.Fatal("phone fallback must not run when lead authorization fails")
	}
}

func TestResolveConversationFindKeepsLeadOnlyInvalidPhoneCompatibility(t *testing.T) {
	phoneCalled := false

	got, err := resolveConversationFind(
		FindConversationFilter{LeadID: "lead-id"},
		func(string, string) (*Conversation, error) {
			return nil, nil
		},
		func(string, string) (*Conversation, error) {
			phoneCalled = true
			return nil, nil
		},
	)
	if err != nil {
		t.Fatalf("resolveConversationFind() error = %v", err)
	}
	if got != nil {
		t.Fatalf("resolveConversationFind() = %#v, want nil", got)
	}
	if phoneCalled {
		t.Fatal("invalid phone must not reach the phone lookup")
	}
}

func TestResolveConversationFindRejectsInvalidPhoneWithoutLead(t *testing.T) {
	leadCalled := false
	phoneCalled := false

	got, err := resolveConversationFind(
		FindConversationFilter{Phone: "invalid", SessionID: "selected-session"},
		func(string, string) (*Conversation, error) {
			leadCalled = true
			return nil, nil
		},
		func(string, string) (*Conversation, error) {
			phoneCalled = true
			return nil, nil
		},
	)
	if got != nil {
		t.Fatalf("resolveConversationFind() = %#v, want nil", got)
	}
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("resolveConversationFind() error = %v, want ErrInvalidInput", err)
	}
	if leadCalled || phoneCalled {
		t.Fatalf("unexpected lookup calls: lead=%v phone=%v", leadCalled, phoneCalled)
	}
}
