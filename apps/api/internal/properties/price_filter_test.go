package properties

import (
	"net/url"
	"reflect"
	"testing"
)

func TestAddPropertyPriceRangeFilterKeepsBoundsOnTheSameOffer(t *testing.T) {
	args, where := addPropertyPriceRangeFilter(
		[]any{"organization"},
		[]string{"organization_filter"},
		"",
		100000,
		500000,
	)

	wantArgs := []any{"organization", float64(100000), float64(500000)}
	if !reflect.DeepEqual(args, wantArgs) {
		t.Fatalf("unexpected args: got %#v want %#v", args, wantArgs)
	}
	wantClause := "((p.preco >= $2::numeric and p.preco <= $3::numeric) or (p.valor_locacao >= $2::numeric and p.valor_locacao <= $3::numeric))"
	if got := where[len(where)-1]; got != wantClause {
		t.Fatalf("unexpected price clause:\n got: %s\nwant: %s", got, wantClause)
	}
}

func TestAddPropertyPriceRangeFilterUsesSelectedDealType(t *testing.T) {
	tests := []struct {
		name     string
		dealType string
		want     string
	}{
		{name: "sale", dealType: "venda", want: "(p.preco >= $1::numeric and p.preco <= $2::numeric)"},
		{name: "rental", dealType: "locacao", want: "(p.valor_locacao >= $1::numeric and p.valor_locacao <= $2::numeric)"},
		{name: "seasonal", dealType: "temporada", want: "(p.valor_locacao >= $1::numeric and p.valor_locacao <= $2::numeric)"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, where := addPropertyPriceRangeFilter(nil, nil, tt.dealType, 1000, 5000)
			if got := where[len(where)-1]; got != tt.want {
				t.Fatalf("unexpected price clause: got %s want %s", got, tt.want)
			}
		})
	}
}

func TestAddPropertyPriceRangeFilterSupportsSingleBound(t *testing.T) {
	args, where := addPropertyPriceRangeFilter(nil, nil, "venda_locacao", 0, 500000)
	if !reflect.DeepEqual(args, []any{float64(500000)}) {
		t.Fatalf("unexpected args: %#v", args)
	}
	wantClause := "((p.preco <= $1::numeric) or (p.valor_locacao <= $1::numeric))"
	if got := where[len(where)-1]; got != wantClause {
		t.Fatalf("unexpected price clause: got %s want %s", got, wantClause)
	}
}

func TestParseListFilterAcceptsLocalizedPriceValues(t *testing.T) {
	filter, err := ParseListFilter(url.Values{
		"valor_min": {"R$ 100.000,00"},
		"valor_max": {"500.000"},
	})
	if err != nil {
		t.Fatalf("ParseListFilter returned an error: %v", err)
	}
	if filter.PriceMin != 100000 || filter.PriceMax != 500000 {
		t.Fatalf("unexpected localized prices: min=%v max=%v", filter.PriceMin, filter.PriceMax)
	}
}
