package whatsapp

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"
)

func TestAttendanceEventTimesFailClosedOnMissingAndFutureTimestamp(t *testing.T) {
	accepted := time.Date(2026, 9, 23, 3, 0, 0, 0, time.UTC)
	for _, provider := range []time.Time{time.Time{}, accepted.Add(time.Second)} {
		if attendanceEventTimesValid(provider, accepted) {
			t.Fatalf("provider timestamp %v should not permit capture", provider)
		}
	}
	if attendanceEventTimesValid(accepted.Add(-time.Second), time.Time{}) {
		t.Fatal("missing durable inbox time should not permit capture")
	}
	if !attendanceEventTimesValid(accepted.Add(-time.Second), accepted) {
		t.Fatal("valid provider time before durable inbox should remain eligible")
	}
}

func TestAttendanceCaptureStopsWhenSessionOwnerOrMembershipChanges(t *testing.T) {
	raw, err := os.ReadFile("attendance_capture.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)
	for _, functionName := range []string{
		"func currentAttendanceEntry(",
		"func eventAttendanceEntry(",
		"func anyCurrentAttendanceEntry(",
	} {
		start := strings.Index(source, functionName)
		if start < 0 {
			t.Fatalf("missing attendance capture function %s", functionName)
		}
		section := source[start:]
		if next := strings.Index(section[len(functionName):], "\nfunc "); next >= 0 {
			section = section[:len(functionName)+next]
		}
		for _, required := range []string{
			"session.organization_id = entry.organization_id",
			"session.id = entry.session_id",
			"session.owner_user_id = entry.user_id",
			"actor.id = entry.user_id",
			"coalesce(actor.is_active, false) = true",
			"member.organization_id = entry.organization_id",
			"member.user_id = entry.user_id",
			"coalesce(member.is_active, true) = true",
		} {
			if !strings.Contains(section, required) {
				t.Fatalf("%s must reject a transferred or deactivated owner: missing %q", functionName, required)
			}
		}
	}
}

func TestNativeCTWAAutoAttendanceRequiresNewCardAndExactIngressProof(t *testing.T) {
	accepted := time.Date(2026, 9, 23, 3, 0, 0, 0, time.UTC)
	conversation := nativeEvolutionConversation{
		ID:            attendanceTestLeadID,
		LeadID:        attendanceTestLeadID,
		MessageLeadID: attendanceTestLeadID,
		LeadIsNew:     true,
	}
	message := nativeEvolutionMessage{
		ProviderMessageID:                  "first-ctwa-provider-event",
		IsCTWAAd:                           true,
		CampaignEntryPointConversionSource: "ctwa_ad",
		CampaignSourceType:                 "ad",
		SentAt:                             accepted.Add(-time.Second),
	}
	eligible := func(conversation nativeEvolutionConversation, message nativeEvolutionMessage, stored nativeEvolutionStoredMessageIdentity, bindingID string, acceptedAt time.Time, sequence int64) bool {
		return nativeCTWAAutoAttendanceEligible(conversation, message, stored, bindingID, acceptedAt, sequence)
	}
	if !eligible(conversation, message, nativeEvolutionStoredMessageIdentity{}, attendanceTestLeadID, accepted, 12) {
		t.Fatal("new CTWA card and its first real provider ingress should be eligible for database proof")
	}

	tests := []struct {
		name         string
		conversation nativeEvolutionConversation
		message      nativeEvolutionMessage
		stored       nativeEvolutionStoredMessageIdentity
		bindingID    string
		acceptedAt   time.Time
		sequence     int64
	}{
		{"existing card", func() nativeEvolutionConversation { v := conversation; v.LeadIsNew = false; return v }(), message, nativeEvolutionStoredMessageIdentity{}, attendanceTestLeadID, accepted, 12},
		{"historical replay", func() nativeEvolutionConversation { v := conversation; v.HistoricalBindingReplay = true; return v }(), message, nativeEvolutionStoredMessageIdentity{}, attendanceTestLeadID, accepted, 12},
		{"cross queue compatibility", func() nativeEvolutionConversation {
			v := conversation
			v.LeadScopeCompatibilityFallback = true
			return v
		}(), message, nativeEvolutionStoredMessageIdentity{}, attendanceTestLeadID, accepted, 12},
		{"different card binding", func() nativeEvolutionConversation {
			v := conversation
			v.MessageLeadID = attendanceTestSessionID
			return v
		}(), message, nativeEvolutionStoredMessageIdentity{}, attendanceTestLeadID, accepted, 12},
		{"stored retry", conversation, message, nativeEvolutionStoredMessageIdentity{ID: attendanceTestLeadID}, attendanceTestLeadID, accepted, 12},
		{"no binding", conversation, message, nativeEvolutionStoredMessageIdentity{}, "", accepted, 12},
		{"not CTWA", conversation, func() nativeEvolutionMessage { v := message; v.IsCTWAAd = false; return v }(), nativeEvolutionStoredMessageIdentity{}, attendanceTestLeadID, accepted, 12},
		{"unconfirmed CTWA", conversation, func() nativeEvolutionMessage { v := message; v.CampaignEntryPointConversionSource = ""; return v }(), nativeEvolutionStoredMessageIdentity{}, attendanceTestLeadID, accepted, 12},
		{"synthetic provider ID", conversation, func() nativeEvolutionMessage { v := message; v.ProviderMessageIDSynthetic = true; return v }(), nativeEvolutionStoredMessageIdentity{}, attendanceTestLeadID, accepted, 12},
		{"missing provider time", conversation, func() nativeEvolutionMessage { v := message; v.ProviderTimestampMissing = true; return v }(), nativeEvolutionStoredMessageIdentity{}, attendanceTestLeadID, accepted, 12},
		{"future provider time", conversation, func() nativeEvolutionMessage { v := message; v.SentAt = accepted.Add(time.Second); return v }(), nativeEvolutionStoredMessageIdentity{}, attendanceTestLeadID, accepted, 12},
		{"missing inbox time", conversation, message, nativeEvolutionStoredMessageIdentity{}, attendanceTestLeadID, time.Time{}, 12},
		{"missing ingress sequence", conversation, message, nativeEvolutionStoredMessageIdentity{}, attendanceTestLeadID, accepted, 0},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if eligible(test.conversation, test.message, test.stored, test.bindingID, test.acceptedAt, test.sequence) {
				t.Fatal("auto attendance must fail closed without exact new-card CTWA evidence")
			}
		})
	}
}

func TestNativeCTWAAutoAttendanceUsesTrustedRPCBeforeCapture(t *testing.T) {
	capture, err := os.ReadFile("attendance_capture.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(capture)
	for _, token := range []string{
		"public.auto_enter_whatsapp_ctwa_attendance",
		"entry.entry_source = 'manual'",
		"entry.entry_source = 'ctwa_auto'",
		"entry.bootstrap_provider_message_id = $9",
		"entry.bootstrap_ingress_sequence = $8::bigint",
		"entry.bootstrap_ingress_sequence < $8::bigint",
		"entry.bootstrap_provider_occurred_at <= $6::timestamptz",
		"entry.bootstrap_inbox_created_at <= $7::timestamptz",
	} {
		if !strings.Contains(source, token) {
			t.Fatalf("auto capture is missing boundary %q", token)
		}
	}
	processor, err := os.ReadFile("webhook_native_processor.go")
	if err != nil {
		t.Fatal(err)
	}
	processSource := string(processor)
	start := strings.Index(processSource, "func (repo Repository) processNativeEvolutionMessages")
	if start < 0 {
		t.Fatal("native message processor not found")
	}
	processSource = processSource[start:]
	end := strings.Index(processSource[len("func "):], "\nfunc ")
	if end < 0 {
		t.Fatal("native message processor end not found")
	}
	processSource = processSource[:len("func ")+end]
	bootstrap := strings.Index(processSource, "maybeAutoEnterCTWAAttendance(")
	decision := strings.Index(processSource, "eventAttendanceEntry(")
	write := strings.Index(processSource, "insertNativeEvolutionMessage(")
	if bootstrap < 0 || decision <= bootstrap || write <= decision {
		t.Fatal("trusted CTWA bootstrap must precede capture decision and first message write")
	}
}

func TestNativeCTWANewCardUsesItsActivatedBindingNotPreviousCardSnapshot(t *testing.T) {
	message := nativeEvolutionMessage{
		ProviderMessageID:                  "ctwa-first-event",
		IsCTWAAd:                           true,
		CampaignEntryPointConversionSource: "ctwa_ad",
		CampaignSourceType:                 "ad",
	}
	conversation := nativeEvolutionConversation{
		LeadID:        attendanceTestLeadID,
		MessageLeadID: attendanceTestLeadID,
		LeadIsNew:     true,
	}
	snapshot := &nativeIngressRoutingSnapshot{
		ContextKind:       "contextual_intake",
		ProviderMessageID: message.ProviderMessageID,
		CurrentLeadID:     attendanceTestSessionID,
		ActiveBindingID:   attendanceTestSessionID,
	}
	if !nativeCTWANewCardOwnsCurrentBinding(conversation, message, snapshot) {
		t.Fatal("new CTWA card must use its newly activated binding, not the previous card's pre-ACK binding")
	}
	for _, test := range []struct {
		name         string
		conversation nativeEvolutionConversation
		message      nativeEvolutionMessage
		snapshot     *nativeIngressRoutingSnapshot
	}{
		{"reused card", func() nativeEvolutionConversation { v := conversation; v.LeadIsNew = false; return v }(), message, snapshot},
		{"historical replay", func() nativeEvolutionConversation { v := conversation; v.HistoricalBindingReplay = true; return v }(), message, snapshot},
		{"other card", func() nativeEvolutionConversation {
			v := conversation
			v.MessageLeadID = attendanceTestSessionID
			return v
		}(), message, snapshot},
		{"other provider event", conversation, message, &nativeIngressRoutingSnapshot{ContextKind: "contextual_intake", ProviderMessageID: "different"}},
		{"organic event", conversation, message, &nativeIngressRoutingSnapshot{ContextKind: "organic", ProviderMessageID: message.ProviderMessageID}},
		{"not CTWA", conversation, func() nativeEvolutionMessage { v := message; v.IsCTWAAd = false; return v }(), snapshot},
	} {
		t.Run(test.name, func(t *testing.T) {
			if nativeCTWANewCardOwnsCurrentBinding(test.conversation, test.message, test.snapshot) {
				t.Fatal("only the exact new-card contextual CTWA event may replace the ingress binding")
			}
		})
	}

	processor, err := os.ReadFile("webhook_native_processor.go")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(processor),
		"routingSnapshot.ActiveBindingID != \"\" &&\n\t\t\t!nativeCTWANewCardOwnsCurrentBinding(conversation, message, routingSnapshot)") {
		t.Fatal("native ingress must retain the old snapshot binding except for an exact new CTWA card")
	}
}

func TestNativeCTWACardCreatorUsesCurrentSessionOwnerOnly(t *testing.T) {
	business, err := os.ReadFile("webhook_native_business.go")
	if err != nil {
		t.Fatal(err)
	}
	businessSource := string(business)
	start := strings.Index(businessSource, "func resolveNativeActiveSessionOwner(")
	end := strings.Index(businessSource, "func nativeOrganizationUserExists(")
	if start < 0 || end <= start {
		t.Fatal("native active owner resolver not found")
	}
	resolver := businessSource[start:end]
	if !strings.Contains(resolver, "session.OwnerUserID") ||
		!strings.Contains(resolver, "nativeOrganizationUserExists") ||
		strings.Contains(resolver, "session.CreatedBy") {
		t.Fatal("CTWA owner resolver must use only the current active session owner and organization membership")
	}

	processor, err := os.ReadFile("webhook_native_processor.go")
	if err != nil {
		t.Fatal(err)
	}
	processorSource := string(processor)
	start = strings.Index(processorSource, "func createAuthorizedNativeLead(")
	end = strings.Index(processorSource, "func resolveNativeCTWAIntakeDestination(")
	if start < 0 || end <= start {
		t.Fatal("CTWA card creation section not found")
	}
	creation := processorSource[start:end]
	ownerCheck := strings.Index(creation, "ownerUserID, err := resolveNativeActiveSessionOwner(")
	leadUpsert := strings.Index(creation, "from public.upsert_whatsapp_webhook_lead(")
	if ownerCheck < 0 || leadUpsert <= ownerCheck ||
		!strings.Contains(creation, "createdBy := ownerUserID") {
		t.Fatal("CTWA creation must validate the owner before upsert and retain owner provenance")
	}
	if !strings.Contains(processorSource[end:], "RequireExplicitRule:  true") {
		t.Fatal("CTWA with no explicit distribution rule must fall back to the session owner")
	}
}

func TestAttendanceResponseExposesOnlyPublicParticipantFields(t *testing.T) {
	entry := AttendanceEntry{
		ID:                    attendanceTestLeadID,
		OrganizationID:        attendanceTestLeadID,
		ConversationID:        attendanceTestLeadID,
		SessionID:             attendanceTestSessionID,
		LeadID:                attendanceTestLeadID,
		BindingID:             attendanceTestLeadID,
		UserID:                attendanceTestLeadID,
		ActorNameSnapshot:     "Ana",
		EntrySource:           "manual",
		IngressSequenceCutoff: 12,
	}
	encoded, err := json.Marshal(entry)
	if err != nil {
		t.Fatal(err)
	}
	var fields map[string]any
	if err := json.Unmarshal(encoded, &fields); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"id", "userId", "userName", "sessionId", "joinedAt", "entrySource"} {
		if _, ok := fields[key]; !ok {
			t.Fatalf("public attendance entry missing %q: %s", key, encoded)
		}
	}
	if len(fields) != 6 {
		t.Fatalf("attendance entry exposed internal identifiers: %s", encoded)
	}
}

const (
	attendanceTestLeadID    = "11111111-1111-4111-8111-111111111111"
	attendanceTestSessionID = "22222222-2222-4222-8222-222222222222"
)

func TestAttendanceRequestValidationRequiresExactLeadAndSession(t *testing.T) {
	valid, err := (AttendanceRequest{
		ExpectedLeadID: attendanceTestLeadID,
		SendSessionID:  attendanceTestSessionID,
	}).Validate()
	if err != nil {
		t.Fatalf("validate attendance request: %v", err)
	}
	if valid.ExpectedLeadID != attendanceTestLeadID || valid.SendSessionID != attendanceTestSessionID {
		t.Fatalf("unexpected normalized attendance input: %+v", valid)
	}

	for _, request := range []AttendanceRequest{
		{SendSessionID: attendanceTestSessionID},
		{ExpectedLeadID: attendanceTestLeadID},
		{ExpectedLeadID: "unlinked", SendSessionID: attendanceTestSessionID},
		{ExpectedLeadID: attendanceTestLeadID, SendSessionID: "not-a-uuid"},
	} {
		if _, err := request.Validate(); err == nil {
			t.Fatalf("expected invalid attendance request to fail: %+v", request)
		}
	}
}

func TestParseAttendanceRequestUsesImmutableBrowserSnapshot(t *testing.T) {
	input, err := ParseAttendanceRequest(url.Values{
		"expectedLeadId": {attendanceTestLeadID},
		"sendSessionId":  {attendanceTestSessionID},
	})
	if err != nil {
		t.Fatalf("parse attendance query: %v", err)
	}
	if input.ExpectedLeadID != attendanceTestLeadID || input.SendSessionID != attendanceTestSessionID {
		t.Fatalf("unexpected parsed attendance input: %+v", input)
	}
}

func TestAttendanceRequiredErrorUsesConflictContract(t *testing.T) {
	request := httptest.NewRequest(http.MethodPost, "/v1/whatsapp/conversations/test/send-message", nil)
	recorder := httptest.NewRecorder()
	writeWhatsAppError(recorder, request, ErrAttendanceRequired)

	if recorder.Code != http.StatusConflict {
		t.Fatalf("expected HTTP 409, got %d", recorder.Code)
	}
	body := recorder.Body.String()
	if !strings.Contains(body, `"code":"whatsapp_attendance_required"`) ||
		!strings.Contains(body, "Confirme o início do atendimento") {
		t.Fatalf("unexpected attendance error response: %s", body)
	}
}

func TestAttendanceRepositoryKeepsLockOrderCutoffAndIdempotency(t *testing.T) {
	raw, err := os.ReadFile("attendance_operations.go")
	if err != nil {
		t.Fatalf("read attendance repository: %v", err)
	}
	source := string(raw)

	ordered := []string{
		"from public.whatsapp_sessions as ws",
		"from public.whatsapp_conversations as conversation",
		"from public.leads as l",
		"from public.whatsapp_conversation_lead_bindings as binding",
	}
	previous := -1
	for _, token := range ordered {
		position := strings.Index(source, token)
		if position < 0 {
			t.Fatalf("attendance scope is missing %q", token)
		}
		if position <= previous {
			t.Fatalf("attendance lock order changed before %q", token)
		}
		previous = position
	}

	for _, required := range []string{
		"lockAttendanceScope(ctx, tx, tenantContext, conversationID, input, false, false, false)",
		"lockAttendanceScope(ctx, tx, tenantContext, conversationID, input, true, true, true)",
		"ws.owner_user_id = $3::uuid",
		"conversation.session_id = $3::uuid",
		"conversation.lead_id = $4::uuid",
		"binding.active_to is null",
		"from public.whatsapp_webhook_routing_ingress_sequence",
		"case when is_called then last_value::bigint else 0::bigint end",
		"clock_timestamp()",
		"on conflict (organization_id, conversation_id, binding_id, session_id, user_id)",
		"'whatsapp_attendance_joined'",
		"'attendance_entry_id'",
		"'ingress_sequence_cutoff'",
	} {
		if !strings.Contains(source, required) {
			t.Fatalf("attendance repository is missing contract token %q", required)
		}
	}
}

func TestAttendanceReadDoesNotRequireSessionOwnership(t *testing.T) {
	raw, err := os.ReadFile("attendance_operations.go")
	if err != nil {
		t.Fatalf("read attendance repository: %v", err)
	}
	source := string(raw)

	if !strings.Contains(source,
		"lockAttendanceScope(ctx, tx, tenantContext, conversationID, input, false, false, false)") {
		t.Fatal("attendance GET must validate the card without requiring WhatsApp session ownership")
	}
	if !strings.Contains(source,
		"lockAttendanceScope(ctx, tx, tenantContext, conversationID, input, true, true, true)") {
		t.Fatal("attendance POST must continue requiring session ownership and a connected session")
	}
	if !strings.Contains(source,
		"and (not $4::boolean or ws.owner_user_id = $3::uuid)") {
		t.Fatal("session ownership must be conditional so managers can read attendance for visible cards")
	}
	if !strings.Contains(source, "IsoLevel:   pgx.RepeatableRead") ||
		!strings.Contains(source, "AccessMode: pgx.ReadOnly") {
		t.Fatal("attendance GET must use a consistent non-blocking read-only snapshot")
	}
}
