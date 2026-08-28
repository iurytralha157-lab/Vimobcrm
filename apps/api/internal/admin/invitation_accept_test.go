package admin

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/publicingress"
)

func TestInvitationIdentityLookupUsesCanonicalAuthIdentity(t *testing.T) {
	source, err := os.ReadFile("invitation_accept.go")
	if err != nil {
		t.Fatalf("read invitation acceptance source: %v", err)
	}

	text := string(source)
	lookupStart := strings.Index(text, "func (repo Repository) userIDByEmail(")
	identityStart := strings.Index(text, "func (repo Repository) userIdentity(")
	activationStart := strings.Index(text, "func (repo Repository) activateInvitationForUser(")
	if lookupStart < 0 || identityStart <= lookupStart || activationStart <= identityStart {
		t.Fatal("could not isolate invitation identity lookup functions")
	}

	lookup := text[lookupStart:identityStart]
	if !strings.Contains(lookup, "from auth.users") || !strings.Contains(lookup, "deleted_at is null") {
		t.Fatalf("userIDByEmail must resolve a live canonical Auth identity: %s", lookup)
	}
	if strings.Contains(lookup, "from public.users") {
		t.Fatalf("userIDByEmail must not classify public.users orphans as existing accounts: %s", lookup)
	}

	identity := text[identityStart:activationStart]
	if !strings.Contains(identity, "from auth.users") || !strings.Contains(identity, "left join public.users") {
		t.Fatalf("authenticated invitation acceptance must support Auth identities without a public profile: %s", identity)
	}
}

func TestInvitationPreviewUsesCanonicalAuthIdentity(t *testing.T) {
	source, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatalf("read admin repository source: %v", err)
	}

	text := string(source)
	previewStart := strings.Index(text, "func (repo Repository) ShowInvitationByToken(")
	nextFunction := strings.Index(text[previewStart+1:], "\nfunc (")
	if previewStart < 0 || nextFunction < 0 {
		t.Fatal("could not isolate ShowInvitationByToken")
	}
	preview := text[previewStart : previewStart+1+nextFunction]

	if !strings.Contains(preview, "from auth.users") || !strings.Contains(preview, "deleted_at is null") {
		t.Fatalf("invitation preview must resolve a live canonical Auth identity: %s", preview)
	}
	if strings.Contains(preview, "from public.users") {
		t.Fatalf("invitation preview must not classify public profile rows as canonical accounts: %s", preview)
	}
	if !strings.Contains(preview, "tokenHash := invitationTokenHash(token)") ||
		!strings.Contains(preview, "where i.token_hash = $1") ||
		strings.Contains(preview, "where i.token = $1") {
		t.Fatalf("invitation preview must compare only the SHA-256 token hash: %s", preview)
	}
}

func TestInvitationAcceptanceComparesOnlyTokenHash(t *testing.T) {
	source, err := os.ReadFile("invitation_accept.go")
	if err != nil {
		t.Fatalf("read invitation acceptance source: %v", err)
	}
	text := string(source)
	start := strings.Index(text, "func (repo Repository) invitationByTokenForAccept(")
	end := strings.Index(text[start+1:], "\nfunc (")
	if start < 0 || end < 0 {
		t.Fatal("could not isolate invitationByTokenForAccept")
	}
	lookup := text[start : start+1+end]
	if !strings.Contains(lookup, "tokenHash := invitationTokenHash(token)") ||
		!strings.Contains(lookup, "where i.token_hash = $1") ||
		strings.Contains(lookup, "where i.token = $1") {
		t.Fatalf("invitation acceptance must compare only the SHA-256 token hash: %s", lookup)
	}
}

type recordingInvitationConsentExecutor struct {
	query string
	args  []any
	err   error
}

func (executor *recordingInvitationConsentExecutor) Exec(
	_ context.Context,
	query string,
	args ...any,
) (pgconn.CommandTag, error) {
	executor.query = query
	executor.args = append([]any(nil), args...)
	return pgconn.NewCommandTag("INSERT 0 1"), executor.err
}

func TestInvitationAcceptanceRequestWithHTTPMetadataOverridesClientValues(t *testing.T) {
	resolver, err := publicingress.NewClientIPResolver([]string{"10.0.0.0/8"})
	if err != nil {
		t.Fatalf("create client IP resolver: %v", err)
	}

	httpRequest := httptest.NewRequest(http.MethodPost, "/v1/public/invitations/token/accept", nil)
	httpRequest.RemoteAddr = "10.0.0.10:443"
	httpRequest.Header.Set("X-Forwarded-For", "198.51.100.24")
	httpRequest.Header.Set("User-Agent", "Vimob invitation test/1.0")

	request := invitationAcceptanceRequestWithHTTPMetadata(AcceptInvitationRequest{
		IPAddress: "192.0.2.99",
		UserAgent: "spoofed client value",
	}, httpRequest, resolver)

	if request.IPAddress != "198.51.100.24" {
		t.Fatalf("IPAddress = %q, want trusted request IP", request.IPAddress)
	}
	if request.UserAgent != "Vimob invitation test/1.0" {
		t.Fatalf("UserAgent = %q, want HTTP User-Agent", request.UserAgent)
	}
}

func TestInvitationLegalConsentFromRequestUsesCanonicalDefaults(t *testing.T) {
	consent, err := invitationLegalConsentFromRequest(AcceptInvitationRequest{
		TermsAccepted:   true,
		PrivacyAccepted: true,
		TermsVersion:    invitationDefaultTermsVersion,
		PrivacyVersion:  invitationDefaultPrivacyVersion,
		IPAddress:       "::ffff:203.0.113.9",
		UserAgent:       "  Browser/1.0  ",
	})
	if err != nil {
		t.Fatalf("normalize invitation legal consent: %v", err)
	}

	if consent.TermsVersion != invitationDefaultTermsVersion {
		t.Fatalf("TermsVersion = %q, want %q", consent.TermsVersion, invitationDefaultTermsVersion)
	}
	if consent.PrivacyVersion != invitationDefaultPrivacyVersion {
		t.Fatalf("PrivacyVersion = %q, want %q", consent.PrivacyVersion, invitationDefaultPrivacyVersion)
	}
	if consent.IPAddress != "203.0.113.9" {
		t.Fatalf("IPAddress = %q, want normalized address", consent.IPAddress)
	}
	if consent.UserAgent != "Browser/1.0" {
		t.Fatalf("UserAgent = %q, want trimmed value", consent.UserAgent)
	}
}

func TestInvitationLegalConsentFromRequestRejectsInvalidAcceptance(t *testing.T) {
	tests := []struct {
		name    string
		request AcceptInvitationRequest
	}{
		{
			name: "missing terms acceptance",
			request: AcceptInvitationRequest{
				PrivacyAccepted: true,
			},
		},
		{
			name: "oversized legal version",
			request: AcceptInvitationRequest{
				TermsAccepted:   true,
				PrivacyAccepted: true,
				TermsVersion:    strings.Repeat("v", 41),
			},
		},
		{
			name: "missing legal versions",
			request: AcceptInvitationRequest{
				TermsAccepted:   true,
				PrivacyAccepted: true,
			},
		},
		{
			name: "stale legal versions",
			request: AcceptInvitationRequest{
				TermsAccepted:   true,
				PrivacyAccepted: true,
				TermsVersion:    "2025-01-01",
				PrivacyVersion:  "2025-01-01",
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := invitationLegalConsentFromRequest(test.request)
			if !errors.Is(err, ErrInvalidInput) {
				t.Fatalf("error = %v, want ErrInvalidInput", err)
			}
		})
	}
}

func TestInvitationNewAccountFieldsHaveBoundedValidation(t *testing.T) {
	t.Parallel()

	if !isValidInvitationName("Maria Gestora") {
		t.Fatal("expected a normal invitation name to be valid")
	}
	for _, name := range []string{"", "A", strings.Repeat("A", 141)} {
		if isValidInvitationName(name) {
			t.Fatalf("expected invitation name %q to be rejected", name)
		}
	}

	validWhatsApp := "+55 (22) 99999-1234"
	if !isValidInvitationWhatsApp(&validWhatsApp) {
		t.Fatal("expected a formatted WhatsApp to be valid")
	}
	for _, whatsapp := range []string{"123", "+55 abc", strings.Repeat("1", 41)} {
		value := whatsapp
		if isValidInvitationWhatsApp(&value) {
			t.Fatalf("expected invitation WhatsApp %q to be rejected", whatsapp)
		}
	}
}

func TestInsertInvitationLegalConsentRecordsInvitationEvidence(t *testing.T) {
	executor := &recordingInvitationConsentExecutor{}
	invitation := invitationRecord{
		ID:             "11111111-1111-1111-1111-111111111111",
		OrganizationID: "22222222-2222-2222-2222-222222222222",
	}
	consent := invitationLegalConsent{
		TermsVersion:    "2026-06-15",
		PrivacyVersion:  "2026-06-15",
		IPAddress:       "203.0.113.20",
		UserAgent:       "Browser/1.0",
		TermsAccepted:   true,
		PrivacyAccepted: true,
	}

	err := insertInvitationLegalConsent(
		context.Background(),
		executor,
		invitation,
		"33333333-3333-3333-3333-333333333333",
		consent,
	)
	if err != nil {
		t.Fatalf("insert invitation consent: %v", err)
	}
	if !strings.Contains(executor.query, "public.legal_consents") {
		t.Fatalf("query does not target legal_consents: %s", executor.query)
	}
	if !strings.Contains(executor.query, "'invitation'") {
		t.Fatalf("query does not use invitation source: %s", executor.query)
	}
	if len(executor.args) != 7 {
		t.Fatalf("argument count = %d, want 7", len(executor.args))
	}
	if got := executor.args[0]; got != "33333333-3333-3333-3333-333333333333" {
		t.Fatalf("user ID argument = %v", got)
	}
	if got := executor.args[1]; got != invitation.OrganizationID {
		t.Fatalf("organization ID argument = %v", got)
	}

	var metadata map[string]any
	if err := json.Unmarshal([]byte(executor.args[6].(string)), &metadata); err != nil {
		t.Fatalf("decode consent metadata: %v", err)
	}
	if metadata["invitation_id"] != invitation.ID {
		t.Fatalf("invitation_id metadata = %v", metadata["invitation_id"])
	}
	if metadata["terms_accepted"] != true || metadata["privacy_accepted"] != true {
		t.Fatalf("acceptance metadata = %#v", metadata)
	}
}

func TestRunInvitationActivationForNewAuthUserPreservesPrincipalAfterFailure(t *testing.T) {
	activationErr := errors.New("activation transaction failed")
	requestContext, cancelRequest := context.WithCancel(context.Background())
	cancelRequest()

	err := runInvitationActivationForNewAuthUser(
		requestContext,
		"44444444-4444-4444-4444-444444444444",
		func(ctx context.Context) error {
			if !errors.Is(ctx.Err(), context.Canceled) {
				t.Fatalf("activation context error = %v, want canceled request context", ctx.Err())
			}
			return activationErr
		},
		func(ctx context.Context) (invitationActivationEvidence, error) {
			if ctx.Err() != nil {
				t.Fatalf("reconciliation context must survive request cancellation: %v", ctx.Err())
			}
			return invitationActivationEvidence{AuthUserExists: true}, nil
		},
	)

	if !errors.Is(err, activationErr) {
		t.Fatalf("error = %v, want activation error", err)
	}
}

func TestRunInvitationActivationForNewAuthUserReportsReconciliationFailure(t *testing.T) {
	activationErr := errors.New("activation transaction failed")
	reconciliationErr := errors.New("reconciliation failed")

	err := runInvitationActivationForNewAuthUser(
		context.Background(),
		"55555555-5555-5555-5555-555555555555",
		func(context.Context) error { return activationErr },
		func(context.Context) (invitationActivationEvidence, error) {
			return invitationActivationEvidence{}, reconciliationErr
		},
	)

	if !errors.Is(err, activationErr) {
		t.Fatalf("error = %v, want activation error", err)
	}
	if !errors.Is(err, reconciliationErr) {
		t.Fatalf("error = %v, want reconciliation error", err)
	}
}

func TestRunInvitationActivationForNewAuthUserDoesNotReconcileOnSuccess(t *testing.T) {
	err := runInvitationActivationForNewAuthUser(
		context.Background(),
		"66666666-6666-6666-6666-666666666666",
		func(context.Context) error { return nil },
		func(context.Context) (invitationActivationEvidence, error) {
			t.Fatal("reconciliation must not run after successful activation")
			return invitationActivationEvidence{}, nil
		},
	)

	if err != nil {
		t.Fatalf("activation error = %v", err)
	}
}

func TestRunInvitationActivationForNewAuthUserRecoversAmbiguousCommit(t *testing.T) {
	err := runInvitationActivationForNewAuthUser(
		context.Background(),
		"77777777-7777-7777-7777-777777777777",
		func(context.Context) error { return errors.New("commit result unknown") },
		func(context.Context) (invitationActivationEvidence, error) {
			return invitationActivationEvidence{
				AuthUserExists:      true,
				InvitationUsed:      true,
				MembershipExists:    true,
				PublicProfileExists: true,
			}, nil
		},
	)

	if err != nil {
		t.Fatalf("committed activation must be recovered as success: %v", err)
	}
}

func TestRunInvitationActivationForNewAuthUserPreservesAuthWhenReconciliationIsUncertain(t *testing.T) {
	activationErr := errors.New("commit result unknown")
	reconciliationErr := errors.New("database unavailable")
	err := runInvitationActivationForNewAuthUser(
		context.Background(),
		"88888888-8888-8888-8888-888888888888",
		func(context.Context) error { return activationErr },
		func(context.Context) (invitationActivationEvidence, error) {
			return invitationActivationEvidence{}, reconciliationErr
		},
	)

	if !errors.Is(err, activationErr) || !errors.Is(err, reconciliationErr) {
		t.Fatalf("error = %v, want activation and reconciliation evidence errors", err)
	}
}

func TestRunInvitationActivationForNewAuthUserNeverDeletesAfterUnknownCommit(t *testing.T) {
	commitErr := errors.Join(
		errInvitationActivationCommitUnknown,
		errors.New("connection lost while committing"),
	)
	err := runInvitationActivationForNewAuthUser(
		context.Background(),
		"99999999-9999-9999-9999-999999999999",
		func(context.Context) error { return commitErr },
		func(context.Context) (invitationActivationEvidence, error) {
			return invitationActivationEvidence{AuthUserExists: true}, nil
		},
	)

	if !errors.Is(err, errInvitationActivationCommitUnknown) {
		t.Fatalf("error = %v, want unknown commit outcome", err)
	}
}

func TestMemberRoleFromInvitationPreservesManager(t *testing.T) {
	t.Parallel()

	for input, expected := range map[string]string{
		"admin":   "admin",
		"manager": "manager",
		"user":    "user",
		"unknown": "user",
	} {
		if actual := memberRoleFromInvitation(input); actual != expected {
			t.Fatalf("memberRoleFromInvitation(%q) = %q, want %q", input, actual, expected)
		}
	}
}
