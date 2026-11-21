package properties

import (
	"context"
	"fmt"
	"strings"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func (repo Repository) List(ctx context.Context, tenantContext tenant.Context, filter ListFilter) (ListResponse, error) {
	args, where := basePropertyWhere(tenantContext)
	args, where = addScopedPropertyVisibility(args, where, tenantContext, "p", filter.Scope)

	addFilter := func(clause string, value any) {
		args = append(args, value)
		where = append(where, fmt.Sprintf(clause, len(args)))
	}

	if filter.Search != "" {
		args = append(args, normalizedSearchPattern(filter.Search))
		index := len(args)
		where = append(where, propertySearchClause(index, canManageProperties(tenantContext)))
	}
	if filter.Status != "" {
		addFilter("lower(trim(coalesce(p.status, ''))) = any($%d::text[])", propertyStatusAliases(filter.Status))
	}
	if filter.PortfolioType != "" {
		addFilter("p.portfolio_type = $%d", filter.PortfolioType)
	}
	dealType := normalizedDealTypeForFilter(filter.DealType)
	if filter.DealType != "" {
		switch dealType {
		case "venda":
			addFilter(dealTypeFilterClause(), dealTypeAliases("venda"))
		case "locacao":
			addFilter(dealTypeFilterClause(), dealTypeAliases("locacao"))
		default:
			addFilter(dealTypeFilterClause(), dealTypeAliases(dealType))
		}
	}
	if filter.PropertyType != "" {
		args, where = addPropertyTypeFilter(args, where, filter.PropertyType)
	}
	args, where = addPropertyLocationFilters(args, where, filter)
	if filter.AcceptsExchange != nil {
		addFilter("coalesce(p.aceita_permuta, false) = $%d::boolean", *filter.AcceptsExchange)
	}
	if filter.AcceptsFinancing != nil {
		addFilter("coalesce(p.aceita_financiamento, false) = $%d::boolean", *filter.AcceptsFinancing)
	}
	if filter.PublishedOnSite != nil {
		addFilter(propertyPublishedOnSiteSQL("p", "site_publication")+" = $%d::boolean", *filter.PublishedOnSite)
	}
	if filter.OwnerID != "" {
		addFilter(propertyOwnerFilterClause(), filter.OwnerID)
	}
	if filter.CondominiumID != "" {
		addFilter("p.condominium_id = $%d::uuid", filter.CondominiumID)
	}
	if filter.Furniture != "" {
		addFilter("p.mobilia = $%d", filter.Furniture)
	}
	if filter.Exclusive != nil {
		addFilter("coalesce(p.exclusividade, false) = $%d::boolean", *filter.Exclusive)
	}
	if filter.HasSign != nil {
		addFilter("coalesce(p.placa_no_local, false) = $%d::boolean", *filter.HasSign)
	}
	if filter.Featured != nil {
		addFilter("coalesce(p.is_featured, p.destaque, false) = $%d::boolean", *filter.Featured)
	}
	if filter.ResponsibleID != "" {
		args = append(args, filter.ResponsibleID)
		index := len(args)
		where = append(where, fmt.Sprintf("(p.responsible_user_id = $%d::uuid or p.created_by = $%d::uuid)", index, index))
	}
	if filter.BedroomsMin > 0 {
		addFilter("p.quartos >= $%d::integer", filter.BedroomsMin)
	}
	if filter.SuitesMin > 0 {
		addFilter("p.suites >= $%d::integer", filter.SuitesMin)
	}
	if filter.BathroomsMin > 0 {
		addFilter("p.banheiros >= $%d::integer", filter.BathroomsMin)
	}
	if filter.ParkingSpacesMin > 0 {
		addFilter("p.vagas >= $%d::integer", filter.ParkingSpacesMin)
	}
	if filter.UsableAreaMin > 0 {
		addFilter("p.area_util >= $%d::numeric", filter.UsableAreaMin)
	}
	if filter.UsableAreaMax > 0 || filter.UsableAreaMaxProvided {
		addFilter("p.area_util <= $%d::numeric", filter.UsableAreaMax)
	}
	if filter.TotalAreaMin > 0 {
		addFilter("p.area_total >= $%d::numeric", filter.TotalAreaMin)
	}
	if filter.TotalAreaMax > 0 || filter.TotalAreaMaxProvided {
		addFilter("p.area_total <= $%d::numeric", filter.TotalAreaMax)
	}
	args, where = addPropertyPriceRangeFilter(args, where, dealType, filter.PriceMin, filter.PriceMax, filter.PriceMaxProvided)

	args = append(args, filter.Limit, filter.Offset)
	limitIndex := len(args) - 1
	offsetIndex := len(args)

	rows, err := repo.db.Pool().Query(ctx, `
		select
			count(*) over() as total_count,
			(
				jsonb_build_object(
				'id', p.id,
				'organization_id', p.organization_id,
				'code', p.code,
				'title', p.title,
				'tipo', p.tipo,
				'tipo_de_imovel', p.tipo_de_imovel,
				'tipo_de_negocio', p.tipo_de_negocio,
				'finalidade', p.finalidade,
				'finalidade_uso', p.finalidade_uso,
				'status', p.status,
				'owner_id', p.owner_id,
				'owner_name', p.owner_name,
				'bairro', p.bairro,
				'cidade', p.cidade,
				'uf', p.uf,
				'city_id', p.city_id,
				'neighborhood_id', p.neighborhood_id,
				'condominium_id', p.condominium_id,
				'endereco', p.endereco,
				'numero', p.numero,
				'quartos', p.quartos,
				'suites', p.suites,
				'banheiros', p.banheiros,
				'vagas', p.vagas,
				'area_util', p.area_util,
				'area_total', p.area_total,
				'mobilia', p.mobilia
			)
			|| jsonb_build_object(
				'preco', p.preco,
				'valor_locacao', p.valor_locacao,
				'condominio', p.condominio,
				'iptu', p.iptu,
				'aceita_permuta', coalesce(p.aceita_permuta, false),
				'aceita_financiamento', coalesce(p.aceita_financiamento, false),
				'exclusividade', coalesce(p.exclusividade, false),
				'placa_no_local', coalesce(p.placa_no_local, false),
				'is_featured', p.is_featured,
				'destaque', p.destaque,
				'super_destaque', p.super_destaque,
				'published_on_site', `+propertyPublishedOnSiteSQL("p", "site_publication")+`,
				'site_publication', `+propertySitePublicationMetadataSQL("site_publication")+`,
				'created_at', p.created_at,
				'updated_at', p.updated_at,
				'_property_edit_policy', coalesce(property_organization.property_edit_policy, 'responsible_or_admin'),
				'created_by', p.created_by,
				'responsible_user_id', p.responsible_user_id,
				'cadastrado_por', p.cadastrado_por,
				'commission_percentage', p.commission_percentage,
				'portfolio_type', p.portfolio_type,
				'third_party_kind', p.third_party_kind,
				'partner_name', p.partner_name,
				'commission_split_percent', p.commission_split_percent,
				'third_party_authorized_until', p.third_party_authorized_until,
				'metadata', p.metadata,
				'imagem_principal', case
					when asset_photo_exists.has_photo then coalesce(asset_cover.external_url, '')
					else coalesce(nullif(p.imagem_principal, ''), '')
				end,
				'image_urls', case
					when asset_photo_exists.has_photo then '{}'::text[]
					else p.image_urls
				end,
				'fotos', case
					when asset_photo_exists.has_photo then '[]'::jsonb
					else p.fotos
				end,
				'_asset_cover_storage_path', asset_cover.storage_path
			)
			)::text
		from public.properties p
		join public.organizations property_organization
		  on property_organization.id = p.organization_id
		`+propertySitePublicationJoinSQL("p", "site_publication")+`
		left join lateral (
			select true as has_photo
			from public.property_assets as any_photo
			where any_photo.organization_id = p.organization_id
			  and any_photo.property_id = p.id
			  and any_photo.asset_type = 'photo'
			limit 1
		) as asset_photo_exists on true
		left join lateral (
			select asset.storage_path, asset.external_url
			from public.property_assets as asset
			where asset.organization_id = p.organization_id
			  and asset.property_id = p.id
			  and asset.asset_type = 'photo'
			  and asset.visibility <> 'confidential'
			  and `+activePropertyAssetSQL("asset")+`
			order by asset.is_primary desc, asset.sort_order, asset.created_at, asset.id
			limit 1
		) as asset_cover on true
		where `+strings.Join(where, " and ")+`
		order by p.created_at desc, p.id desc
		limit $`+fmt.Sprint(limitIndex)+`
		offset $`+fmt.Sprint(offsetIndex),
		args...,
	)
	if err != nil {
		return ListResponse{}, err
	}
	defer rows.Close()

	properties := make([]Property, 0, filter.Limit)
	var total int64
	for rows.Next() {
		property, rowTotal, err := scanPropertyWithTotal(rows)
		if err != nil {
			return ListResponse{}, err
		}
		total = rowTotal
		properties = append(properties, property)
	}
	if err := rows.Err(); err != nil {
		return ListResponse{}, err
	}

	repo.attachSignedPropertyCoverURLs(ctx, tenantContext.OrganizationID, properties)
	for index := range properties {
		attachPropertyManagedTerms(properties[index])
		authorization := propertyUpdateAuthorizationFromProperty(
			tenantContext,
			properties[index],
			anyString(properties[index]["_property_edit_policy"]),
			"",
		)
		properties[index]["can_edit"] = authorization.CanEdit
		properties[index] = projectWorkspaceProperty(
			properties[index],
			canManageProperties(tenantContext),
			false,
		)
	}

	return ListResponse{
		Data:   properties,
		Total:  total,
		Limit:  filter.Limit,
		Offset: filter.Offset,
	}, nil
}

func (repo Repository) Stats(ctx context.Context, tenantContext tenant.Context, filter ListFilter) (StatsResponse, error) {
	args, where := basePropertyWhere(tenantContext)
	args, where = addScopedPropertyVisibility(args, where, tenantContext, "p", filter.Scope)

	addFilter := func(clause string, value any) {
		args = append(args, value)
		where = append(where, fmt.Sprintf(clause, len(args)))
	}

	if filter.Search != "" {
		args = append(args, normalizedSearchPattern(filter.Search))
		index := len(args)
		where = append(where, propertySearchClause(index, canManageProperties(tenantContext)))
	}
	if filter.Status != "" {
		addFilter("lower(trim(coalesce(p.status, ''))) = any($%d::text[])", propertyStatusAliases(filter.Status))
	}
	if filter.PortfolioType != "" {
		addFilter("p.portfolio_type = $%d", filter.PortfolioType)
	}
	dealType := normalizedDealTypeForFilter(filter.DealType)
	if filter.DealType != "" {
		switch dealType {
		case "venda":
			addFilter(dealTypeFilterClause(), dealTypeAliases("venda"))
		case "locacao":
			addFilter(dealTypeFilterClause(), dealTypeAliases("locacao"))
		default:
			addFilter(dealTypeFilterClause(), dealTypeAliases(dealType))
		}
	}
	if filter.PropertyType != "" {
		args, where = addPropertyTypeFilter(args, where, filter.PropertyType)
	}
	args, where = addPropertyLocationFilters(args, where, filter)
	if filter.AcceptsExchange != nil {
		addFilter("coalesce(p.aceita_permuta, false) = $%d::boolean", *filter.AcceptsExchange)
	}
	if filter.AcceptsFinancing != nil {
		addFilter("coalesce(p.aceita_financiamento, false) = $%d::boolean", *filter.AcceptsFinancing)
	}
	if filter.PublishedOnSite != nil {
		addFilter(propertyPublishedOnSiteSQL("p", "site_publication")+" = $%d::boolean", *filter.PublishedOnSite)
	}
	if filter.OwnerID != "" {
		addFilter(propertyOwnerFilterClause(), filter.OwnerID)
	}
	if filter.CondominiumID != "" {
		addFilter("p.condominium_id = $%d::uuid", filter.CondominiumID)
	}
	if filter.Furniture != "" {
		addFilter("p.mobilia = $%d", filter.Furniture)
	}
	if filter.Exclusive != nil {
		addFilter("coalesce(p.exclusividade, false) = $%d::boolean", *filter.Exclusive)
	}
	if filter.HasSign != nil {
		addFilter("coalesce(p.placa_no_local, false) = $%d::boolean", *filter.HasSign)
	}
	if filter.Featured != nil {
		addFilter("coalesce(p.is_featured, p.destaque, false) = $%d::boolean", *filter.Featured)
	}
	if filter.ResponsibleID != "" {
		args = append(args, filter.ResponsibleID)
		index := len(args)
		where = append(where, fmt.Sprintf("(p.responsible_user_id = $%d::uuid or p.created_by = $%d::uuid)", index, index))
	}
	if filter.BedroomsMin > 0 {
		addFilter("p.quartos >= $%d::integer", filter.BedroomsMin)
	}
	if filter.SuitesMin > 0 {
		addFilter("p.suites >= $%d::integer", filter.SuitesMin)
	}
	if filter.BathroomsMin > 0 {
		addFilter("p.banheiros >= $%d::integer", filter.BathroomsMin)
	}
	if filter.ParkingSpacesMin > 0 {
		addFilter("p.vagas >= $%d::integer", filter.ParkingSpacesMin)
	}
	if filter.UsableAreaMin > 0 {
		addFilter("p.area_util >= $%d::numeric", filter.UsableAreaMin)
	}
	if filter.UsableAreaMax > 0 || filter.UsableAreaMaxProvided {
		addFilter("p.area_util <= $%d::numeric", filter.UsableAreaMax)
	}
	if filter.TotalAreaMin > 0 {
		addFilter("p.area_total >= $%d::numeric", filter.TotalAreaMin)
	}
	if filter.TotalAreaMax > 0 || filter.TotalAreaMaxProvided {
		addFilter("p.area_total <= $%d::numeric", filter.TotalAreaMax)
	}
	args, where = addPropertyPriceRangeFilter(args, where, dealType, filter.PriceMin, filter.PriceMax, filter.PriceMaxProvided)

	saleAliasIndex := len(args) + 1
	rentalAliasIndex := len(args) + 2
	launchAliasIndex := len(args) + 3
	args = append(
		args,
		dealTypeAliases("venda"),
		dealTypeAliases("rental_catalog"),
		dealTypeAliases("lancamento"),
	)

	var stats StatsResponse
	err := repo.db.Pool().QueryRow(ctx, `
		with filtered as (
			select
				coalesce(nullif(lower(trim(p.status)), ''), 'active') as status,
				`+propertyDealTypeSQL("p")+` as deal_type,
				`+propertyPublishedOnSiteSQL("p", "site_publication")+` as published_on_site
			from public.properties p
			`+propertySitePublicationJoinSQL("p", "site_publication")+`
			where `+strings.Join(where, " and ")+`
		)
		select
			count(*)::bigint,
			count(*) filter (where deal_type = any($`+fmt.Sprint(saleAliasIndex)+`::text[]))::bigint,
			count(*) filter (where deal_type = any($`+fmt.Sprint(rentalAliasIndex)+`::text[]))::bigint,
			count(*) filter (where deal_type = any($`+fmt.Sprint(launchAliasIndex)+`::text[]))::bigint,
			count(*) filter (where status not in ('sold', 'vendido', 'rented', 'alugado', 'locado', 'reserved', 'reservado', 'inactive', 'inativo', 'archived', 'arquivado', 'draft', 'rascunho'))::bigint,
			count(*) filter (where status in ('reserved', 'reservado'))::bigint,
			count(*) filter (where status in ('sold', 'vendido'))::bigint,
			count(*) filter (where status in ('rented', 'alugado', 'locado'))::bigint,
			count(*) filter (where published_on_site is false)::bigint
		from filtered
	`, args...).Scan(
		&stats.Total,
		&stats.Sale,
		&stats.Rental,
		&stats.Launches,
		&stats.Available,
		&stats.Reserved,
		&stats.Sold,
		&stats.Rented,
		&stats.Private,
	)
	if err != nil {
		return StatsResponse{}, err
	}
	return stats, nil
}
