package properties

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"
)

func TestManagedTermsProjectionExposesSummaryWithoutMetadata(t *testing.T) {
	property := Property{
		"metadata": map[string]any{
			"condominio_isento": true,
			"iptu_isento":       true,
			"financing_mode":    "mcmv",
			"private_note":      "never expose",
		},
		"tipo_de_negocio":      "Venda",
		"aceita_financiamento": true,
	}
	attachPropertyManagedTerms(property)
	projected := projectWorkspaceProperty(property, false, false)

	if _, leaked := projected["metadata"]; leaked {
		t.Fatal("managed terms projection leaked metadata")
	}
	terms, ok := projected[propertyManagedTermsField].(propertyManagedTerms)
	if !ok {
		t.Fatalf("managed terms summary missing: %#v", projected)
	}
	if !terms.CondominiumExempt || !terms.PropertyTaxExempt || terms.FinancingMode != "mcmv" {
		t.Fatalf("unexpected managed terms summary: %#v", terms)
	}
}

func TestPolicyEditorCannotContradictExemptionsOrMCMV(t *testing.T) {
	input := propertyRequest{
		"condominio":           float64(850),
		"iptu":                 float64(275),
		"aceita_financiamento": false,
	}
	current := propertySnapshot{
		DealType:         "venda",
		AcceptsFinancing: true,
		Metadata: map[string]any{
			"condominio_isento": true,
			"iptu_isento":       true,
			"financing_mode":    "mcmv",
			"private_note":      "preserve",
		},
	}

	if err := enforcePropertyManagedTerms(input, current, false); err != nil {
		t.Fatal(err)
	}
	if input["condominio"] != nil || input["iptu"] != nil {
		t.Fatalf("exempt charges were not cleared: %#v", input)
	}
	if input["aceita_financiamento"] != true {
		t.Fatalf("MCMV financing was contradicted: %#v", input)
	}
	if _, rewroteMetadata := input["metadata"]; rewroteMetadata {
		t.Fatalf("MCMV policy edit unexpectedly rewrote manager metadata: %#v", input)
	}
}

func TestPolicyEditorFinancingChoiceUpdatesOnlyManagedMode(t *testing.T) {
	input := propertyRequest{"aceita_financiamento": false}
	current := propertySnapshot{
		DealType:         "venda",
		AcceptsFinancing: true,
		Metadata: map[string]any{
			"financing_mode": "sim",
			"private_note":   "preserve",
		},
	}

	if err := enforcePropertyManagedTerms(input, current, false); err != nil {
		t.Fatal(err)
	}
	var metadata map[string]any
	if err := json.Unmarshal([]byte(input["metadata"].(string)), &metadata); err != nil {
		t.Fatal(err)
	}
	if metadata["financing_mode"] != "nao" || len(metadata) != 1 {
		t.Fatalf("policy financing patch included more than the managed key: %#v", metadata)
	}
	merged := mergePropertyMetadata(current.Metadata, metadata)
	if merged["financing_mode"] != "nao" || merged["private_note"] != "preserve" {
		t.Fatalf("database-style metadata merge lost an existing key: %#v", merged)
	}
}

func TestManagerCanReplaceMCMVWithConsistentMode(t *testing.T) {
	input := propertyRequest{
		"aceita_financiamento": true,
		"metadata":             `{"financing_mode":"nao","private_note":"preserve"}`,
	}
	current := propertySnapshot{
		DealType:         "venda",
		AcceptsFinancing: true,
		Metadata:         map[string]any{"financing_mode": "mcmv"},
	}

	if err := enforcePropertyManagedTerms(input, current, true); err != nil {
		t.Fatal(err)
	}
	if input["aceita_financiamento"] != false {
		t.Fatalf("manager mode and canonical boolean diverged: %#v", input)
	}
}

func TestManagerPartialMetadataUsesCurrentTermsBeforeEnforcement(t *testing.T) {
	input := propertyRequest{
		"metadata":             `{"private_note":"changed"}`,
		"condominio":           float64(850),
		"iptu":                 float64(275),
		"aceita_financiamento": false,
	}
	current := propertySnapshot{
		DealType:             "venda",
		AcceptsFinancing:     true,
		HasCondominiumCharge: true,
		HasPropertyTaxCharge: true,
		Metadata: map[string]any{
			"condominio_isento": true,
			"iptu_isento":       true,
			"financing_mode":    "mcmv",
		},
	}

	if err := enforcePropertyManagedTerms(input, current, true); err != nil {
		t.Fatal(err)
	}
	if input["condominio"] != nil || input["iptu"] != nil || input["aceita_financiamento"] != true {
		t.Fatalf("partial metadata bypassed current managed terms: %#v", input)
	}
}

func TestCreateEnforcesAndValidatesManagedTerms(t *testing.T) {
	input := propertyRequest{
		"metadata":             `{"condominio_isento":true,"iptu_isento":true,"financing_mode":"mcmv"}`,
		"condominio":           float64(850),
		"iptu":                 float64(275),
		"aceita_financiamento": false,
	}
	if err := enforcePropertyManagedTerms(input, propertySnapshot{}, true); err != nil {
		t.Fatal(err)
	}
	if input["condominio"] != nil || input["iptu"] != nil || input["aceita_financiamento"] != true {
		t.Fatalf("create retained contradictory managed terms: %#v", input)
	}

	for _, metadata := range []string{
		`{"condominio_isento":"yes"}`,
		`{"condominio_isento":null}`,
		`{"iptu_isento":1}`,
		`{"iptu_isento":null}`,
		`{"financing_mode":"talvez"}`,
		`{"financing_mode":null}`,
	} {
		if err := enforcePropertyManagedTerms(
			propertyRequest{"metadata": metadata},
			propertySnapshot{},
			true,
		); err == nil {
			t.Fatalf("invalid managed metadata was accepted: %s", metadata)
		}
	}
}

func TestPropertyPayloadRejectsNonObjectMetadata(t *testing.T) {
	for _, metadata := range []any{nil, []any{}, "texto", float64(1), true} {
		if _, err := sanitizePayload(propertyRequest{"metadata": metadata}); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("metadata %#v: error = %v, want ErrInvalidInput", metadata, err)
		}
	}

	input, err := sanitizePayload(propertyRequest{"metadata": map[string]any{"private_note": "ok"}})
	if err != nil {
		t.Fatalf("object metadata was rejected: %v", err)
	}
	if input["metadata"] != `{"private_note":"ok"}` {
		t.Fatalf("object metadata was not normalized as JSON: %#v", input)
	}
}

func TestMetadataPatchRepairsLegacyNonObjectRows(t *testing.T) {
	assignments, _ := updateParts(propertyRequest{
		"metadata": `{"financing_mode":"nao"}`,
	}, 3)
	if len(assignments) != 1 {
		t.Fatalf("metadata update assignments = %#v", assignments)
	}
	for _, required := range []string{
		"jsonb_typeof(metadata) = 'object'",
		"else '{}'::jsonb",
		"|| $3::jsonb",
	} {
		if !strings.Contains(assignments[0], required) {
			t.Fatalf("metadata repair assignment is missing %q: %s", required, assignments[0])
		}
	}

	for _, legacy := range []any{nil, []any{"legacy"}, "legacy", float64(1)} {
		out := normalizePropertyOutput(Property{"metadata": legacy})
		metadata, ok := out["metadata"].(map[string]any)
		if !ok || len(metadata) != 0 {
			t.Fatalf("legacy metadata %#v was not safely projected as an object: %#v", legacy, out)
		}
	}
}

func TestUnrelatedUpdateDoesNotTouchConsistentFinancing(t *testing.T) {
	input := propertyRequest{"status": "active"}
	current := propertySnapshot{
		DealType:         "venda",
		AcceptsFinancing: true,
		Metadata:         map[string]any{"financing_mode": "sim"},
	}
	if err := enforcePropertyManagedTerms(input, current, false); err != nil {
		t.Fatal(err)
	}
	if _, exists := input["aceita_financiamento"]; exists {
		t.Fatalf("unrelated update touched financing: %#v", input)
	}
	if _, exists := input["metadata"]; exists {
		t.Fatalf("unrelated update touched metadata: %#v", input)
	}
}

func TestNullFinancingCannotBreakCanonicalManagedMode(t *testing.T) {
	input := propertyRequest{"aceita_financiamento": nil}
	current := propertySnapshot{
		DealType:         "venda",
		AcceptsFinancing: true,
		Metadata:         map[string]any{"financing_mode": "mcmv"},
	}
	if err := enforcePropertyManagedTerms(input, current, false); err != nil {
		t.Fatal(err)
	}
	if input["aceita_financiamento"] != true {
		t.Fatalf("null financing broke canonical MCMV state: %#v", input)
	}
}

func TestSeasonalPropertyAlwaysClearsPropertyTax(t *testing.T) {
	input := propertyRequest{"iptu": float64(150)}
	current := propertySnapshot{DealType: "temporada", Metadata: map[string]any{}}
	if err := enforcePropertyManagedTerms(input, current, false); err != nil {
		t.Fatal(err)
	}
	if input["iptu"] != nil {
		t.Fatalf("seasonal property retained property tax: %#v", input)
	}
}

func TestSanitizedCreateUsesDealTypeInsteadOfUsageForManagedTerms(t *testing.T) {
	input, err := sanitizePayload(propertyRequest{
		"tipo_de_negocio": "Temporada",
		"finalidade":      "Residencial",
		"iptu":            float64(275),
	})
	if err != nil {
		t.Fatal(err)
	}
	if input["finalidade"] != "temporada" || input["finalidade_uso"] != "Residencial" {
		t.Fatalf("deal type and usage were not separated during sanitization: %#v", input)
	}
	if err := enforcePropertyManagedTerms(input, propertySnapshot{}, true); err != nil {
		t.Fatal(err)
	}
	if input["iptu"] != nil {
		t.Fatalf("seasonal create retained property tax: %#v", input)
	}
}

func TestSanitizedUpdateToSeasonalClearsExistingPropertyTax(t *testing.T) {
	input, err := sanitizePayload(propertyRequest{"tipo_de_negocio": "Temporada"})
	if err != nil {
		t.Fatal(err)
	}
	current := propertySnapshot{
		DealType:             "venda",
		HasPropertyTaxCharge: true,
	}
	if err := enforcePropertyManagedTerms(input, current, false); err != nil {
		t.Fatal(err)
	}
	if input["iptu"] != nil {
		t.Fatalf("update to seasonal retained property tax: %#v", input)
	}
}
