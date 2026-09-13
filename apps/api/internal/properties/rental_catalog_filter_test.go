package properties

import (
	"reflect"
	"testing"
)

func TestRentalCatalogFilterIncludesLongTermAndSeasonalWithoutChangingWriteValidation(t *testing.T) {
	if got := normalizedDealTypeForFilter("rental_catalog"); got != "rental_catalog" {
		t.Fatalf("normalized rental catalog filter = %q", got)
	}

	want := append(dealTypeAliases("locacao"), dealTypeAliases("temporada")...)
	if got := dealTypeAliases("rental_catalog"); !reflect.DeepEqual(got, want) {
		t.Fatalf("rental catalog aliases = %#v, want %#v", got, want)
	}

	if _, err := normalizeDealType("rental_catalog"); err == nil {
		t.Fatal("rental_catalog must remain a read-only filter and never become a writable deal type")
	}
}

func TestLaunchAliasesStayOutOfSaleKPI(t *testing.T) {
	saleAliases := dealTypeAliases("venda")
	for _, launchAlias := range dealTypeAliases("lancamento") {
		for _, saleAlias := range saleAliases {
			if launchAlias == saleAlias {
				t.Fatalf("launch alias %q must not inflate the sale KPI", launchAlias)
			}
		}
	}
}
