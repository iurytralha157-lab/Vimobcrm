package properties

import (
	"strings"
	"testing"
)

func TestPropertySearchClauseUsesTheIndexedSearchDocument(t *testing.T) {
	clause := propertySearchClause(7, false)

	if count := strings.Count(strings.ToLower(clause), " like $7"); count != 2 {
		t.Fatalf("property search must have one indexed property branch and one condominium branch, got %d: %s", count, clause)
	}
	for _, field := range []string{
		"p.code",
		"p.title",
		"p.endereco",
		"p.bairro",
		"p.cidade",
		"p.uf",
		"p.tipo",
		"p.tipo_de_imovel",
		"p.finalidade",
		"p.finalidade_uso",
	} {
		if !strings.Contains(clause, field) {
			t.Fatalf("indexed property search document is missing %q: %s", field, clause)
		}
	}
	if strings.Contains(clause, "p.external_id") {
		t.Fatalf("non-manager search must not reveal internal external identifiers: %s", clause)
	}
	if !strings.Contains(clause, "from public.property_condominiums co") || !strings.Contains(clause, "co.name") {
		t.Fatalf("property search must preserve condominium-name lookup: %s", clause)
	}
}

func TestPropertySearchClauseIncludesInternalIdentifiersOnlyForManagers(t *testing.T) {
	clause := propertySearchClause(7, true)
	if !strings.Contains(clause, "p.external_id") {
		t.Fatalf("manager search must preserve external identifier lookup: %s", clause)
	}
	if count := strings.Count(strings.ToLower(clause), " like $7"); count != 3 {
		t.Fatalf("manager search must have public, internal and condominium branches, got %d: %s", count, clause)
	}
}

func TestOwnerSearchSQLMatchesItsTrigramDocuments(t *testing.T) {
	clause := propertyOwnerSearchClause("po", "$7", "$5")
	nameExpression := "lower(coalesce(po.name, '')) like '%' || lower($7::text) || '%'"
	contactFields := []string{
		"coalesce(po.phone_residential, '')",
		"coalesce(po.phone_commercial, '')",
		"coalesce(po.cellphone, '')",
		"coalesce(po.email, '')",
		"coalesce(po.media_source, '')",
	}

	if !strings.Contains(clause, nameExpression) {
		t.Fatalf("owner name search does not match the trigram index expression")
	}
	for _, field := range contactFields {
		if !strings.Contains(clause, field) {
			t.Fatalf("owner contact search document is missing %q", field)
		}
	}
}

func TestDealTypeFilterUsesTheIndexedCanonicalColumnWithLegacyFallback(t *testing.T) {
	clause := dealTypeFilterClause()
	if !strings.Contains(clause, "lower(trim(coalesce(p.finalidade, ''))) = any($%[1]d::text[])") {
		t.Fatalf("deal-type filter must lead with the indexed canonical modality: %s", clause)
	}
	if !strings.Contains(clause, "trim(coalesce(p.finalidade, '')) = ''") ||
		!strings.Contains(clause, "lower(trim(coalesce(p.tipo_de_negocio, ''))) = any($%[1]d::text[])") {
		t.Fatalf("deal-type filter must preserve the empty-canonical legacy fallback: %s", clause)
	}
}
