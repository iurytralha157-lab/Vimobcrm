package properties

import (
	"fmt"
	"strings"
)

func propertyStatusAliases(status string) []string {
	switch status {
	case "active":
		return []string{"active", "ativo", "disponivel"}
	case "reserved":
		return []string{"reserved", "reservado"}
	case "sold":
		return []string{"sold", "vendido"}
	case "rented":
		return []string{"rented", "alugado", "locado"}
	case "inactive":
		return []string{"inactive", "inativo"}
	case "archived":
		return []string{"archived", "arquivado"}
	case "draft":
		return []string{"draft", "rascunho"}
	default:
		return []string{status}
	}
}

func addPropertyTypeFilter(args []any, where []string, propertyType string) ([]any, []string) {
	args = append(args, propertyType)
	exactIndex := len(args)

	if isHousePropertyType(propertyType) {
		args = append(args, housePropertyTypeAliases())
		aliasIndex := len(args)
		where = append(where, fmt.Sprintf(`(
			p.tipo = $%[1]d
			or p.tipo_de_imovel = $%[1]d
			or lower(trim(coalesce(p.tipo, ''))) = any($%[2]d::text[])
			or lower(trim(coalesce(p.tipo_de_imovel, ''))) = any($%[2]d::text[])
		)`, exactIndex, aliasIndex))
		return args, where
	}

	if !isCondominiumHousePropertyType(propertyType) {
		where = append(where, fmt.Sprintf("(p.tipo = $%[1]d or p.tipo_de_imovel = $%[1]d)", exactIndex))
		return args, where
	}

	args = append(args, condominiumHouseExplicitTypeAliases())
	explicitAliasIndex := len(args)
	args = append(args, condominiumHouseLinkedTypeAliases())
	linkedAliasIndex := len(args)
	where = append(where, fmt.Sprintf(`(
		p.tipo = $%[1]d
		or p.tipo_de_imovel = $%[1]d
		or lower(trim(coalesce(p.tipo, ''))) = any($%[2]d::text[])
		or lower(trim(coalesce(p.tipo_de_imovel, ''))) = any($%[2]d::text[])
		or (
			p.condominium_id is not null
			and lower(trim(coalesce(nullif(p.tipo, ''), nullif(p.tipo_de_imovel, ''), ''))) = any($%[3]d::text[])
		)
	)`, exactIndex, explicitAliasIndex, linkedAliasIndex))
	return args, where
}

func propertySearchClause(index int, includeInternalIdentifiers bool) string {
	placeholder := fmt.Sprintf("$%d", index)
	internalIdentifierClause := ""
	if includeInternalIdentifiers {
		internalIdentifierClause = fmt.Sprintf(
			"\n\t\tor %s like %s",
			normalizedTextSQL("p.external_id"),
			placeholder,
		)
	}
	return fmt.Sprintf(`(
		%[2]s like %[1]s
		%[4]s
		or exists (
			select 1
			from public.property_condominiums co
			where co.id = p.condominium_id
			  and co.organization_id = p.organization_id
			  and %[3]s like %[1]s
		)
	)`,
		placeholder,
		propertySearchDocumentSQL("p"),
		normalizedTextSQL("co.name"),
		internalIdentifierClause,
	)
}

func propertySearchDocumentSQL(alias string) string {
	fields := []string{
		"code",
		"title",
		"endereco",
		"bairro",
		"cidade",
		"uf",
		"tipo",
		"tipo_de_imovel",
		"finalidade",
		"finalidade_uso",
	}
	parts := make([]string, 0, len(fields))
	for _, field := range fields {
		parts = append(parts, fmt.Sprintf("coalesce(%s.%s, '')", alias, field))
	}
	return fmt.Sprintf(
		"translate(lower(%s), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc')",
		strings.Join(parts, " || ' ' || "),
	)
}

func normalizedTextMatchClause(expression string) string {
	return normalizedTextSQL(expression) + " like $%d"
}

func addPropertyLocationFilters(args []any, where []string, filter ListFilter) ([]any, []string) {
	add := func(value any, clause string) {
		args = append(args, value)
		where = append(where, fmt.Sprintf(clause, len(args)))
	}
	if filter.CityID != "" {
		add(filter.CityID, `exists (select 1 from public.property_cities selected_city
			where selected_city.organization_id = p.organization_id and selected_city.id = $%d::uuid
			and `+cityCatalogPropertyMatchSQL("p", "selected_city")+`)`)
	} else if filter.City != "" {
		add(normalizeASCII(filter.City), normalizedTextSQL("btrim(p.cidade)")+" = $%d")
	}
	// Catalog ids carry their own city/UF identity. Requiring duplicated
	// property.uf as well would hide canonical records with legacy empty text.
	if filter.UF != "" && filter.CityID == "" && filter.NeighborhoodID == "" {
		add(filter.UF, "upper(btrim(coalesce(p.uf, ''))) = $%d")
	}
	if filter.NeighborhoodID != "" {
		add(filter.NeighborhoodID, `exists (select 1 from public.property_neighborhoods selected_neighborhood
			left join public.property_cities selected_neighborhood_city on selected_neighborhood_city.id = selected_neighborhood.city_id
			and selected_neighborhood_city.organization_id = selected_neighborhood.organization_id
			where selected_neighborhood.organization_id = p.organization_id and selected_neighborhood.id = $%d::uuid
			and `+neighborhoodCatalogPropertyMatchSQL("p", "selected_neighborhood", "selected_neighborhood_city")+`
			and (p.neighborhood_id = selected_neighborhood.id or nullif(btrim(selected_neighborhood_city.uf), '') is null
				or upper(btrim(coalesce(p.uf, ''))) = upper(btrim(selected_neighborhood_city.uf))))`)
	} else if filter.Neighborhood != "" {
		add(normalizeASCII(filter.Neighborhood), normalizedTextSQL("btrim(p.bairro)")+" = $%d")
	}
	return args, where
}

func normalizedTextSQL(expression string) string {
	return fmt.Sprintf("translate(lower(coalesce(%s, '')), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc')", expression)
}

func normalizedSearchPattern(value string) string {
	return "%" + normalizeASCII(value) + "%"
}

func isHousePropertyType(propertyType string) bool {
	return normalizeASCII(propertyType) == "casa"
}

func housePropertyTypeAliases() []string {
	return []string{
		"casa",
		"casa de condominio",
		"casa de condom\u00ednio",
		"casa em condominio",
		"casa em condom\u00ednio",
	}
}

func isCondominiumHousePropertyType(propertyType string) bool {
	switch normalizeASCII(propertyType) {
	case "casa de condominio", "casa em condominio":
		return true
	default:
		return false
	}
}

func condominiumHouseExplicitTypeAliases() []string {
	return []string{
		"casa de condominio",
		"casa de condom\u00ednio",
		"casa em condominio",
		"casa em condom\u00ednio",
	}
}

func condominiumHouseLinkedTypeAliases() []string {
	return []string{
		"casa",
		"sobrado",
	}
}

func dealTypeFilterClause() string {
	return `(
		lower(trim(coalesce(p.finalidade, ''))) = any($%[1]d::text[])
		or (
			trim(coalesce(p.finalidade, '')) = ''
			and lower(trim(coalesce(p.tipo_de_negocio, ''))) = any($%[1]d::text[])
		)
	)`
}

func propertyOwnerFilterClause() string {
	return `(
		p.owner_id = $%[1]d::uuid
		or exists (
			select 1
			from public.property_ownerships filtered_ownership
			where filtered_ownership.organization_id = p.organization_id
			  and filtered_ownership.property_id = p.id
			  and filtered_ownership.owner_id = $%[1]d::uuid
			  and filtered_ownership.valid_from <= current_date
			  and (filtered_ownership.valid_to is null or current_date < filtered_ownership.valid_to)
		)
	)`
}

func propertyDealTypeSQL(alias string) string {
	return `(case
		when lower(trim(coalesce(` + alias + `.finalidade, ''))) in (
			'venda', 'sale', 'locacao', 'locação', 'aluguel', 'locacao anual',
			'locação anual', 'rent', 'temporada', 'season', 'lancamento',
			'lançamento', 'launch', 'release', 'venda_locacao', 'venda e aluguel',
			'venda e locacao', 'venda e locação', 'venda/locacao',
			'venda/locação', 'venda/aluguel'
		) then lower(trim(` + alias + `.finalidade))
		else lower(trim(coalesce(` + alias + `.tipo_de_negocio, '')))
	end)`
}

func addPropertyPriceRangeFilter(args []any, where []string, dealType string, minPrice float64, maxPrice float64, maximumProvided ...bool) ([]any, []string) {
	hasMaximum := maxPrice > 0 || (len(maximumProvided) > 0 && maximumProvided[0])
	if minPrice <= 0 && !hasMaximum {
		return args, where
	}

	minPlaceholder := 0
	maxPlaceholder := 0
	if minPrice > 0 {
		args = append(args, minPrice)
		minPlaceholder = len(args)
	}
	if hasMaximum {
		args = append(args, maxPrice)
		maxPlaceholder = len(args)
	}

	columnRange := func(column string) string {
		clauses := make([]string, 0, 2)
		if minPlaceholder > 0 {
			clauses = append(clauses, fmt.Sprintf("%s >= $%d::numeric", column, minPlaceholder))
		}
		if maxPlaceholder > 0 {
			clauses = append(clauses, fmt.Sprintf("%s <= $%d::numeric", column, maxPlaceholder))
		}
		return "(" + strings.Join(clauses, " and ") + ")"
	}

	switch dealType {
	case "venda":
		where = append(where, columnRange("p.preco"))
	case "locacao", "temporada", "rental_catalog":
		where = append(where, columnRange("p.valor_locacao"))
	default:
		where = append(where, "("+columnRange("p.preco")+" or "+columnRange("p.valor_locacao")+")")
	}

	return args, where
}

func dealTypeAliases(dealType string) []string {
	switch dealType {
	case "venda":
		return []string{
			"venda",
			"sale",
			"venda_locacao",
			"venda e aluguel",
			"venda e locacao",
			"venda e locação",
			"venda/locacao",
			"venda/locação",
			"venda/aluguel",
		}
	case "locacao":
		return []string{
			"locacao",
			"locação",
			"aluguel",
			"locacao anual",
			"locação anual",
			"rent",
			"venda_locacao",
			"venda e aluguel",
			"venda e locacao",
			"venda e locação",
			"venda/locacao",
			"venda/locação",
			"venda/aluguel",
		}
	case "temporada":
		return []string{"temporada", "season"}
	case "rental_catalog":
		return append(dealTypeAliases("locacao"), dealTypeAliases("temporada")...)
	case "lancamento":
		return []string{"lancamento", "lançamento", "launch", "release"}
	case "venda_locacao":
		return []string{
			"venda_locacao",
			"venda e aluguel",
			"venda e locacao",
			"venda e locação",
			"venda/locacao",
			"venda/locação",
			"venda/aluguel",
		}
	default:
		if dealType == "" {
			return []string{}
		}
		return []string{dealType}
	}
}
