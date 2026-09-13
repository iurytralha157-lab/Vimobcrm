package main

import (
	"context"
	"fmt"
	"os"
	"time"

	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

// This command intentionally uses the same read-only connection guard as the
// local real-data runner. It only reports aggregate catalog coverage; it never
// returns customer or property identifiers.
func main() {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		fmt.Fprintln(os.Stderr, "DATABASE_URL não foi informada para a auditoria somente leitura.")
		os.Exit(1)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	postgres, err := dbpkg.NewPostgres(ctx, dbpkg.Config{
		URL:           databaseURL,
		MaxConns:      1,
		MinConns:      0,
		ForceReadOnly: true,
		HealthTimeout: 10 * time.Second,
	})
	if err != nil {
		fmt.Fprintln(os.Stderr, "Não foi possível preparar a auditoria somente leitura.")
		os.Exit(1)
	}
	defer postgres.Close()

	var readOnly string
	if err := postgres.Pool().QueryRow(ctx, "show default_transaction_read_only").Scan(&readOnly); err != nil || readOnly != "on" {
		fmt.Fprintln(os.Stderr, "A auditoria recusou uma conexão que não está em modo somente leitura.")
		os.Exit(1)
	}

	rows, err := postgres.Pool().Query(ctx, `
		with organizations as (
			select organization_id from public.properties
			union select organization_id from public.property_cities
			union select organization_id from public.property_neighborhoods
			union select organization_id from public.property_condominiums
		), coverage as (
			select
				o.organization_id,
				(select count(*) from public.properties p where p.organization_id = o.organization_id) as properties,
				(select count(distinct lower(btrim(p.cidade))) from public.properties p where p.organization_id = o.organization_id and nullif(btrim(p.cidade), '') is not null) as property_cities,
				(select count(distinct lower(btrim(p.bairro))) from public.properties p where p.organization_id = o.organization_id and nullif(btrim(p.bairro), '') is not null) as property_neighborhoods,
				(select count(*) from public.property_cities c where c.organization_id = o.organization_id and coalesce(c.is_active, true)) as catalog_cities,
				(select count(*) from public.property_neighborhoods n where n.organization_id = o.organization_id and coalesce(n.is_active, true)) as catalog_neighborhoods,
				(select count(*) from public.property_condominiums c where c.organization_id = o.organization_id and coalesce(c.is_active, true)) as catalog_condominiums
			from organizations o
		)
		select
			count(*) as organizations,
			count(*) filter (where properties > 0) as organizations_with_properties,
			count(*) filter (where property_cities > 0 and catalog_cities = 0) as organizations_with_unlisted_cities,
			count(*) filter (where property_neighborhoods > 0 and catalog_neighborhoods = 0) as organizations_with_unlisted_neighborhoods,
			coalesce(sum(properties), 0) as properties,
			coalesce(sum(property_cities), 0) as distinct_property_cities,
			coalesce(sum(property_neighborhoods), 0) as distinct_property_neighborhoods,
			coalesce(sum(catalog_cities), 0) as catalog_cities,
			coalesce(sum(catalog_neighborhoods), 0) as catalog_neighborhoods,
			coalesce(sum(catalog_condominiums), 0) as catalog_condominiums
		from coverage
	`)
	if err != nil {
		fmt.Fprintln(os.Stderr, "Não foi possível consultar a cobertura da carteira.")
		os.Exit(1)
	}
	defer rows.Close()

	if !rows.Next() {
		fmt.Println("Auditoria de imóveis: sem linhas de cobertura.")
		return
	}
	var organizations, withProperties, unlistedCities, unlistedNeighborhoods int64
	var properties, propertyCities, propertyNeighborhoods, catalogCities, catalogNeighborhoods, catalogCondominiums int64
	if err := rows.Scan(
		&organizations, &withProperties, &unlistedCities, &unlistedNeighborhoods,
		&properties, &propertyCities, &propertyNeighborhoods,
		&catalogCities, &catalogNeighborhoods, &catalogCondominiums,
	); err != nil {
		fmt.Fprintln(os.Stderr, "Não foi possível ler a cobertura da carteira.")
		os.Exit(1)
	}
	if err := rows.Err(); err != nil {
		fmt.Fprintln(os.Stderr, "A auditoria de imóveis foi interrompida.")
		os.Exit(1)
	}

	fmt.Printf("organizações=%d organizações_com_imóveis=%d imóveis=%d cidades_distintas_na_carteira=%d bairros_distintos_na_carteira=%d cidades_catalogadas=%d bairros_catalogados=%d condomínios_catalogados=%d organizações_com_cidades_não_catalogadas=%d organizações_com_bairros_não_catalogados=%d\n",
		organizations, withProperties, properties, propertyCities, propertyNeighborhoods,
		catalogCities, catalogNeighborhoods, catalogCondominiums, unlistedCities, unlistedNeighborhoods,
	)
}
