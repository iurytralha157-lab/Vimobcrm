package admin

import (
	"encoding/json"
	"errors"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/realtime"
)

func TestNormalizeInvitationExpiresAt(t *testing.T) {
	now := time.Date(2026, time.September, 5, 12, 0, 0, 0, time.UTC)

	got, err := normalizeInvitationExpiresAt(nil, now)
	if err != nil || got != nil {
		t.Fatalf("nil expiration = (%v, %v), want nil default", got, err)
	}

	future := "2026-09-06T15:30:00-03:00"
	got, err = normalizeInvitationExpiresAt(&future, now)
	if err != nil {
		t.Fatalf("normalize future expiration: %v", err)
	}
	want := time.Date(2026, time.September, 6, 18, 30, 0, 0, time.UTC)
	if got == nil || !got.Equal(want) || got.Location() != time.UTC {
		t.Fatalf("future expiration = %v, want %v UTC", got, want)
	}
	maximum := "2026-09-12T12:00:00Z"
	if _, err := normalizeInvitationExpiresAt(&maximum, now); err != nil {
		t.Fatalf("maximum seven-day expiration must be accepted: %v", err)
	}

	for _, invalid := range []string{
		"",
		"not-a-timestamp",
		"2026-09-05T12:00:00Z",
		"2026-09-04T12:00:00Z",
		"2026-09-12T12:00:01Z",
	} {
		invalid := invalid
		t.Run("reject_"+strings.ReplaceAll(invalid, ":", "_"), func(t *testing.T) {
			if _, err := normalizeInvitationExpiresAt(&invalid, now); !errors.Is(err, ErrInvalidInput) {
				t.Fatalf("normalizeInvitationExpiresAt(%q) error = %v, want ErrInvalidInput", invalid, err)
			}
		})
	}
}

func TestNormalizeInvitationEmailHasServerSideLengthLimit(t *testing.T) {
	got, err := normalizeEmail("  PERSON@EXAMPLE.COM ")
	if err != nil || got != "person@example.com" {
		t.Fatalf("normalized email = (%q, %v)", got, err)
	}

	oversized := strings.Repeat("a", 249) + "@x.com"
	if len(oversized) <= invitationEmailMaximumBytes {
		t.Fatal("test setup did not create an oversized address")
	}
	if _, err := normalizeEmail(oversized); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("oversized email error = %v, want ErrInvalidInput", err)
	}
}

func TestNormalizeInvitationTokenAcceptsOnlyCanonical256BitHex(t *testing.T) {
	valid := strings.Repeat("ab", 32)
	if got, ok := normalizeInvitationToken("  " + valid + "  "); !ok || got != valid {
		t.Fatalf("canonical token = (%q, %t), want %q", got, ok, valid)
	}

	for _, invalid := range []string{
		strings.ToUpper(valid),
		valid[:63],
		strings.Repeat("z", 64),
	} {
		if _, ok := normalizeInvitationToken(invalid); ok {
			t.Fatalf("non-canonical token %q was accepted", invalid)
		}
	}
}

func TestInvitationIdentityPoolSlotCapacityAlwaysReservesAConnection(t *testing.T) {
	tests := []struct {
		maxConns int32
		want     int
	}{
		{maxConns: 0, want: 0},
		{maxConns: 1, want: 0},
		{maxConns: 2, want: 1},
		{maxConns: 3, want: 2},
		{maxConns: 8, want: 2},
	}
	for _, test := range tests {
		if got := invitationIdentityPoolSlotCapacity(test.maxConns); got != test.want {
			t.Fatalf("capacity for MaxConns=%d = %d, want %d", test.maxConns, got, test.want)
		}
	}
}

func TestInvitationCapabilityResponsesDisableCaching(t *testing.T) {
	recorder := httptest.NewRecorder()
	setInvitationCapabilityResponseHeaders(recorder)

	if got := recorder.Header().Get("Cache-Control"); got != "private, no-store" {
		t.Fatalf("Cache-Control = %q", got)
	}
	if got := recorder.Header().Get("Pragma"); got != "no-cache" {
		t.Fatalf("Pragma = %q", got)
	}
}

func TestAcceptInvitationResultDoesNotExposeInternalEventState(t *testing.T) {
	payload, err := json.Marshal(AcceptInvitationResult{
		Success:      true,
		TargetUserID: "11111111-1111-1111-1111-111111111111",
		AcceptedNow:  true,
	})
	if err != nil {
		t.Fatalf("marshal result: %v", err)
	}
	encoded := string(payload)
	for _, forbidden := range []string{"targetUserId", "target_user_id", "acceptedNow", "accepted_now"} {
		if strings.Contains(encoded, forbidden) {
			t.Fatalf("public response exposed internal field %q: %s", forbidden, encoded)
		}
	}
}

type recordingInvitationPublisher struct {
	events []realtime.Event
}

func (publisher *recordingInvitationPublisher) Publish(event realtime.Event) {
	publisher.events = append(publisher.events, event)
}

func TestPublishInvitationAcceptedUsesMinimalOrganizationWidePayload(t *testing.T) {
	publisher := &recordingInvitationPublisher{}
	handler := NewHandler(Repository{}, publisher)
	result := AcceptInvitationResult{
		Success:          true,
		OrganizationID:   "22222222-2222-2222-2222-222222222222",
		OrganizationName: "Sensitive organization name",
		Email:            "private@example.com",
		TargetUserID:     "33333333-3333-3333-3333-333333333333",
		AcceptedNow:      true,
	}

	handler.publishInvitationAccepted(result)

	if len(publisher.events) != 1 {
		t.Fatalf("published events = %d, want 1", len(publisher.events))
	}
	event := publisher.events[0]
	if event.Type != realtime.EventOrganizationUsersChanged {
		t.Fatalf("event type = %q", event.Type)
	}
	if event.OrganizationID != result.OrganizationID || event.UserID != result.TargetUserID {
		t.Fatalf("event tenant/actor mismatch: %#v", event)
	}
	if event.AudienceUserID != "" {
		t.Fatalf("organization-wide event must not have a private audience: %#v", event)
	}
	if len(event.Data) != 2 || event.Data["targetUserId"] != result.TargetUserID || event.Data["changeKind"] != "invitation_accepted" {
		t.Fatalf("event payload is not minimal/canonical: %#v", event.Data)
	}
	for _, sensitive := range []string{"email", "organizationName", "role", "token"} {
		if _, exists := event.Data[sensitive]; exists {
			t.Fatalf("event payload exposed %q: %#v", sensitive, event.Data)
		}
	}

	result.AcceptedNow = false
	handler.publishInvitationAccepted(result)
	if len(publisher.events) != 1 {
		t.Fatalf("idempotent replay republished an event: %#v", publisher.events)
	}
}

func TestInvitationCreationAndDeliverySourceContracts(t *testing.T) {
	create := invitationFunctionSource(t, "repository.go", "CreateInvitation")
	for _, required := range []string{
		"if request.Email == nil",
		"normalizeInvitationExpiresAt(request.ExpiresAt, time.Now())",
		"coalesce($5::timestamptz, now() + interval '7 days')",
		`item["email_status"] = "failed"`,
		`item["email_status"] = "delivery_unknown"`,
	} {
		if !strings.Contains(create, required) {
			t.Fatalf("CreateInvitation is missing %q", required)
		}
	}
	for _, required := range []string{
		"repo.acquireInvitationIdentityLock(ctx, normalizedEmail)",
		"repo.classifyInvitationIdentity(ctx, invitationID, normalizedEmail)",
		"existingAccount = identity.requiresLogin()",
	} {
		if !strings.Contains(create, required) {
			t.Fatalf("CreateInvitation is missing safe identity classification %q", required)
		}
	}
	createLockIndex := strings.Index(create, "repo.acquireInvitationIdentityLock(ctx, normalizedEmail)")
	createClassificationIndex := strings.Index(create, "repo.classifyInvitationIdentity(ctx, invitationID, normalizedEmail)")
	createInsertIndex := strings.Index(create, "insert into public.invitations")
	if createLockIndex == -1 || createClassificationIndex == -1 || createInsertIndex == -1 ||
		createLockIndex >= createClassificationIndex || createClassificationIndex >= createInsertIndex {
		t.Fatal("invitation creation must lock the e-mail before classification and insert")
	}

	resend := invitationFunctionSource(t, "repository.go", "ResendInvitation")
	for _, required := range []string{
		"repo.classifyInvitationIdentity(ctx, invitationID, normalizedEmail)",
		"existingAccount := identity.requiresLogin()",
	} {
		if !strings.Contains(resend, required) {
			t.Fatalf("ResendInvitation is missing safe identity classification %q", required)
		}
	}

	prepare := invitationFunctionSource(t, "invitation_email.go", "prepareInvitationEmailDelivery")
	for _, required := range []string{
		"select app_user.id",
		"from public.users app_user",
		"where app_user.id = $2::uuid",
	} {
		if !strings.Contains(prepare, required) {
			t.Fatalf("Auth-only invitation email logging is missing %q", required)
		}
	}
	if strings.Contains(prepare, "\n\t\t\t$2::uuid,\n") {
		t.Fatal("email log must not write an Auth-only user ID through the public.users foreign key")
	}
}

func TestInvitationAcceptanceReplayAndActivationSourceContracts(t *testing.T) {
	publicAcceptance := invitationFunctionSource(t, "invitation_accept.go", "AcceptInvitationPublic")
	for _, required := range []string{
		"repo.acquireInvitationIdentityLock(ctx, invitation.Email)",
		"lockedInvitation, err := repo.invitationByTokenForAccept(ctx, token)",
		"repo.classifyInvitationIdentity(ctx, invitation.ID, invitation.Email)",
		"repo.updateResumableInvitationAuthUser(",
		"repo.ensureInvitationProvisionalProfileInactive(",
		"invitationIdentityReconciliationContext(ctx)",
	} {
		if !strings.Contains(publicAcceptance, required) {
			t.Fatalf("public invitation acceptance is missing safe resume step %q", required)
		}
	}
	lockIndex := strings.Index(publicAcceptance, "repo.acquireInvitationIdentityLock(ctx, invitation.Email)")
	lockedLookupIndex := strings.LastIndex(publicAcceptance, "repo.invitationByTokenForAccept(ctx, token)")
	classificationIndex := strings.Index(publicAcceptance, "repo.classifyInvitationIdentity(ctx, invitation.ID, invitation.Email)")
	authMutationIndex := strings.Index(publicAcceptance, "repo.updateResumableInvitationAuthUser(")
	if lockIndex == -1 || lockedLookupIndex == -1 || classificationIndex == -1 || authMutationIndex == -1 ||
		lockIndex >= lockedLookupIndex || lockedLookupIndex >= classificationIndex || classificationIndex >= authMutationIndex {
		t.Fatal("public acceptance must lock, re-read, classify, and only then mutate Auth")
	}

	lookup := invitationFunctionSource(t, "invitation_accept.go", "invitationByTokenForAccept")
	for _, required := range []string{
		"normalizeInvitationToken(token)",
		"i.used_at",
		"i.expires_at > now()",
	} {
		if !strings.Contains(lookup, required) {
			t.Fatalf("acceptance lookup is missing %q", required)
		}
	}
	if strings.Contains(lookup, "and i.used_at is null") {
		t.Fatal("acceptance lookup must allow a finite, evidence-backed replay of an already-used token")
	}

	replay := invitationFunctionSource(t, "invitation_accept.go", "committedInvitationAcceptance")
	if !strings.Contains(replay, "reconcileInvitationActivation") || !strings.Contains(replay, "evidence.committed()") {
		t.Fatalf("idempotent replay is not gated by durable activation evidence: %s", replay)
	}

	activation := invitationFunctionSource(t, "invitation_accept.go", "activateInvitationForUser")
	for _, required := range []string{
		"lockInvitationOwnedAuthIdentity(ctx, tx, invitation, userID)",
		"when public.organization_members.is_active = true",
		"and public.organization_members.deleted_at is null",
		"then public.organization_members.role",
		"else excluded.role",
	} {
		if !strings.Contains(activation, required) {
			t.Fatalf("membership upsert is missing active-role preservation guard %q", required)
		}
	}

	identityLock := invitationFunctionSource(t, "invitation_accept.go", "lockInvitationOwnedAuthIdentity")
	for _, required := range []string{
		"auth_user.raw_app_meta_data ->> 'provisioning_source' = 'admin_invitation'",
		"auth_user.raw_app_meta_data ->> 'invitation_id' = $3",
		"for update",
	} {
		if !strings.Contains(identityLock, required) {
			t.Fatalf("provisional invitation activation lock is missing %q", required)
		}
	}

	reconcile := invitationFunctionSource(t, "invitation_accept.go", "reconcileInvitationActivation")
	for _, required := range []string{
		"from public.legal_consents consent",
		"consent.user_id = $1::uuid",
		"consent.organization_id = $3::uuid",
		"consent.source = 'invitation'",
		"consent.metadata ->> 'invitation_id' = $2",
	} {
		if !strings.Contains(reconcile, required) {
			t.Fatalf("activation reconciliation is missing consent evidence %q", required)
		}
	}
}

func TestInvitationAcceptanceAndResendShareCrossReplicaIdentityLock(t *testing.T) {
	lock := invitationFunctionSource(t, "invitation_identity.go", "acquireInvitationIdentityLock")
	for _, required := range []string{
		"invitationIdentityLockPrefix + normalizedEmail",
		"pg_catalog.pg_try_advisory_lock(",
		"pg_catalog.pg_advisory_unlock(",
		"acquireInvitationIdentityPoolSlot(ctx, pool)",
		"closeInvitationIdentityLockConnection(connection)",
		"ErrInvitationInProgress",
	} {
		if !strings.Contains(lock, required) {
			t.Fatalf("invitation identity lock is missing %q", required)
		}
	}

	resend := invitationFunctionSource(t, "repository.go", "ResendInvitation")
	lockIndex := strings.Index(resend, "repo.acquireInvitationIdentityLock(ctx, normalizedEmail)")
	lockedReadIndex := strings.LastIndex(resend, "from public.invitations")
	tokenRotationIndex := strings.Index(resend, "newToken, err := randomInvitationToken()")
	if lockIndex == -1 || lockedReadIndex == -1 || tokenRotationIndex == -1 ||
		lockIndex >= lockedReadIndex || lockedReadIndex >= tokenRotationIndex {
		t.Fatal("resend must lock and re-read the invitation before rotating its token")
	}

	authenticated := invitationFunctionSource(t, "invitation_accept.go", "AcceptInvitationAuthenticated")
	authenticatedLockIndex := strings.Index(authenticated, "repo.acquireInvitationIdentityLock(ctx, invitation.Email)")
	authenticatedLockedLookupIndex := strings.LastIndex(authenticated, "repo.invitationByTokenForAccept(ctx, token)")
	authenticatedIdentityIndex := strings.Index(authenticated, "repo.userIdentity(ctx, userID)")
	if authenticatedLockIndex == -1 || authenticatedLockedLookupIndex == -1 || authenticatedIdentityIndex == -1 ||
		authenticatedLockIndex >= authenticatedLockedLookupIndex || authenticatedLockedLookupIndex >= authenticatedIdentityIndex {
		t.Fatal("authenticated acceptance must share the identity lock and re-read before activation")
	}
}

func TestInvitationAcceptanceHandlersPublishOnlyAfterRepositorySuccess(t *testing.T) {
	source, err := os.ReadFile("handler.go")
	if err != nil {
		t.Fatalf("read handler.go: %v", err)
	}
	text := strings.ReplaceAll(string(source), "\r\n", "\n")
	for _, functionName := range []string{"AcceptInvitationPublic", "AcceptInvitationAuthenticated"} {
		marker := "func (handler Handler) " + functionName + "("
		start := strings.Index(text, marker)
		if start < 0 {
			t.Fatalf("could not find %s", functionName)
		}
		rest := text[start+1:]
		end := strings.Index(rest, "\nfunc ")
		if end < 0 {
			t.Fatalf("could not isolate %s", functionName)
		}
		function := text[start : start+1+end]
		errorReturn := strings.Index(function, "writeAdminError(w, r, err)")
		publish := strings.Index(function, "handler.publishInvitationAccepted(result)")
		writeSuccess := strings.Index(function, "Envelope[AcceptInvitationResult]{Data: result}")
		if errorReturn < 0 || publish <= errorReturn || writeSuccess <= publish {
			t.Fatalf("%s must publish after repository success and before its response", functionName)
		}
	}
}

func TestInvitationActivationEvidenceRequiresExactConsent(t *testing.T) {
	withoutConsent := invitationActivationEvidence{
		AuthUserExists:      true,
		InvitationUsed:      true,
		MembershipExists:    true,
		PublicProfileExists: true,
	}
	if withoutConsent.committed() {
		t.Fatal("activation without invitation-bound legal consent must not reconcile as committed")
	}
	withoutConsent.LegalConsentExists = true
	if !withoutConsent.committed() {
		t.Fatal("complete durable activation evidence must reconcile as committed")
	}
}
