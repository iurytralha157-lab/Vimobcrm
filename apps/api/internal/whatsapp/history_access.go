package whatsapp

import "errors"

type leadHistoryReaders struct {
	authorize         func(string) error
	conversations     func(string, string, int) ([]Conversation, error)
	conversationState func(string, string) error
	messages          func(string, string, MessageFilter) (MessagePage, error)
}

// Shared orchestration keeps the lead authorization and message scope identical
// when a caller opts out of the unused conversation envelope. The adapters own
// the existing tenant-scoped SQL; this function never grants send capability.
func readLeadHistoryAccess(filter HistoryAccessFilter, readers leadHistoryReaders) (HistoryAccessResponse, error) {
	leadID, ok := normalizeUUID(filter.LeadID)
	if !ok {
		return HistoryAccessResponse{}, ErrInvalidReference
	}
	if err := readers.authorize(leadID); err != nil {
		return HistoryAccessResponse{}, err
	}
	messageFilter := filter.MessageFilter
	if messageFilter.Limit == 0 {
		messageFilter.Limit = 50
	}
	conversations := []Conversation{}
	if messageFilter.CursorAt == nil && (filter.IncludeConversations == nil || *filter.IncludeConversations) {
		var err error
		conversations, err = readers.conversations(leadID, filter.ConversationID, messageFilter.OrderingVersion)
		if err != nil {
			return HistoryAccessResponse{}, err
		}
		for index := range conversations {
			currentErr := readers.conversationState(conversations[index].ID, leadID)
			switch {
			case currentErr == nil:
				conversations[index].HistoricalLeadView = false
			case errors.Is(currentErr, ErrConversationNotFound):
				conversations[index].HistoricalLeadView = true
			default:
				return HistoryAccessResponse{}, currentErr
			}
		}
	}
	page, err := readers.messages(leadID, filter.ConversationID, messageFilter)
	if err != nil {
		return HistoryAccessResponse{}, err
	}
	var conversation *Conversation
	if len(conversations) > 0 {
		conversation = &conversations[0]
	}
	return HistoryAccessResponse{Conversation: conversation, Conversations: conversations,
		Messages: page.Messages, NextCursor: page.NextCursor}, nil
}
