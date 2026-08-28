package admin

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestLegalManifestBindsVersionToContent(t *testing.T) {
	for name, document := range map[string]legalDocument{
		"terms":   currentLegalDocuments.Terms,
		"privacy": currentLegalDocuments.Privacy,
	} {
		t.Run(name, func(t *testing.T) {
			if err := validateLegalDocument(name, document); err != nil {
				t.Fatalf("validate embedded document: %v", err)
			}
			if !strings.HasPrefix(document.Version, document.EffectiveDate+"+sha256-") {
				t.Fatalf("version %q does not expose date and fingerprint", document.Version)
			}
		})
	}
}

func TestLegalManifestRejectsContentChangeWithoutFingerprintAndVersionBump(t *testing.T) {
	document := currentLegalDocuments.Terms
	document.Introduction = append([]string(nil), document.Introduction...)
	document.Introduction[0] += " Texto alterado sem nova versão."

	if err := validateLegalDocument("terms", document); err == nil {
		t.Fatal("expected stale fingerprint/version to reject altered legal content")
	}
}

func TestLegalConsentEvidenceContainsImmutableSnapshots(t *testing.T) {
	raw, err := json.Marshal(currentLegalConsentEvidence())
	if err != nil {
		t.Fatalf("marshal evidence: %v", err)
	}

	for _, expected := range []string{
		legalManifestSchema,
		currentTermsVersion,
		currentPrivacyVersion,
		currentLegalDocuments.Terms.Fingerprint,
		currentLegalDocuments.Privacy.Fingerprint,
		currentLegalDocuments.Terms.Introduction[0],
		currentLegalDocuments.Privacy.Introduction[0],
	} {
		if !strings.Contains(string(raw), expected) {
			t.Fatalf("legal evidence omitted %q", expected)
		}
	}
}
