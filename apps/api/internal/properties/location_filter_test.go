package properties

import (
	"net/url"
	"strings"
	"testing"
)

func TestLocationFiltersPreserveCatalogIdentityAndExactLegacyText(t *testing.T) {
	filter, err := ParseListFilter(url.Values{"city_id": {"11111111-1111-4111-8111-111111111111"}, "neighborhood_id": {"22222222-2222-4222-8222-222222222222"}, "uf": {"rs"}})
	if err != nil {
		t.Fatal(err)
	}
	args, where := addPropertyLocationFilters([]any{"organization"}, []string{"p.organization_id = $1::uuid"}, filter)
	sql := strings.Join(where, " and ")
	if len(args) != 3 || args[1] != filter.CityID || args[2] != filter.NeighborhoodID || !strings.Contains(sql, "selected_city.organization_id = p.organization_id") || !strings.Contains(sql, "p.city_id is null") || !strings.Contains(sql, "p.neighborhood_id is null") {
		t.Fatalf("location scope lost: %v / %s", args, sql)
	}
	args, where = addPropertyLocationFilters(nil, nil, ListFilter{City: "Santa Maria", Neighborhood: "Centro", UF: "RS"})
	if strings.Contains(strings.Join(where, " "), "like") || args[0] != "santa maria" || args[2] != "centro" {
		t.Fatalf("legacy selections must be exact: %v / %v", args, where)
	}
	for _, values := range []url.Values{{"city_id": {"bad"}}, {"neighborhood_id": {"bad"}}, {"uf": {"RSS"}}, {"uf": {"R1"}}} {
		if _, err := ParseListFilter(values); err == nil {
			t.Fatalf("accepted invalid location: %v", values)
		}
	}
}

func TestExplicitZeroMaximumIsNotAnAbsentBound(t *testing.T) {
	filter, err := ParseListFilter(url.Values{"valor_max": {"0"}, "area_util_max": {"0"}})
	if err != nil || !filter.PriceMaxProvided || !filter.UsableAreaMaxProvided {
		t.Fatalf("zero presence lost: %#v, %v", filter, err)
	}
	args, where := addPropertyPriceRangeFilter(nil, nil, "venda", filter.PriceMin, filter.PriceMax, filter.PriceMaxProvided)
	if len(args) != 1 || args[0] != float64(0) || !strings.Contains(strings.Join(where, " "), "p.preco <= $1::numeric") {
		t.Fatalf("zero max ignored: %v / %v", args, where)
	}
	if _, err := ParseListFilter(url.Values{"valor_min": {"1"}, "valor_max": {"0"}}); err == nil {
		t.Fatal("positive minimum above zero maximum accepted")
	}
}
