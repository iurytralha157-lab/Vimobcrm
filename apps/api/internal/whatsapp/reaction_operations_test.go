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
		"lockConversationSendSession(ctx, tx, tenantContext, session.ID)",
		"for update of wc",
	} {
		if !strings.Contains(messageSource, fragment) {
			t.Fatalf("message mutation source is missing stale-card guard %q", fragment)
		}
	}
	if mismatchIndex, uploadIndex := strings.Index(messageSource, "pointerValue(conversation.LeadID) != input.ExpectedLeadID"), strings.Index(messageSource, "repo.prepareOutboundMedia(ctx,"); mismatchIndex < 0 || uploadIndex < 0 || mismatchIndex > uploadIndex {
		t.Fatal("SendMessage must reject an already-stale card before persisting outbound media")
	}
	preflightBytes, err := os.ReadFile("outbound_media_preflight.go")
	if err != nil {
		t.Fatal(err)
	}
	preflightSource := string(preflightBytes)
	uploadIndex := strings.Index(preflightSource, "repo.storage.uploadImmutable(ctx,")
	for _, guard := range []string{"oldConversation != conversationID || oldLead != leadID", `oldDigest != "" && oldDigest != digest`} {
		guardIndex := strings.Index(preflightSource, guard)
		if guardIndex < 0 || uploadIndex < 0 || guardIndex >= uploadIndex {
			t.Fatalf("media preflight must reject changed intent %q before immutable upload", guard)
		}
	}
	sendStart := strings.Index(messageSource, "func (repo Repository) SendMessage")
	sendEnd := strings.Index(messageSource, "func (repo Repository) MarkAsSeenOnWhatsApp")
	if sendStart < 0 || sendEnd <= sendStart {
		t.Fatal("unable to isolate SendMessage")
	}
	sendSource := messageSource[sendStart:sendEnd]
	sendSessionLock := strings.Index(sendSource, "lockConversationSendSession(ctx, tx, tenantContext, session.ID)")
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
	if !strings.Contains(markSeenSource, "lockOperationalInboxConversation(ctx, tx, tenantContext, conversationID, expectedLeadID)") {
		t.Fatal("MarkAsSeenOnWhatsApp must use the current operational inbox authorization fence")
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
		`lead_id = $%d::uuid`,
		`repo.mutateConversationInbox(ctx, tenantContext, conversationID, expectedLeadID, false, false, true)`,
	} {
		if !strings.Contains(repositorySource, fragment) {
			t.Fatalf("conversation mutation repository is missing stale-card guard %q", fragment)
		}
	}

	inboxBytes, err := os.ReadFile("conversation_inbox_mutation.go")
	if err != nil {
		t.Fatal(err)
	}
	inboxSource := string(inboxBytes)
	for _, fragment := range []string{"validateExpectedConversationLeadSnapshot(expectedLeadID)", "result.LeadID != expectedLeadID", "coalesce(wc.lead_id::text,'')=$7", `currentWhatsAppActorSnapshotPredicateSQL("$10")`} {
		if !strings.Contains(inboxSource, fragment) {
			t.Fatalf("inbox mutation missing current-card/actor guard %q", fragment)
		}
	}
	actorLock := strings.Index(inboxSource, "lockWhatsAppUserMembershipRows(")
	sessionFence := strings.Index(inboxSource, "for share`, actor.OrganizationID, result.SessionID")
	conversationFence := strings.Index(inboxSource, "for update of wc")
	if actorLock < 0 || sessionFence < actorLock || conversationFence < sessionFence {
		t.Fatal("operational inbox authorization must lock actors before session and conversation")
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
	sessionLock := strings.Index(reactionSource, "lockConversationSendSession(ctx, tx, tenantContext, sessionID)")
	conversationLock := strings.Index(reactionSource, "for no key update of wc")
	messageLock := strings.Index(reactionSource, "err = tx.QueryRow(ctx, reactionTargetAuthorizationSQL")
	if sessionLock < 0 || conversationLock < 0 || messageLock < 0 || sessionLock >= conversationLock || conversationLock >= messageLock {
		t.Fatal("reaction write must lock session, conversation and target message in canonical order")
	}
}
