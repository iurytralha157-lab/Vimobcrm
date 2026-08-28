package admin

import (
	"errors"
	"fmt"
	"os"
	"strings"
	"testing"
)

func TestInvitationEmailIdempotencyKey(t *testing.T) {
	tokenHash := "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
	key := invitationEmailIdempotencyKey(
		"11111111-1111-4111-8111-111111111111",
		tokenHash,
	)
	if key != "invitation/11111111-1111-4111-8111-111111111111/"+tokenHash {
		t.Fatalf("idempotency key = %q", key)
	}
	if invitationEmailIdempotencyKey("", "token") != "" {
		t.Fatal("empty invitation ID must disable the idempotency header")
	}
}

func TestInvitationEmailOutcomeClassificationKeepsAmbiguousTokenValid(t *testing.T) {
	t.Parallel()

	definitive := fmt.Errorf("%w: provider rejected request", errInvitationEmailDefinitelyNotAccepted)
	if !errors.Is(definitive, errInvitationEmailDefinitelyNotAccepted) {
		t.Fatal("definitive rejection must permit the guarded old-token restore")
	}
	if errors.Is(errors.New("request timeout after write"), errInvitationEmailDefinitelyNotAccepted) {
		t.Fatal("ambiguous transport errors must keep the newly emailed token valid")
	}
}

func TestInvitationEmailAmbiguousOutcomeRemainsObservableWithoutFalseFailure(t *testing.T) {
	t.Parallel()

	source, err := os.ReadFile("invitation_email.go")
	if err != nil {
		t.Fatalf("read invitation email source: %v", err)
	}
	text := string(source)
	start := strings.Index(text, "func (repo Repository) recordInvitationEmailOutcomeUnknownDetached(")
	end := strings.Index(text[start+1:], "\nfunc (")
	if start < 0 || end < 0 {
		t.Fatal("could not isolate ambiguous delivery persistence")
	}
	function := text[start : start+1+end]
	for _, required := range []string{
		"else 'processing'",
		"'phase', 'provider_outcome_unknown'",
		"status_event_at is not null or status = 'delivered'",
	} {
		if !strings.Contains(function, required) {
			t.Fatalf("ambiguous delivery persistence is missing %q", required)
		}
	}
}

func TestInvitationTokenHashIsDeterministicAndNeverPlaintext(t *testing.T) {
	first := invitationTokenHash("  secret-invitation-token  ")
	second := invitationTokenHash("secret-invitation-token")
	if first != second || len(first) != 64 {
		t.Fatalf("unexpected SHA-256 token hash: %q, %q", first, second)
	}
	if first == "secret-invitation-token" {
		t.Fatal("invitation credential must never be persisted as plaintext")
	}
	if invitationTokenHash("  ") != "" {
		t.Fatal("blank invitation token must not produce a usable hash")
	}
}

func TestInvitationEmailSendsResendIdempotencyHeader(t *testing.T) {
	source, err := os.ReadFile("invitation_email.go")
	if err != nil {
		t.Fatalf("read invitation email source: %v", err)
	}
	if !strings.Contains(string(source), `request.Header.Set("Idempotency-Key", idempotencyKey)`) {
		t.Fatal("invitation emails must send their deterministic Resend idempotency key")
	}
}

func TestInvitationEmailPersistsProviderAcceptanceBeforeReportingSent(t *testing.T) {
	source, err := os.ReadFile("invitation_email.go")
	if err != nil {
		t.Fatalf("read invitation email source: %v", err)
	}
	text := string(source)
	prepare := strings.Index(text, "repo.prepareInvitationEmailDelivery")
	providerCall := strings.Index(text, "repo.httpClient.Do(request)")
	accepted := strings.Index(text, "repo.recordInvitationEmailAccepted")
	if prepare < 0 || providerCall <= prepare || accepted <= providerCall {
		t.Fatalf("expected log preflight, provider call, then accepted-state persistence; indexes = %d, %d, %d", prepare, providerCall, accepted)
	}
	for _, required := range []string{
		"insert into public.email_logs",
		"provider_message_id = left(btrim($2), 255)",
		"accepted_at = coalesce(accepted_at, now())",
		`ID string ` + "`json:\"id\"`",
	} {
		if !strings.Contains(text, required) {
			t.Fatalf("invitation delivery observability is missing %q", required)
		}
	}
}

func TestInvitationEmailAcceptanceSerializesWithResendWebhook(t *testing.T) {
	source, err := os.ReadFile("invitation_email.go")
	if err != nil {
		t.Fatalf("read invitation email source: %v", err)
	}
	text := string(source)
	start := strings.Index(text, "func (repo Repository) recordInvitationEmailAccepted(")
	end := strings.Index(text[start+1:], "\nfunc (")
	if start < 0 || end < 0 {
		t.Fatal("could not isolate recordInvitationEmailAccepted")
	}
	function := text[start : start+1+end]

	lock := strings.Index(function, "pg_advisory_xact_lock")
	update := strings.Index(function, "update public.email_logs")
	commit := strings.Index(function, "tx.Commit(ctx)")
	if lock < 0 || update <= lock || commit <= update {
		t.Fatalf("provider acceptance must lock, update and commit in that order: %d, %d, %d", lock, update, commit)
	}
	if !strings.Contains(function, "'resend:' || left(btrim($1), 255)") {
		t.Fatal("API acceptance must use the same resend provider-message lock key as the webhook worker")
	}
}

func TestInvitationListExposesAcceptanceAndDeliveryEvidence(t *testing.T) {
	source, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatalf("read admin repository source: %v", err)
	}
	text := string(source)
	start := strings.Index(text, "func (repo Repository) ListInvitations(")
	end := strings.Index(text[start:], "func (repo Repository) CreateInvitation(")
	if start < 0 || end <= 0 {
		t.Fatal("could not isolate ListInvitations")
	}
	query := text[start : start+end]
	for _, required := range []string{
		"to_jsonb(i) - 'token' - 'token_hash'",
		"email_status",
		"email_accepted_at",
		"email_delivered_at",
		"i.used_at is null or i.used_at >= now() - interval '90 days'",
	} {
		if !strings.Contains(query, required) {
			t.Fatalf("invitation list is missing %q: %s", required, query)
		}
	}
}

func TestInvitationMutationResponsesNeverExposeCredentialMaterial(t *testing.T) {
	item := map[string]any{
		"id":         "11111111-1111-1111-1111-111111111111",
		"token":      "plaintext-secret",
		"token_hash": "hashed-secret",
	}
	stripInvitationToken(item)
	if _, exists := item["token"]; exists {
		t.Fatal("plaintext invitation token must not be returned")
	}
	if _, exists := item["token_hash"]; exists {
		t.Fatal("invitation token hash must not be returned")
	}

	source, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatalf("read admin repository source: %v", err)
	}
	text := string(source)
	for _, functionName := range []string{"CreateInvitation", "ResendInvitation"} {
		start := strings.Index(text, "func (repo Repository) "+functionName+"(")
		end := strings.Index(text[start+1:], "\nfunc (")
		if start < 0 || end < 0 {
			t.Fatalf("could not isolate %s", functionName)
		}
		function := text[start : start+1+end]
		if !strings.Contains(function, "token_hash") || !strings.Contains(function, "stripInvitationToken(item)") {
			t.Fatalf("%s must persist transition credentials and strip them from its response", functionName)
		}
		if !strings.Contains(function, "to_jsonb(invitations) - 'token' - 'token_hash'") {
			t.Fatalf("%s SQL response must remove plaintext and hash credentials", functionName)
		}
	}

	createStart := strings.Index(text, "func (repo Repository) CreateInvitation(")
	createEnd := strings.Index(text[createStart+1:], "\nfunc (")
	createFunction := text[createStart : createStart+1+createEnd]
	if !strings.Contains(createFunction, "plaintextToken, tokenHash") ||
		!strings.Contains(createFunction, "token,\n\t\t\ttoken_hash") {
		t.Fatal("CreateInvitation must write the same plaintext/hash pair during mixed-version rollout")
	}

	resendStart := strings.Index(text, "func (repo Repository) ResendInvitation(")
	resendEnd := strings.Index(text[resendStart+1:], "\nfunc (")
	resendFunction := text[resendStart : resendStart+1+resendEnd]
	for _, required := range []string{
		"set token = $2",
		"token_hash = $3",
		"and token = $4",
		"and token_hash = $5",
		"repo.restoreInvitationTokenPair(",
		"!errors.Is(sendErr, errInvitationEmailDefinitelyNotAccepted)",
		`item["email_status"] = "delivery_unknown"`,
	} {
		if !strings.Contains(resendFunction, required) {
			t.Fatalf("ResendInvitation mixed-version rotation is missing %q", required)
		}
	}
}

func TestResendFailureRestoresBothTransitionCredentials(t *testing.T) {
	source, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatalf("read admin repository source: %v", err)
	}
	text := string(source)
	start := strings.Index(text, "func (repo Repository) restoreInvitationTokenPair(")
	end := strings.Index(text[start+1:], "\nfunc ")
	if start < 0 || end < 0 {
		t.Fatal("could not isolate restoreInvitationTokenPair")
	}
	function := text[start : start+1+end]
	for _, required := range []string{
		"set token = $2",
		"token_hash = $3",
		"expires_at = $4",
		"and token = $5",
		"and token_hash = $6",
		"RowsAffected() != 1",
	} {
		if !strings.Contains(function, required) {
			t.Fatalf("token-pair rollback is missing %q", required)
		}
	}
}
