package whatsapp

import (
	"os"
	"strings"
	"testing"
)

func TestReactToMessageRequestSupportsRemovalAndRequiresIdempotencyKey(t *testing.T) {
	expectedLeadID := "11111111-1111-4111-8111-111111111111"
	input, err := (ReactToMessageRequest{
		Emoji:            "",
		ClientReactionID: "reaction-client-1",
		ExpectedLeadID:   expectedLeadID,
	}).Validate()
	if err != nil {
		t.Fatalf("Validate() removal error = %v", err)
	}
	if input.Emoji != "" || input.ClientReactionID != "reaction-client-1" || input.ExpectedLeadID != expectedLeadID {
		t.Fatalf("Validate() removal = %#v", input)
	}

	if _, err := (ReactToMessageRequest{Emoji: "👍", ExpectedLeadID: expectedLeadID}).Validate(); err == nil {
		t.Fatal("Validate() accepted reaction without clientReactionId")
	}
	if _, err := (ReactToMessageRequest{
		Emoji:            strings.Repeat("👍", 65),
		ClientReactionID: "reaction-client-2",
		ExpectedLeadID:   expectedLeadID,
	}).Validate(); err == nil {
		t.Fatal("Validate() accepted emoji above the database limit")
	}
	if _, err := (ReactToMessageRequest{
		Emoji:            "👍",
		ClientReactionID: "reaction-client-3",
	}).Validate(); err == nil {
		t.Fatal("Validate() accepted reaction without expectedLeadId")
	}
	if _, err := (ReactToMessageRequest{
		Emoji:            "👍",
		ClientReactionID: "reaction-client-unlinked",
		ExpectedLeadID:   unlinkedConversationLeadSnapshot,
	}).Validate(); err == nil {
		t.Fatal("Validate() accepted reaction for an unlinked conversation")
	}
}

func TestConversationWriteRequestsRequireExpectedLeadSnapshot(t *testing.T) {
	expectedLeadID := "11111111-1111-4111-8111-111111111111"
	input, err := (SendMessageRequest{Text: "ola", ExpectedLeadID: expectedLeadID}).Validate()
	if err != nil {
		t.Fatalf("SendMessageRequest.Validate() error = %v", err)
	}
	if input.ExpectedLeadID != expectedLeadID {
		t.Fatalf("SendMessageRequest expected lead = %q, want %q", input.ExpectedLeadID, expectedLeadID)
	}
	if _, err := (SendMessageRequest{Text: "ola"}).Validate(); err == nil {
		t.Fatal("SendMessageRequest accepted a missing expectedLeadId")
	}
	archive, archiveLeadID, err := (ArchiveRequest{Archive: true, ExpectedLeadID: expectedLeadID}).Validate()
	if err != nil || !archive || archiveLeadID != expectedLeadID {
		t.Fatalf("ArchiveRequest.Validate() = %v/%q/%v", archive, archiveLeadID, err)
	}
	if _, _, err := (ArchiveRequest{Archive: true}).Validate(); err == nil {
		t.Fatal("ArchiveRequest accepted a missing expectedLeadId")
	}
	archive, archiveLeadID, err = (ArchiveRequest{Archive: true, ExpectedLeadID: unlinkedConversationLeadSnapshot}).Validate()
	if err != nil || !archive || archiveLeadID != unlinkedConversationLeadSnapshot {
		t.Fatalf("ArchiveRequest.Validate(unlinked) = %v/%q/%v", archive, archiveLeadID, err)
	}
	if _, err := (SendMessageRequest{Text: "ola", ExpectedLeadID: unlinkedConversationLeadSnapshot}).Validate(); err == nil {
		t.Fatal("SendMessageRequest accepted an unlinked conversation snapshot")
	}
}

func TestConversationMutationSourcesFailClosedOnStaleCardSnapshot(t *testing.T) {
	messageBytes, err := os.ReadFile("message_operations.go")
	if err != nil {
		t.Fatal(err)
	}
	messageSource := string(messageBytes)
	for _, fragment := range []string{
		"pointerValue(conversation.LeadID) != input.ExpectedLeadID",
		"and wc.lead_id = $4::uuid",
		"and wc.lead_id = $%d::uuid",
		"and wc.lead_id is null",
		"lockOwnedConnectedEvolutionSession(ctx, tx, tenantContext, session.ID)",
		"for update of wc",
	} {
		if !strings.Contains(messageSource, fragment) {
			t.Fatalf("message mutation source is missing stale-card guard %q", fragment)
		}
	}
	if mismatchIndex, uploadIndex := strings.Index(messageSource, "pointerValue(conversation.LeadID) != input.ExpectedLeadID"), strings.Index(messageSource, "repo.storage.upload"); mismatchIndex < 0 || uploadIndex < 0 || mismatchIndex > uploadIndex {
		t.Fatal("SendMessage must reject an already-stale card before persisting outbound media")
	}
	sendStart := strings.Index(messageSource, "func (repo Repository) SendMessage")
	sendEnd := strings.Index(messageSource, "func (repo Repository) MarkAsSeenOnWhatsApp")
	if sendStart < 0 || sendEnd <= sendStart {
		t.Fatal("unable to isolate SendMessage")
	}
	sendSource := messageSource[sendStart:sendEnd]
	sendSessionLock := strings.Index(sendSource, "lockOwnedConnectedEvolutionSession(ctx, tx, tenantContext, session.ID)")
	sendConversationLock := strings.Index(sendSource, "for update of wc")
	if sendSessionLock < 0 || sendConversationLock < 0 || sendSessionLock >= sendConversationLock {
		t.Fatal("SendMessage must lock session before conversation")
	}
	markSeenStart := strings.Index(messageSource, "func (repo Repository) MarkAsSeenOnWhatsApp")
	markSeenEnd := strings.Index(messageSource, "func (repo Repository) RetryMediaDownload")
	if markSeenStart < 0 || markSeenEnd <= markSeenStart {
		t.Fatal("unable to isolate MarkAsSeenOnWhatsApp")
	}
	markSeenSource := messageSource[markSeenStart:markSeenEnd]
	markSeenSessionLock := strings.Index(markSeenSource, "lockOwnedConnectedEvolutionSession(ctx, tx, tenantContext, sessionID)")
	markSeenConversationLock := strings.Index(markSeenSource, "for update of wc")
	if markSeenSessionLock < 0 || markSeenConversationLock < 0 || markSeenSessionLock >= markSeenConversationLock {
		t.Fatal("MarkAsSeenOnWhatsApp must lock session before conversation")
	}
	commitIndex := strings.Index(markSeenSource, "tx.Commit(ctx)")
	providerIndex := strings.Index(markSeenSource, `repo.functions.invokeEvolution(ctx, "message.markread"`)
	if commitIndex < 0 || providerIndex < 0 || commitIndex >= providerIndex {
		t.Fatal("MarkAsSeenOnWhatsApp must release database locks before provider HTTP")
	}

	repositoryBytes, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatal(err)
	}
	repositorySource := string(repositoryBytes)
	for _, fragment := range []string{
		`expectedLeadPredicate := "lead_id is null"`,
		`expectedLeadPredicate := "wc.lead_id is null"`,
		`lead_id = $%d::uuid`,
		`wc.lead_id = $%d::uuid`,
	} {
		if !strings.Contains(repositorySource, fragment) {
			t.Fatalf("conversation mutation repository is missing stale-card guard %q", fragment)
		}
	}

	if !strings.Contains(reactionTargetAuthorizationSQL(true), "and wc.lead_id = $7::uuid") {
		t.Fatal("reaction authorization does not pin the expected lead under lock")
	}
	if strings.Contains(reactionTargetAuthorizationSQL(true), "for update of wm, wc, ws, l") {
		t.Fatal("reaction authorization must not reacquire the read-only session as FOR UPDATE")
	}

	reactionBytes, err := os.ReadFile("reaction_operations.go")
	if err != nil {
		t.Fatal(err)
	}
	reactionSource := string(reactionBytes)
	sessionLock := strings.Index(reactionSource, "lockOwnedConnectedEvolutionSession(ctx, tx, tenantContext, sessionID)")
	conversationLock := strings.Index(reactionSource, "for no key update of wc")
	messageLock := strings.Index(reactionSource, "err = tx.QueryRow(ctx, reactionTargetAuthorizationSQL")
	if sessionLock < 0 || conversationLock < 0 || messageLock < 0 || sessionLock >= conversationLock || conversationLock >= messageLock {
		t.Fatal("reaction write must lock session, conversation and target message in canonical order")
	}
}
