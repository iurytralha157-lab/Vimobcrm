package admin

import (
	"errors"
	"os"
	"strings"
	"testing"
	"time"
)

const (
	testRecoveryAttemptID      = "0f5ecbd9-c8c9-490c-b70a-3beb8ef44d6f"
	testRecoveryUserID         = "0d331d3d-0c5e-4fe0-ac6f-61e6c35c6154"
	testRecoveryOrganizationID = "f46ce055-0b0a-480a-b956-8eaa2c16a5cd"
)

func TestPublicSignupRecoveryCapabilityIsSignedExactAndExpiring(t *testing.T) {
	t.Parallel()
	repo := NewRepository(nil, ExternalConfig{
		Environment:          "test",
		SignupRecoverySecret: "test-only-public-signup-recovery-secret-32-bytes",
	})
	capability, err := repo.issuePublicSignupRecoveryCapability(
		testRecoveryAttemptID,
		testRecoveryUserID,
		testRecoveryOrganizationID,
		"Admin@Example.com",
	)
	if err != nil {
		t.Fatalf("issue recovery capability: %v", err)
	}
	claims, err := repo.verifyPublicSignupRecoveryCapability(capability, time.Now().UTC())
	if err != nil {
		t.Fatalf("verify recovery capability: %v", err)
	}
	if claims.AttemptID != testRecoveryAttemptID || claims.AuthUserID != testRecoveryUserID || claims.OrganizationID != testRecoveryOrganizationID {
		t.Fatalf("capability is not bound to the exact signup tuple: %#v", claims)
	}
	if claims.EmailHash != sha256Hex("admin@example.com") {
		t.Fatalf("capability e-mail hash = %q", claims.EmailHash)
	}

	replacement := "A"
	if strings.HasSuffix(capability, replacement) {
		replacement = "B"
	}
	tampered := capability[:len(capability)-1] + replacement
	if _, err := repo.verifyPublicSignupRecoveryCapability(tampered, time.Now().UTC()); !errors.Is(err, ErrPublicSignupRecoveryUnavailable) {
		t.Fatalf("tampered capability accepted: %v", err)
	}
	if _, err := repo.verifyPublicSignupRecoveryCapability(capability, time.Now().UTC().Add(3*time.Hour)); !errors.Is(err, ErrPublicSignupRecoveryUnavailable) {
		t.Fatalf("expired capability accepted: %v", err)
	}
}

func TestPublicSignupRecoveryOperationIsBoundToActionAndDestination(t *testing.T) {
	t.Parallel()
	capability := "v1.payload.signature"
	correct := publicSignupRecoveryOperationHash(capability, publicSignupRecoveryActionCorrect, "new@example.com")
	if correct == publicSignupRecoveryOperationHash(capability, publicSignupRecoveryActionCorrect, "other@example.com") {
		t.Fatal("operation hash must bind the corrected e-mail")
	}
	if correct == publicSignupRecoveryOperationHash(capability, publicSignupRecoveryActionCancel, "new@example.com") {
		t.Fatal("operation hash must bind the recovery action")
	}
}

func TestCancelledSignupRetryAcceptsOnlyTheSameDeterministicTombstone(t *testing.T) {
	t.Parallel()
	operationHash := sha256Hex("exact-recovery-operation")
	tombstone := publicSignupCancellationTombstone(operationHash)
	if !publicSignupRecoveryAuthEmailAllowed(
		publicSignupRecoveryActionCancel,
		tombstone,
		"old@example.com",
		"old@example.com",
		operationHash,
	) {
		t.Fatal("a retry after Auth tombstoning must resume the exact cancellation")
	}
	if publicSignupRecoveryAuthEmailAllowed(
		publicSignupRecoveryActionCancel,
		"cancelled-attacker@invalid.vimob.local",
		"old@example.com",
		"old@example.com",
		operationHash,
	) {
		t.Fatal("a different tombstone must not be adopted")
	}
}

func TestPublicSignupRecoveryPersistsCheckoutFreezeForExactRetry(t *testing.T) {
	t.Parallel()
	raw, err := os.ReadFile("onboarding_recovery.go")
	if err != nil {
		t.Fatalf("read onboarding recovery source: %v", err)
	}
	source := string(raw)
	for _, contract := range []string{
		"for update",
		"status = 'recovering'",
		"recovery_token_hash = $3",
		"update public.organization_checkout_capabilities",
		"state.CheckoutToken = rotatedToken",
		"recoveryTokenHash.String != operationHash",
		"operationExpiresAt := capabilityExpiresAt",
	} {
		if !strings.Contains(source, contract) {
			t.Fatalf("recovery crash-window contract missing %q", contract)
		}
	}
	rotate := strings.Index(source, "update public.organization_checkout_capabilities")
	eligibility := strings.Index(source, "assertPublicSignupRecoveryEligibility")
	if eligibility < 0 || rotate < 0 || eligibility > rotate {
		t.Fatal("checkout must be locked and eligibility checked before its token is rotated")
	}
}
