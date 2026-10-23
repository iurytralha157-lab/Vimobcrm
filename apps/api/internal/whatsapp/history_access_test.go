package whatsapp

import (
	"errors"
	"net/url"
	"reflect"
	"testing"
	"time"
)

func TestHistoryConversationEnvelopeOptionIsExplicitAndBackwardsCompatible(t *testing.T) {
	for _, raw := range []string{"", "true", "false"} {
		values := url.Values{"leadId": {"11111111-1111-4111-8111-111111111111"}}
		if raw != "" {
			values.Set("includeConversations", raw)
		}
		filter, err := ParseHistoryAccessFilter(values)
		if err != nil || (raw == "" && filter.IncludeConversations != nil) ||
			(raw != "" && (filter.IncludeConversations == nil || *filter.IncludeConversations != (raw == "true"))) {
			t.Fatalf("includeConversations=%q filter=%#v err=%v", raw, filter, err)
		}
	}
	if _, err := ParseHistoryAccessFilter(url.Values{"leadId": {"11111111-1111-4111-8111-111111111111"}, "includeConversations": {"unknown"}}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("invalid option was accepted: %v", err)
	}
}

func TestMessagesOnlyLeadHistorySkipsEveryConversationReadAfterAuthorization(t *testing.T) {
	include := false
	filter := HistoryAccessFilter{LeadID: "11111111-1111-4111-8111-111111111111", ConversationID: "22222222-2222-4222-8222-222222222222",
		IncludeConversations: &include, MessageFilter: MessageFilter{Limit: 40, OrderingVersion: 2, IncludeMediaURLs: false}}
	calls := []string{}
	next := "synthetic-cursor"
	readers := leadHistoryReaders{
		authorize: func(id string) error {
			if id != filter.LeadID {
				t.Fatal("lead identity changed before authorization")
			}
			calls = append(calls, "authorize")
			return nil
		},
		conversations: func(string, string, int) ([]Conversation, error) {
			t.Fatal("unused conversation list was loaded")
			return nil, nil
		},
		conversationState: func(string, string) error { t.Fatal("unused conversation was revalidated"); return nil },
		messages: func(lead, conversation string, messages MessageFilter) (MessagePage, error) {
			calls = append(calls, "messages")
			if lead != filter.LeadID || conversation != filter.ConversationID || !reflect.DeepEqual(messages, filter.MessageFilter) {
				t.Fatal("messages-only option changed the authorized message scope, cursor or media policy")
			}
			return MessagePage{Messages: []Message{{ID: "synthetic-message"}}, NextCursor: &next}, nil
		},
	}
	for page := 0; page < 2; page++ {
		result, err := readLeadHistoryAccess(filter, readers)
		if err != nil || len(result.Messages) != 1 || result.NextCursor == nil || *result.NextCursor != next || result.Conversation != nil || len(result.Conversations) != 0 {
			t.Fatalf("messages-only response lost its page or added a conversation: %#v %v", result, err)
		}
		cursor := time.Date(2026, 10, 18, 12, 0, 0, 0, time.UTC)
		filter.CursorAt = &cursor
	}
	if !reflect.DeepEqual(calls, []string{"authorize", "messages", "authorize", "messages"}) {
		t.Fatalf("each page must authorize before reading messages: %v", calls)
	}
}

func TestMessagesOnlyLeadHistoryStillFailsClosedOnAuthorizationAndMessageErrors(t *testing.T) {
	include := false
	denied := errors.New("synthetic revoked or foreign lead")
	for _, failure := range []string{"authorize", "messages"} {
		messagesRead := false
		_, err := readLeadHistoryAccess(HistoryAccessFilter{LeadID: "11111111-1111-4111-8111-111111111111", IncludeConversations: &include}, leadHistoryReaders{
			authorize: func(string) error {
				if failure == "authorize" {
					return denied
				}
				return nil
			},
			messages: func(string, string, MessageFilter) (MessagePage, error) {
				messagesRead = true
				return MessagePage{}, denied
			},
		})
		if !errors.Is(err, denied) || (failure == "authorize" && messagesRead) {
			t.Fatalf("messages-only option bypassed the original access/error boundary: err=%v read=%v", err, messagesRead)
		}
	}
}

func TestDefaultLeadHistoryRetainsConversationClassificationAndFirstPageEnvelope(t *testing.T) {
	filter := HistoryAccessFilter{LeadID: "11111111-1111-4111-8111-111111111111"}
	classified := []string{}
	result, err := readLeadHistoryAccess(filter, leadHistoryReaders{
		authorize: func(string) error { return nil },
		conversations: func(string, string, int) ([]Conversation, error) {
			return []Conversation{{ID: "current"}, {ID: "historical"}}, nil
		},
		conversationState: func(id, lead string) error {
			classified = append(classified, id)
			if lead != filter.LeadID {
				t.Fatal("classification lost the original lead snapshot")
			}
			if id == "historical" {
				return ErrConversationNotFound
			}
			return nil
		},
		messages: func(string, string, MessageFilter) (MessagePage, error) {
			return MessagePage{Messages: []Message{}}, nil
		},
	})
	if err != nil || result.Conversation == nil || result.Conversation.ID != "current" || len(result.Conversations) != 2 ||
		result.Conversations[0].HistoricalLeadView || !result.Conversations[1].HistoricalLeadView || !reflect.DeepEqual(classified, []string{"current", "historical"}) {
		t.Fatalf("legacy first-page envelope changed: %#v, %v", result, err)
	}
}
