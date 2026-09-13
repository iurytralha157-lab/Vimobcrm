package developments

import (
	"strings"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestPromotedPropertyStatusPreservesCommercialSafety(t *testing.T) {
	tests := map[string]string{
		"available":   "active",
		"negotiation": "active",
		"reserved":    "reserved",
		"sold":        "sold",
		"blocked":     "inactive",
		"unavailable": "inactive",
		"withdrawn":   "inactive",
	}
	for unitStatus, expected := range tests {
		if actual := promotedPropertyStatus(unitStatus); actual != expected {
			t.Fatalf("status %q promoted to %q, want %q", unitStatus, actual, expected)
		}
	}
}

func TestTerminalPropertyStatusesBlockUnlink(t *testing.T) {
	for _, status := range []string{
		"reserved", "reservado",
		"sold", "vendido", " SOLD ",
		"rented", "alugado", "locado",
	} {
		if !linkedPropertyStatusBlocksUnlink(status) {
			t.Fatalf("terminal property status %q did not block unlink", status)
		}
	}
	for _, status := range []string{"active", "inactive", "draft", "archived"} {
		if linkedPropertyStatusBlocksUnlink(status) {
			t.Fatalf("non-terminal property status %q unexpectedly blocked unlink", status)
		}
	}
}

func TestUnsafePropertyStatusesBlockLinkAcrossLegacyAliases(t *testing.T) {
	for _, status := range []string{
		"reserved", "reservado",
		"sold", "vendido",
		"rented", "alugado", "locado",
		"archived", "arquivado",
	} {
		if !linkedPropertyStatusBlocksLink(status) {
			t.Fatalf("unsafe property status %q did not block link", status)
		}
	}
	for _, status := range []string{"active", "ativo", "available", "disponivel", "inactive", "inativo", "draft", "rascunho"} {
		if linkedPropertyStatusBlocksLink(status) {
			t.Fatalf("eligible property status %q unexpectedly blocked link", status)
		}
	}
}

func TestClosedDevelopmentBlocksUnitPromotion(t *testing.T) {
	for _, state := range [][2]string{
		{"cancelled", "active"},
		{"archived", "active"},
		{"ready", "sold_out"},
		{"delivered", "closed"},
	} {
		if !developmentBlocksUnitPromotion(state[0], state[1]) {
			t.Fatalf("closed development state %#v did not block promotion", state)
		}
	}
	for _, state := range [][2]string{{"launched", "active"}, {"delivered", "active"}, {"suspended", "paused"}} {
		if developmentBlocksUnitPromotion(state[0], state[1]) {
			t.Fatalf("non-terminal development state %#v unexpectedly blocked promotion", state)
		}
	}
}

func TestPromotedPropertyPurposeFollowsDevelopmentAndFloorPlan(t *testing.T) {
	tests := []struct {
		developmentType string
		propertyType    string
		expected        string
	}{
		{developmentType: "commercial", propertyType: "Apartamento", expected: "Comercial"},
		{developmentType: "mixed_use", propertyType: "Sala Comercial", expected: "Comercial"},
		{developmentType: "vertical", propertyType: "Escritório", expected: "Comercial"},
		{developmentType: "vertical", propertyType: "Apartamento", expected: "Residencial"},
		{developmentType: "land_subdivision", propertyType: "Lote", expected: "Residencial"},
	}
	for _, test := range tests {
		if actual := promotedPropertyPurpose(test.developmentType, test.propertyType); actual != test.expected {
			t.Fatalf("purpose for (%q, %q) = %q, want %q", test.developmentType, test.propertyType, actual, test.expected)
		}
	}
}

func TestPromotedPropertyProjectionKeepsAddressPrivacyAndUniqueImages(t *testing.T) {
	visibility := map[string]string{
		"exact":       "completo",
		"approximate": "parcial",
		"hidden":      "minimo",
	}
	for source, expected := range visibility {
		if actual := promotedPropertyAddressVisibility(source); actual != expected {
			t.Fatalf("visibility %q = %q, want %q", source, actual, expected)
		}
	}

	developmentImage := " https://cdn.example.com/main.jpg "
	floorPlanImage := "https://cdn.example.com/floor-plan.jpg"
	mainImage := promotedPropertyMainImage(&floorPlanImage, &developmentImage)
	if mainImage == nil || *mainImage != floorPlanImage {
		t.Fatalf("floor-plan image was not preferred as main image: %#v", mainImage)
	}
	images := promotedPropertyImages(mainImage, &developmentImage, []string{
		"https://cdn.example.com/main.jpg",
		"",
		"https://cdn.example.com/second.jpg",
		"https://cdn.example.com/second.jpg",
	})
	if len(images) != 3 || images[0] != floorPlanImage || images[1] != "https://cdn.example.com/main.jpg" || images[2] != "https://cdn.example.com/second.jpg" {
		t.Fatalf("promoted images = %#v", images)
	}
}

func TestUnitPropertyIdempotencyHashIsStableAndDoesNotPersistRawKey(t *testing.T) {
	key := "ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDEF"
	first := unitPropertyIdempotencyKeyHash(key)
	second := unitPropertyIdempotencyKeyHash(strings.ToLower(key))
	if first != second {
		t.Fatalf("canonical forms produced different idempotency hashes: %s != %s", first, second)
	}
	if first == strings.ToLower(key) || strings.Contains(first, "abcdefab") || len(first) != 64 {
		t.Fatalf("idempotency hash exposes the raw key: %q", first)
	}
}

func TestUnitPropertyOperationRequiresManagerAndCanonicalIdentifiers(t *testing.T) {
	viewer := developmentTenantContext("viewer")
	if _, _, _, err := validateUnitPropertyOperation(viewer, testUUID, testUUID, testUUID); err == nil {
		t.Fatal("viewer unexpectedly received property-link mutation access")
	}

	manager := developmentTenantContext("admin")
	if _, _, _, err := validateUnitPropertyOperation(manager, testUUID, testUUID, "not-an-idempotency-uuid"); err == nil {
		t.Fatal("non-canonical idempotency key was accepted")
	}
}

func developmentTenantContext(role string) tenant.Context {
	return tenant.Context{
		OrganizationID: "33333333-3333-4333-8333-333333333333",
		UserID:         "44444444-4444-4444-8444-444444444444",
		MemberRole:     role,
	}
}
