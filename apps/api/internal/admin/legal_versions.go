package admin

import (
	"crypto/sha256"
	_ "embed"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

const legalManifestSchema = "vimob/legal-consent/v1"

//go:embed legal_documents.json
var legalDocumentsJSON []byte

type legalDocumentList struct {
	Type  string   `json:"type"`
	Items []string `json:"items"`
}

type legalDocumentSection struct {
	Title      string             `json:"title"`
	Paragraphs []string           `json:"paragraphs"`
	List       *legalDocumentList `json:"list,omitempty"`
}

type legalDocument struct {
	Kind          string                 `json:"kind"`
	Title         string                 `json:"title"`
	Eyebrow       string                 `json:"eyebrow"`
	Version       string                 `json:"version"`
	EffectiveDate string                 `json:"effectiveDate"`
	Fingerprint   string                 `json:"fingerprint"`
	Introduction  []string               `json:"introduction"`
	Sections      []legalDocumentSection `json:"sections"`
}

type legalDocumentContent struct {
	Kind         string                 `json:"kind"`
	Title        string                 `json:"title"`
	Eyebrow      string                 `json:"eyebrow"`
	Introduction []string               `json:"introduction"`
	Sections     []legalDocumentSection `json:"sections"`
}

type legalDocumentsManifest struct {
	Terms   legalDocument `json:"terms"`
	Privacy legalDocument `json:"privacy"`
}

var currentLegalDocuments = mustLoadLegalDocuments(legalDocumentsJSON)
var currentTermsVersion = currentLegalDocuments.Terms.Version
var currentPrivacyVersion = currentLegalDocuments.Privacy.Version

func mustLoadLegalDocuments(raw []byte) legalDocumentsManifest {
	var manifest legalDocumentsManifest
	if err := json.Unmarshal(raw, &manifest); err != nil {
		panic(fmt.Sprintf("decode embedded legal manifest: %v", err))
	}
	if err := validateLegalDocument("terms", manifest.Terms); err != nil {
		panic(err)
	}
	if err := validateLegalDocument("privacy", manifest.Privacy); err != nil {
		panic(err)
	}
	return manifest
}

func validateLegalDocument(expectedKind string, document legalDocument) error {
	if document.Kind != expectedKind {
		return fmt.Errorf("legal document %s has kind %q", expectedKind, document.Kind)
	}
	if strings.TrimSpace(document.Title) == "" || len(document.Introduction) == 0 || len(document.Sections) == 0 {
		return fmt.Errorf("legal document %s is incomplete", expectedKind)
	}
	if _, err := time.Parse("2006-01-02", document.EffectiveDate); err != nil {
		return fmt.Errorf("legal document %s has invalid effective date: %w", expectedKind, err)
	}

	canonical, err := json.Marshal(legalDocumentContent{
		Kind:         document.Kind,
		Title:        document.Title,
		Eyebrow:      document.Eyebrow,
		Introduction: document.Introduction,
		Sections:     document.Sections,
	})
	if err != nil {
		return fmt.Errorf("encode legal document %s content: %w", expectedKind, err)
	}
	sum := sha256.Sum256(canonical)
	digest := hex.EncodeToString(sum[:])
	expectedFingerprint := "sha256:" + digest
	if document.Fingerprint != expectedFingerprint {
		return fmt.Errorf("legal document %s fingerprint mismatch", expectedKind)
	}
	expectedVersion := document.EffectiveDate + "+sha256-" + digest[:12]
	if document.Version != expectedVersion {
		return fmt.Errorf("legal document %s version must bind its effective date and fingerprint", expectedKind)
	}
	return nil
}

func currentLegalConsentEvidence() map[string]any {
	return map[string]any{
		"schema":  legalManifestSchema,
		"terms":   currentLegalDocuments.Terms,
		"privacy": currentLegalDocuments.Privacy,
	}
}
