package site

import (
	"math"
	"net/url"
	"strings"
	"testing"
)

func TestParsePublicDecimalAcceptsLocalizedValues(t *testing.T) {
	tests := []struct {
		input string
		want  float64
	}{
		{input: "500000", want: 500000},
		{input: "500.000", want: 500000},
		{input: "500.000,00", want: 500000},
		{input: "R$ 500.000,00", want: 500000},
		{input: "1.234.567,89", want: 1234567.89},
		{input: "1,234,567.89", want: 1234567.89},
		{input: "12,50", want: 12.5},
		{input: "12.50", want: 12.5},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got, ok := parsePublicDecimal(tt.input)
			if !ok || math.Abs(got-tt.want) > 0.000001 {
				t.Fatalf("parsePublicDecimal(%q) = %v, %v; want %v, true", tt.input, got, ok, tt.want)
			}
		})
	}
}

func TestParsePublicDecimalRejectsMalformedValues(t *testing.T) {
	for _, input := range []string{"", "R$", "-1", "1e3", "1.23.45", "abc500"} {
		t.Run(input, func(t *testing.T) {
			if got, ok := parsePublicDecimal(input); ok {
				t.Fatalf("parsePublicDecimal(%q) = %v, true; want invalid", input, got)
			}
		})
	}
}

func TestAddPublicPriceRangeFilterUsesRentalPriceForRentalSearch(t *testing.T) {
	args := []any{"organization"}
	where := addPublicPriceRangeFilter(nil, url.Values{
		"finalidade": {"locacao"},
		"min_price":  {"R$ 3.000,00"},
		"max_price":  {"10.000"},
	}, &args)

	clause := where[len(where)-1]
	if strings.Contains(clause, "valor_venda") || strings.Contains(clause, "p.preco") {
		t.Fatalf("rental filter must not use sale price: %s", clause)
	}
	if !strings.Contains(clause, "valor_aluguel") || !strings.Contains(clause, "$2::numeric") || !strings.Contains(clause, "$3::numeric") {
		t.Fatalf("rental filter is missing its range: %s", clause)
	}
	if args[1] != float64(3000) || args[2] != float64(10000) {
		t.Fatalf("unexpected localized price args: %#v", args)
	}
}

func TestAddPublicPriceRangeFilterKeepsBoundsOnTheSameOffer(t *testing.T) {
	args := []any{"organization"}
	where := addPublicPriceRangeFilter(nil, url.Values{
		"min_price": {"100000"},
		"max_price": {"500000"},
	}, &args)

	clause := where[len(where)-1]
	if !strings.Contains(clause, "valor_venda") || !strings.Contains(clause, "valor_aluguel") {
		t.Fatalf("unscoped filter must consider both offer types: %s", clause)
	}
	if strings.Count(clause, "$2::numeric") != 2 || strings.Count(clause, "$3::numeric") != 2 {
		t.Fatalf("both bounds must be applied to each offer independently: %s", clause)
	}
	if !strings.Contains(clause, " and ") || !strings.Contains(clause, " or ") {
		t.Fatalf("expected grouped ranges joined by OR: %s", clause)
	}
}
