package properties

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"sort"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

type Repository struct {
	db      *dbpkg.Postgres
	storage storageClient
}

type scanner interface {
	Scan(dest ...any) error
}

type propertySnapshot struct {
	ID                string
	CreatorID         string
	ResponsibleUserID string
	PropertyType      string
	Title             string
	Code              string
	Status            string
	PublishedOnSite   bool
}

func NewRepository(db *dbpkg.Postgres, storageConfig StorageConfig) Repository {
	return Repository{
		db:      db,
		storage: newStorageClient(storageConfig),
	}
}

func (repo Repository) List(ctx context.Context, tenantContext tenant.Context, filter ListFilter) (ListResponse, error) {
	args := []any{tenantContext.OrganizationID}
	where := []string{"p.organization_id = $1::uuid"}

	addFilter := func(clause string, value any) {
		args = append(args, value)
		where = append(where, fmt.Sprintf(clause, len(args)))
	}

	if filter.Search != "" {
		args = append(args, "%"+filter.Search+"%")
		index := len(args)
		where = append(where, fmt.Sprintf(`(
			p.code ilike $%d
			or p.title ilike $%d
			or p.bairro ilike $%d
			or p.cidade ilike $%d
			or p.uf ilike $%d
			or p.tipo ilike $%d
			or p.finalidade ilike $%d
			or p.external_id ilike $%d
		)`, index, index, index, index, index, index, index, index))
	}
	if filter.Status != "" {
		addFilter("lower(trim(coalesce(p.status, ''))) = any($%d::text[])", propertyStatusAliases(filter.Status))
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
		addFilter("p.tipo = $%d", filter.PropertyType)
	}
	if filter.City != "" {
		addFilter("p.cidade ilike $%d", "%"+filter.City+"%")
	}
	if filter.Neighborhood != "" {
		addFilter("p.bairro ilike $%d", "%"+filter.Neighborhood+"%")
	}
	if filter.AcceptsExchange != nil {
		addFilter("coalesce(p.aceita_permuta, false) = $%d::boolean", *filter.AcceptsExchange)
	}
	if filter.AcceptsFinancing != nil {
		addFilter("coalesce(p.aceita_financiamento, false) = $%d::boolean", *filter.AcceptsFinancing)
	}
	if filter.PublishedOnSite != nil {
		addFilter("coalesce(p.published_on_site, false) = $%d::boolean", *filter.PublishedOnSite)
	}
	if filter.OwnerID != "" {
		addFilter("p.owner_id = $%d::uuid", filter.OwnerID)
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
	if filter.UsableAreaMax > 0 {
		addFilter("p.area_util <= $%d::numeric", filter.UsableAreaMax)
	}
	if filter.TotalAreaMin > 0 {
		addFilter("p.area_total >= $%d::numeric", filter.TotalAreaMin)
	}
	if filter.TotalAreaMax > 0 {
		addFilter("p.area_total <= $%d::numeric", filter.TotalAreaMax)
	}
	if filter.PriceMin > 0 {
		if dealType == "locacao" || dealType == "temporada" {
			addFilter("p.valor_locacao >= $%d::numeric", filter.PriceMin)
		} else if dealType == "venda" {
			addFilter("p.preco >= $%d::numeric", filter.PriceMin)
		} else {
			args = append(args, filter.PriceMin)
			index := len(args)
			where = append(where, fmt.Sprintf("(p.preco >= $%d::numeric or p.valor_locacao >= $%d::numeric)", index, index))
		}
	}
	if filter.PriceMax > 0 {
		if dealType == "locacao" || dealType == "temporada" {
			addFilter("p.valor_locacao <= $%d::numeric", filter.PriceMax)
		} else if dealType == "venda" {
			addFilter("p.preco <= $%d::numeric", filter.PriceMax)
		} else {
			args = append(args, filter.PriceMax)
			index := len(args)
			where = append(where, fmt.Sprintf("(p.preco <= $%d::numeric or p.valor_locacao <= $%d::numeric)", index, index))
		}
	}

	args = append(args, filter.Limit, filter.Offset)
	limitIndex := len(args) - 1
	offsetIndex := len(args)

	rows, err := repo.db.Pool().Query(ctx, `
		select
			count(*) over() as total_count,
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
				'mobilia', p.mobilia,
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
				'published_on_site', p.published_on_site,
				'created_by', p.created_by,
				'responsible_user_id', p.responsible_user_id,
				'cadastrado_por', p.cadastrado_por,
				'commission_percentage', p.commission_percentage,
				'imagem_principal', coalesce(nullif(p.imagem_principal, ''), '')
			)::text
		from public.properties p
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

	return ListResponse{
		Data:   properties,
		Total:  total,
		Limit:  filter.Limit,
		Offset: filter.Offset,
	}, nil
}

func (repo Repository) Stats(ctx context.Context, tenantContext tenant.Context, filter ListFilter) (StatsResponse, error) {
	args := []any{tenantContext.OrganizationID}
	where := []string{"p.organization_id = $1::uuid"}

	addFilter := func(clause string, value any) {
		args = append(args, value)
		where = append(where, fmt.Sprintf(clause, len(args)))
	}

	if filter.Search != "" {
		args = append(args, "%"+filter.Search+"%")
		index := len(args)
		where = append(where, fmt.Sprintf(`(
			p.code ilike $%d
			or p.title ilike $%d
			or p.bairro ilike $%d
			or p.cidade ilike $%d
			or p.uf ilike $%d
			or p.tipo ilike $%d
			or p.finalidade ilike $%d
			or p.external_id ilike $%d
		)`, index, index, index, index, index, index, index, index))
	}
	if filter.Status != "" {
		addFilter("lower(trim(coalesce(p.status, ''))) = any($%d::text[])", propertyStatusAliases(filter.Status))
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
		addFilter("p.tipo = $%d", filter.PropertyType)
	}
	if filter.City != "" {
		addFilter("p.cidade ilike $%d", "%"+filter.City+"%")
	}
	if filter.Neighborhood != "" {
		addFilter("p.bairro ilike $%d", "%"+filter.Neighborhood+"%")
	}
	if filter.AcceptsExchange != nil {
		addFilter("coalesce(p.aceita_permuta, false) = $%d::boolean", *filter.AcceptsExchange)
	}
	if filter.AcceptsFinancing != nil {
		addFilter("coalesce(p.aceita_financiamento, false) = $%d::boolean", *filter.AcceptsFinancing)
	}
	if filter.PublishedOnSite != nil {
		addFilter("coalesce(p.published_on_site, false) = $%d::boolean", *filter.PublishedOnSite)
	}
	if filter.OwnerID != "" {
		addFilter("p.owner_id = $%d::uuid", filter.OwnerID)
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
	if filter.UsableAreaMax > 0 {
		addFilter("p.area_util <= $%d::numeric", filter.UsableAreaMax)
	}
	if filter.TotalAreaMin > 0 {
		addFilter("p.area_total >= $%d::numeric", filter.TotalAreaMin)
	}
	if filter.TotalAreaMax > 0 {
		addFilter("p.area_total <= $%d::numeric", filter.TotalAreaMax)
	}
	if filter.PriceMin > 0 {
		if dealType == "locacao" || dealType == "temporada" {
			addFilter("p.valor_locacao >= $%d::numeric", filter.PriceMin)
		} else if dealType == "venda" {
			addFilter("p.preco >= $%d::numeric", filter.PriceMin)
		} else {
			args = append(args, filter.PriceMin)
			index := len(args)
			where = append(where, fmt.Sprintf("(p.preco >= $%d::numeric or p.valor_locacao >= $%d::numeric)", index, index))
		}
	}
	if filter.PriceMax > 0 {
		if dealType == "locacao" || dealType == "temporada" {
			addFilter("p.valor_locacao <= $%d::numeric", filter.PriceMax)
		} else if dealType == "venda" {
			addFilter("p.preco <= $%d::numeric", filter.PriceMax)
		} else {
			args = append(args, filter.PriceMax)
			index := len(args)
			where = append(where, fmt.Sprintf("(p.preco <= $%d::numeric or p.valor_locacao <= $%d::numeric)", index, index))
		}
	}

	saleAliasIndex := len(args) + 1
	rentalAliasIndex := len(args) + 2
	args = append(args, dealTypeAliases("venda"), dealTypeAliases("locacao"))

	var stats StatsResponse
	err := repo.db.Pool().QueryRow(ctx, `
		with filtered as (
			select
				coalesce(nullif(lower(trim(p.status)), ''), 'active') as status,
				lower(trim(coalesce(p.finalidade, ''))) as finalidade,
				lower(trim(coalesce(p.tipo_de_negocio, ''))) as tipo_de_negocio,
				p.published_on_site
			from public.properties p
			where `+strings.Join(where, " and ")+`
		)
		select
			count(*)::bigint,
			count(*) filter (where finalidade = any($`+fmt.Sprint(saleAliasIndex)+`::text[]) or tipo_de_negocio = any($`+fmt.Sprint(saleAliasIndex)+`::text[]))::bigint,
			count(*) filter (where finalidade = any($`+fmt.Sprint(rentalAliasIndex)+`::text[]) or tipo_de_negocio = any($`+fmt.Sprint(rentalAliasIndex)+`::text[]))::bigint,
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

func dealTypeFilterClause() string {
	return `(
		lower(trim(coalesce(p.finalidade, ''))) = any($%[1]d::text[])
		or lower(trim(coalesce(p.tipo_de_negocio, ''))) = any($%[1]d::text[])
	)`
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

func (repo Repository) Get(ctx context.Context, tenantContext tenant.Context, propertyID string) (Property, error) {
	propertyID, ok := normalizeUUID(propertyID)
	if !ok {
		return nil, ErrPropertyNotFound
	}

	property, err := scanProperty(repo.db.Pool().QueryRow(ctx, `
		select to_jsonb(p)::text
		from public.properties p
		where p.organization_id = $1::uuid
		  and p.id = $2::uuid
		limit 1
	`, tenantContext.OrganizationID, propertyID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrPropertyNotFound
	}
	return property, err
}

func (repo Repository) Create(ctx context.Context, tenantContext tenant.Context, input propertyRequest) (Property, error) {
	if !canCreateProperties(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	if !canAssignProperties(tenantContext) {
		input["created_by"] = tenantContext.UserID
		input["responsible_user_id"] = tenantContext.UserID
		input["cadastrado_por"] = tenantContext.UserID
	} else if input["created_by"] == nil {
		input["created_by"] = tenantContext.UserID
	}
	if input["responsible_user_id"] == nil {
		input["responsible_user_id"] = tenantContext.UserID
	}
	if input["cadastrado_por"] == nil {
		input["cadastrado_por"] = input["responsible_user_id"]
	}

	propertyType, _ := input["tipo"].(string)
	code, err := repo.generatePropertyCode(ctx, tx, tenantContext.OrganizationID, propertyType)
	if err != nil {
		return nil, err
	}

	columns, placeholders, args := mutationParts(input, 3)
	columns = append([]string{"organization_id", "code"}, columns...)
	placeholders = append([]string{"$1::uuid", "$2"}, placeholders...)
	args = append([]any{tenantContext.OrganizationID, code}, args...)

	var property Property
	err = tx.QueryRow(ctx, `
		insert into public.properties (`+strings.Join(columns, ", ")+`)
		values (`+strings.Join(placeholders, ", ")+`)
		returning to_jsonb(properties)::text
	`, args...).Scan((*jsonTextProperty)(&property))
	if err != nil {
		return nil, err
	}
	property = normalizePropertyOutput(property)

	if err := repo.insertPropertyCreatedActivity(ctx, tx, tenantContext, property); err != nil {
		slog.Warn("property activity insert skipped", "error", err)
	}

	if err := repo.removeDemoProperties(ctx, tx, tenantContext.OrganizationID); err != nil {
		slog.Warn("demo property cleanup skipped", "error", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	return property, nil
}

func (repo Repository) Update(ctx context.Context, tenantContext tenant.Context, propertyID string, input propertyRequest) (Property, error) {
	propertyID, ok := normalizeUUID(propertyID)
	if !ok {
		return nil, ErrPropertyNotFound
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	current, err := repo.getSnapshotForUpdate(ctx, tx, tenantContext.OrganizationID, propertyID)
	if err != nil {
		return nil, err
	}
	editPolicy, err := repo.propertyEditPolicy(ctx, tx, tenantContext.OrganizationID)
	if err != nil {
		return nil, err
	}
	if !canEditProperty(tenantContext, current.CreatorID, current.ResponsibleUserID, editPolicy) &&
		!canUpdatePropertyAvailability(tenantContext, input) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	if !canAssignProperties(tenantContext) {
		if isPropertyAssignmentChange(input, current) {
			return nil, tenant.ErrOrganizationAccessDenied
		}
		delete(input, "created_by")
		delete(input, "responsible_user_id")
		delete(input, "cadastrado_por")
	}

	if nextType, ok := input["tipo"].(string); ok && strings.TrimSpace(nextType) != "" && nextType != current.PropertyType {
		code, err := repo.generatePropertyCode(ctx, tx, tenantContext.OrganizationID, nextType)
		if err != nil {
			return nil, err
		}
		input["code"] = code
	}

	assignments, args := updateParts(input, 3)
	if len(assignments) == 0 {
		return nil, ErrNoChanges
	}
	assignments = append(assignments, "updated_at = now()")
	args = append([]any{tenantContext.OrganizationID, propertyID}, args...)

	var property Property
	err = tx.QueryRow(ctx, `
		update public.properties
		set `+strings.Join(assignments, ", ")+`
		where organization_id = $1::uuid
		  and id = $2::uuid
		returning to_jsonb(properties)::text
	`, args...).Scan((*jsonTextProperty)(&property))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrPropertyNotFound
	}
	if err != nil {
		return nil, err
	}
	property = normalizePropertyOutput(property)

	if err := repo.insertPropertyUpdatedActivity(ctx, tx, tenantContext, current, input, property); err != nil {
		slog.Warn("property activity insert skipped", "error", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	return property, nil
}

func (repo Repository) Delete(ctx context.Context, tenantContext tenant.Context, propertyID string) error {
	propertyID, ok := normalizeUUID(propertyID)
	if !ok {
		return ErrPropertyNotFound
	}
	if !canDeleteProperties(tenantContext) {
		return tenant.ErrOrganizationAccessDenied
	}

	tag, err := repo.db.Pool().Exec(ctx, `
		delete from public.properties
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, tenantContext.OrganizationID, propertyID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrPropertyNotFound
	}

	return nil
}

func (repo Repository) ListHistory(ctx context.Context, tenantContext tenant.Context, propertyID string) ([]HistoryEvent, error) {
	propertyID, ok := normalizeUUID(propertyID)
	if !ok {
		return nil, ErrPropertyNotFound
	}

	var exists bool
	if err := repo.db.Pool().QueryRow(ctx, `
		select exists (
			select 1
			from public.properties
			where organization_id = $1::uuid
			  and id = $2::uuid
		)
	`, tenantContext.OrganizationID, propertyID).Scan(&exists); err != nil {
		return nil, err
	}
	if !exists {
		return nil, ErrPropertyNotFound
	}

	rows, err := repo.db.Pool().Query(ctx, `
		with property_events as (
			select
				e.id::text as id,
				e.event_type,
				e.payload,
				e.created_at,
				coalesce(e.payload->>'message', e.event_type) as title
			from public.events e
			where e.organization_id = $1::uuid
			  and e.entity_type = 'property'
			  and e.entity_id = $2::uuid
		),
		property_created_row as (
			select
				p.id::text || ':created' as id,
				'property_created' as event_type,
				jsonb_build_object(
					'user_id', coalesce(p.created_by::text, p.cadastrado_por::text, p.responsible_user_id::text, ''),
					'title', coalesce(nullif(p.title, ''), nullif(p.tipo_de_imovel, ''), 'Imovel'),
					'property_id', p.id::text,
					'code', coalesce(p.code, ''),
					'organization_id', p.organization_id::text,
					'message', 'Imovel criado',
					'synthetic', true
				) as payload,
				p.created_at,
				'Imovel criado' as title
			from public.properties p
			where p.organization_id = $1::uuid
			  and p.id = $2::uuid
			  and not exists (
				select 1
				from public.events e
				where e.organization_id = $1::uuid
				  and e.entity_type = 'property'
				  and e.entity_id = $2::uuid
				  and e.event_type = 'property_created'
			  )
		),
		schedule_rows as (
			select
				se.id::text as id,
				case
					when se.status = 'completed' then 'property_schedule_completed'
					else 'property_schedule'
				end as event_type,
				jsonb_build_object(
					'title', se.title,
					'description', se.description,
					'event_type', se.event_type,
					'status', se.status,
					'start_time', se.start_time,
					'end_time', se.end_time,
					'user_id', se.user_id,
					'lead_id', se.lead_id,
					'message', 'Agendamento vinculado ao imovel'
				) as payload,
				se.created_at,
				se.title
			from public.schedule_events se
			where se.organization_id = $1::uuid
			  and se.property_id = $2::uuid
		)
		select id, event_type, title, payload::text, created_at::text
		from (
			select * from property_events
			union all
			select * from property_created_row
			union all
			select * from schedule_rows
		) history
		order by created_at desc
		limit 100
	`, tenantContext.OrganizationID, propertyID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	events := []HistoryEvent{}
	for rows.Next() {
		var event HistoryEvent
		var payload string
		if err := rows.Scan(&event.ID, &event.Type, &event.Title, &payload, &event.CreatedAt); err != nil {
			return nil, err
		}
		event.Metadata = map[string]any{}
		_ = json.Unmarshal([]byte(payload), &event.Metadata)
		events = append(events, event)
	}
	return events, rows.Err()
}

func (repo Repository) getSnapshotForUpdate(ctx context.Context, tx pgx.Tx, organizationID string, propertyID string) (propertySnapshot, error) {
	var snapshot propertySnapshot
	var creatorID, responsibleUserID, propertyType, title, code, status pgtype.Text
	err := tx.QueryRow(ctx, `
		select
			id::text,
			coalesce(created_by::text, ''),
			coalesce(responsible_user_id::text, ''),
			coalesce(tipo, tipo_de_imovel, ''),
			title,
			code,
			coalesce(status, 'active'),
			coalesce(published_on_site, false)
		from public.properties
		where organization_id = $1::uuid
		  and id = $2::uuid
		for update
	`, organizationID, propertyID).Scan(&snapshot.ID, &creatorID, &responsibleUserID, &propertyType, &title, &code, &status, &snapshot.PublishedOnSite)
	if errors.Is(err, pgx.ErrNoRows) {
		return propertySnapshot{}, ErrPropertyNotFound
	}
	if err != nil {
		return propertySnapshot{}, err
	}

	snapshot.CreatorID = textValue(creatorID)
	snapshot.ResponsibleUserID = textValue(responsibleUserID)
	snapshot.PropertyType = textValue(propertyType)
	snapshot.Title = textValue(title)
	snapshot.Code = textValue(code)
	snapshot.Status = textValue(status)
	return snapshot, nil
}

func (repo Repository) propertyEditPolicy(ctx context.Context, tx pgx.Tx, organizationID string) (string, error) {
	var policy string
	err := tx.QueryRow(ctx, `
		select coalesce(nullif(property_edit_policy, ''), 'responsible_or_admin')
		from public.organizations
		where id = $1::uuid
	`, organizationID).Scan(&policy)
	if errors.Is(err, pgx.ErrNoRows) {
		return "responsible_or_admin", nil
	}
	if err != nil {
		return "", err
	}
	return policy, nil
}

func (repo Repository) generatePropertyCode(ctx context.Context, tx pgx.Tx, organizationID string, propertyType string) (string, error) {
	prefix := propertyPrefix(propertyType)
	if _, err := tx.Exec(ctx, `
		select pg_advisory_xact_lock(hashtext($1), hashtext($2))
	`, organizationID, prefix); err != nil {
		return "", err
	}

	usesPrefixSequence, err := repo.propertySequenceUsesPrefix(ctx, tx)
	if err != nil {
		return "", err
	}
	if !usesPrefixSequence {
		return repo.generateLegacyPropertyCode(ctx, tx, organizationID, prefix)
	}

	var nextNumber int64
	var sequenceID string
	var currentNumber pgtype.Int8
	err = tx.QueryRow(ctx, `
		select id::text, last_number
		from public.property_sequences
		where organization_id = $1::uuid
		  and prefix = $2
		for update
	`, organizationID, prefix).Scan(&sequenceID, &currentNumber)
	if errors.Is(err, pgx.ErrNoRows) {
		nextNumber = 1
		_, err = tx.Exec(ctx, `
			insert into public.property_sequences (organization_id, prefix, last_number)
			values ($1::uuid, $2, $3)
		`, organizationID, prefix, nextNumber)
		if err != nil {
			return "", err
		}
	} else if err != nil {
		return "", err
	} else {
		nextNumber = 1
		if currentNumber.Valid {
			nextNumber = currentNumber.Int64 + 1
		}
		_, err = tx.Exec(ctx, `
			update public.property_sequences
			set last_number = $1
			where id = $2::uuid
		`, nextNumber, sequenceID)
		if err != nil {
			return "", err
		}
	}

	return fmt.Sprintf("%s%04d", prefix, nextNumber), nil
}

func (repo Repository) propertySequenceUsesPrefix(ctx context.Context, tx pgx.Tx) (bool, error) {
	var usesPrefixSequence bool
	err := tx.QueryRow(ctx, `
		select exists (
			select 1
			from information_schema.columns
			where table_schema = 'public'
			  and table_name = 'property_sequences'
			  and column_name = 'prefix'
		)
	`).Scan(&usesPrefixSequence)
	return usesPrefixSequence, err
}

func (repo Repository) generateLegacyPropertyCode(ctx context.Context, tx pgx.Tx, organizationID string, prefix string) (string, error) {
	if _, err := tx.Exec(ctx, `
		select pg_advisory_xact_lock(hashtext($1), hashtext('property_sequences'))
	`, organizationID); err != nil {
		return "", err
	}

	var nextNumber pgtype.Int8
	err := tx.QueryRow(ctx, `
		select next_value
		from public.property_sequences
		where organization_id = $1::uuid
		for update
	`, organizationID).Scan(&nextNumber)
	if errors.Is(err, pgx.ErrNoRows) {
		number := int64(1)
		_, err = tx.Exec(ctx, `
			insert into public.property_sequences (organization_id, next_value)
			values ($1::uuid, $2)
		`, organizationID, number+1)
		if err != nil {
			return "", err
		}
		return fmt.Sprintf("%s%04d", prefix, number), nil
	}
	if err != nil {
		return "", err
	}

	number := int64(1)
	if nextNumber.Valid && nextNumber.Int64 > 0 {
		number = nextNumber.Int64
	}
	_, err = tx.Exec(ctx, `
		update public.property_sequences
		set next_value = $1,
		    updated_at = now()
		where organization_id = $2::uuid
	`, number+1, organizationID)
	if err != nil {
		return "", err
	}

	return fmt.Sprintf("%s%04d", prefix, number), nil
}

func (repo Repository) insertPropertyCreatedActivity(ctx context.Context, tx pgx.Tx, tenantContext tenant.Context, property Property) error {
	title, _ := property["title"].(string)
	code, _ := property["code"].(string)
	propertyID, _ := property["id"].(string)
	if propertyID == "" {
		return nil
	}
	if title == "" {
		title = "Imovel"
	}

	var hasEventsTable bool
	if err := tx.QueryRow(ctx, `select to_regclass('public.events') is not null`).Scan(&hasEventsTable); err != nil {
		return err
	}
	if !hasEventsTable {
		return nil
	}

	actorName := tenantContext.UserID
	if value, err := repo.getUserDisplayName(ctx, tx, tenantContext.UserID); err == nil && strings.TrimSpace(value) != "" {
		actorName = value
	} else if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}

	_, err := tx.Exec(ctx, `
		insert into public.events (
			organization_id,
			event_type,
			entity_type,
			entity_id,
			payload,
			status
		)
		values (
			$1::uuid,
			'property_created',
			'property',
			$2::uuid,
			$3::jsonb,
			'processed'
		)
	`, tenantContext.OrganizationID, propertyID, jsonb(map[string]any{
		"user_id":         tenantContext.UserID,
		"user_name":       actorName,
		"title":           title,
		"property_id":     propertyID,
		"code":            code,
		"organization_id": tenantContext.OrganizationID,
		"message":         fmt.Sprintf(`Imovel "%s" (Cod: %s) cadastrado`, title, code),
	}))
	return err
}

func (repo Repository) insertPropertyUpdatedActivity(ctx context.Context, tx pgx.Tx, tenantContext tenant.Context, current propertySnapshot, input propertyRequest, property Property) error {
	propertyID, _ := property["id"].(string)
	if propertyID == "" {
		propertyID = current.ID
	}
	if propertyID == "" {
		return nil
	}

	var hasEventsTable bool
	if err := tx.QueryRow(ctx, `select to_regclass('public.events') is not null`).Scan(&hasEventsTable); err != nil {
		return err
	}
	if !hasEventsTable {
		return nil
	}

	title := current.Title
	if value, _ := property["title"].(string); strings.TrimSpace(value) != "" {
		title = value
	}
	if title == "" {
		title = "Imovel"
	}

	changes := map[string]any{}
	eventType := "property_updated"
	message := fmt.Sprintf(`Imovel "%s" atualizado`, title)
	updatedFields := propertyHistoryUpdatedFields(input)
	if len(updatedFields) > 0 {
		message = fmt.Sprintf(`Imovel "%s" editado: %s`, title, strings.Join(updatedFields, ", "))
	}

	if value, ok := input["status"].(string); ok {
		changes["status"] = map[string]any{
			"from": displayPropertyStatus(current.Status),
			"to":   displayPropertyStatus(value),
		}
		eventType = "property_status_changed"
		message = fmt.Sprintf(`Imovel "%s" alterado para %s`, title, displayPropertyStatus(value))
	}
	if value, ok := input["preco"]; ok {
		changes["preco"] = value
		if eventType == "property_updated" {
			eventType = "property_price_updated"
			message = fmt.Sprintf(`Valor de venda do imovel "%s" atualizado`, title)
		}
	}
	if value, ok := input["valor_locacao"]; ok {
		changes["valor_locacao"] = value
		if eventType == "property_updated" {
			eventType = "property_price_updated"
			message = fmt.Sprintf(`Valor de locacao do imovel "%s" atualizado`, title)
		}
	}
	if value, ok := input["published_on_site"]; ok {
		changes["published_on_site"] = value
		if eventType == "property_updated" {
			eventType = "property_publication_changed"
			message = fmt.Sprintf(`Publicacao do imovel "%s" atualizada`, title)
		}
	}
	if value, ok := input["anunciar"]; ok {
		changes["anunciar"] = value
		if eventType == "property_updated" {
			eventType = "property_publication_changed"
			message = fmt.Sprintf(`Publicacao do imovel "%s" atualizada`, title)
		}
	}
	if value, ok := input["metadata"]; ok {
		changes["metadata"] = value
	}

	actorName := tenantContext.UserID
	if value, err := repo.getUserDisplayName(ctx, tx, tenantContext.UserID); err == nil && strings.TrimSpace(value) != "" {
		actorName = value
	} else if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}

	_, err := tx.Exec(ctx, `
		insert into public.events (
			organization_id,
			event_type,
			entity_type,
			entity_id,
			payload,
			status
		)
		values (
			$1::uuid,
			$2,
			'property',
			$3::uuid,
			$4::jsonb,
			'processed'
		)
	`, tenantContext.OrganizationID, eventType, propertyID, jsonb(map[string]any{
		"user_id":         tenantContext.UserID,
		"user_name":       actorName,
		"title":           title,
		"property_id":     propertyID,
		"code":            current.Code,
		"organization_id": tenantContext.OrganizationID,
		"message":         message,
		"changes":         changes,
		"updated_fields":  updatedFields,
	}))
	return err
}

func propertyHistoryUpdatedFields(input propertyRequest) []string {
	fields := make([]string, 0, len(input))
	for field := range input {
		if field == "updated_at" {
			continue
		}
		fields = append(fields, propertyHistoryFieldLabel(field))
	}
	sort.Strings(fields)
	return fields
}

func propertyHistoryFieldLabel(field string) string {
	labels := map[string]string{
		"aceita_financiamento": "Financiamento",
		"aceita_permuta":       "Permuta",
		"anunciar":             "Anuncio",
		"banheiros":            "Banheiros",
		"bairro":               "Bairro",
		"cadastrado_por":       "Captador",
		"cidade":               "Cidade",
		"code":                 "Codigo",
		"condominio_id":        "Condominio",
		"created_by":           "Criado por",
		"descricao":            "Descricao",
		"destaque":             "Destaque",
		"endereco":             "Endereco",
		"finalidade":           "Finalidade",
		"iptu":                 "IPTU",
		"metadata":             "Dados adicionais",
		"mobiliado":            "Mobilia",
		"preco":                "Valor de venda",
		"published_on_site":    "Publicacao no site",
		"quartos":              "Quartos",
		"responsible_user_id":  "Responsavel",
		"status":               "Status",
		"suites":               "Suites",
		"tipo":                 "Tipo",
		"tipo_de_imovel":       "Tipo de imovel",
		"tipo_de_negocio":      "Modalidade",
		"title":                "Titulo",
		"valor_condominio":     "Condominio",
		"valor_locacao":        "Valor de locacao",
		"vagas":                "Vagas",
	}
	if label, ok := labels[field]; ok {
		return label
	}
	return strings.ReplaceAll(field, "_", " ")
}

func (repo Repository) getUserDisplayName(ctx context.Context, tx pgx.Tx, userID string) (string, error) {
	var name, email pgtype.Text
	err := tx.QueryRow(ctx, `
		select name, email
		from public.users
		where id = $1::uuid
	`, userID).Scan(&name, &email)
	if err != nil {
		return "", err
	}

	if value := textValue(name); value != "" {
		return value, nil
	}
	if value := textValue(email); value != "" {
		return value, nil
	}

	return userID, nil
}

func (repo Repository) removeDemoProperties(ctx context.Context, tx pgx.Tx, organizationID string) error {
	_, err := tx.Exec(ctx, `
		delete from public.properties
		where organization_id = $1::uuid
		  and metadata ->> 'is_demo' = 'true'
	`, organizationID)
	return err
}

func mutationParts(input propertyRequest, firstPlaceholder int) ([]string, []string, []any) {
	keys := sortedMutationKeys(input)
	columns := make([]string, 0, len(keys))
	placeholders := make([]string, 0, len(keys))
	args := make([]any, 0, len(keys))

	for _, key := range keys {
		def := writableColumns[key]
		args = append(args, input[key])
		columns = append(columns, def.column)
		placeholders = append(placeholders, typedPlaceholder(firstPlaceholder+len(args)-1, def.kind))
	}

	return columns, placeholders, args
}

func updateParts(input propertyRequest, firstPlaceholder int) ([]string, []any) {
	keys := sortedMutationKeys(input)
	assignments := make([]string, 0, len(keys))
	args := make([]any, 0, len(keys))

	for _, key := range keys {
		def := writableColumns[key]
		args = append(args, input[key])
		placeholder := typedPlaceholder(firstPlaceholder+len(args)-1, def.kind)
		if def.column == "metadata" {
			assignments = append(assignments, fmt.Sprintf("%s = coalesce(%s, '{}'::jsonb) || %s", def.column, def.column, placeholder))
			continue
		}
		assignments = append(assignments, fmt.Sprintf("%s = %s", def.column, placeholder))
	}

	return assignments, args
}

func sortedMutationKeys(input propertyRequest) []string {
	keys := make([]string, 0, len(input))
	for key := range input {
		if _, ok := writableColumns[key]; ok {
			keys = append(keys, key)
		}
	}
	sort.Strings(keys)
	return keys
}

func typedPlaceholder(index int, kind fieldKind) string {
	placeholder := fmt.Sprintf("$%d", index)
	switch kind {
	case fieldBool:
		return placeholder + "::boolean"
	case fieldInt:
		return placeholder + "::integer"
	case fieldNumeric:
		return placeholder + "::numeric"
	case fieldUUID:
		return placeholder + "::uuid"
	case fieldDate:
		return placeholder + "::date"
	case fieldJSON:
		return placeholder + "::jsonb"
	case fieldTextArray:
		return placeholder + "::text[]"
	default:
		return placeholder
	}
}

type jsonTextProperty Property

func (property *jsonTextProperty) Scan(value any) error {
	var raw string
	switch typed := value.(type) {
	case string:
		raw = typed
	case []byte:
		raw = string(typed)
	default:
		return fmt.Errorf("cannot scan property json from %T", value)
	}

	out := map[string]any{}
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return err
	}
	*property = jsonTextProperty(out)
	return nil
}

func scanPropertyWithTotal(row scanner) (Property, int64, error) {
	var total int64
	property, err := scanPropertyFields(row, &total)
	return property, total, err
}

func scanProperty(row scanner) (Property, error) {
	return scanPropertyFields(row, nil)
}

func scanPropertyFields(row scanner, total *int64) (Property, error) {
	var property Property
	dest := []any{(*jsonTextProperty)(&property)}
	if total != nil {
		dest = append([]any{total}, dest...)
	}
	if err := row.Scan(dest...); err != nil {
		return nil, err
	}
	return normalizePropertyOutput(property), nil
}

func normalizePropertyOutput(property Property) Property {
	if property == nil {
		return property
	}

	if _, ok := property["tipo_de_imovel"]; !ok {
		property["tipo_de_imovel"] = anyString(property["tipo"])
	}
	dealType := anyString(property["tipo_de_negocio"])
	if normalizedDealTypeForFilter(dealType) == "" {
		dealType = anyString(property["finalidade"])
	}
	property["tipo_de_negocio"] = displayDealType(dealType)
	if usage := anyString(property["finalidade_uso"]); usage != "" {
		property["finalidade"] = usage
	}
	property["status"] = displayPropertyStatus(anyString(property["status"]))
	property["destaque"] = anyBool(property["is_featured"])
	property["anunciar"] = anyBool(property["published_on_site"])
	if addressVisibility := anyString(property["address_visibility"]); addressVisibility != "" {
		property["public_address_visibility"] = addressVisibility
	}
	if originMedia := anyString(property["origin_media"]); originMedia != "" {
		property["owner_media_source"] = originMedia
	}
	if documents := property["documents"]; documents != nil {
		property["arquivos"] = documents
	}

	responsibleID := anyString(property["responsible_user_id"])
	if responsibleID == "" {
		responsibleID = anyString(property["created_by"])
	}
	property["cadastrado_por"] = responsibleID

	imageURLs := anyStringSlice(property["image_urls"])
	if len(imageURLs) == 0 {
		imageURLs = anyStringSlice(property["fotos"])
	}
	property["fotos"] = imageURLs
	if mainImage := anyString(property["imagem_principal"]); mainImage == "" {
		if len(imageURLs) > 0 {
			property["imagem_principal"] = imageURLs[0]
		} else {
			property["imagem_principal"] = ""
		}
	}

	metadata, _ := property["metadata"].(map[string]any)
	legacy, _ := metadata["legacy"].(map[string]any)
	for key, value := range legacy {
		if _, exists := property[key]; !exists {
			property[key] = value
		}
	}

	return property
}

func anyString(value any) string {
	text, _ := value.(string)
	return text
}

func anyBool(value any) bool {
	boolean, _ := value.(bool)
	return boolean
}

func anyStringSlice(value any) []string {
	switch typed := value.(type) {
	case []string:
		return typed
	case []any:
		out := make([]string, 0, len(typed))
		for _, item := range typed {
			if text, ok := item.(string); ok && text != "" {
				out = append(out, text)
			}
		}
		return out
	default:
		return []string{}
	}
}

func displayDealType(value string) string {
	normalized, err := normalizeDealType(value)
	if err != nil {
		return "Venda"
	}
	switch normalized {
	case "locacao":
		return "Aluguel"
	case "lancamento":
		return "Lan\u00e7amento"
	case "temporada":
		return "Temporada"
	case "venda_locacao":
		return "Venda e Aluguel"
	default:
		return "Venda"
	}
}

func displayPropertyStatus(value string) string {
	switch normalizeASCII(value) {
	case "draft", "rascunho":
		return "rascunho"
	case "sold", "vendido":
		return "vendido"
	case "reserved", "reservado":
		return "reservado"
	case "rented", "alugado", "locado":
		return "alugado"
	case "inactive", "inativo":
		return "inativo"
	case "archived", "arquivado":
		return "arquivado"
	default:
		return "ativo"
	}
}

func jsonb(value any) string {
	payload, err := json.Marshal(value)
	if err != nil {
		return "{}"
	}
	return string(payload)
}

func textValue(value pgtype.Text) string {
	if !value.Valid {
		return ""
	}
	return value.String
}

func normalizeUUID(value string) (string, bool) {
	var uuid pgtype.UUID
	if err := uuid.Scan(strings.TrimSpace(value)); err != nil {
		return "", false
	}
	if !uuid.Valid {
		return "", false
	}
	return uuid.String(), true
}

func propertyPrefix(propertyType string) string {
	normalized := normalizeASCII(propertyType)
	switch normalized {
	case "casa", "sobrado", "condominio", "casa de condominio":
		return "CA"
	case "apartamento", "cobertura", "kitnet", "flat", "loft", "studio":
		return "AP"
	case "comercial", "sala comercial", "loja":
		return "CO"
	case "galpao":
		return "GA"
	case "terreno", "lote":
		return "TR"
	case "sitio", "chacara":
		return "SI"
	case "fazenda":
		return "FA"
	default:
		return "IM"
	}
}

func normalizeASCII(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	replacer := strings.NewReplacer(
		"\u00e1", "a", "\u00e0", "a", "\u00e2", "a", "\u00e3", "a",
		"\u00e9", "e", "\u00ea", "e",
		"\u00ed", "i",
		"\u00f3", "o", "\u00f4", "o", "\u00f5", "o",
		"\u00fa", "u",
		"\u00e7", "c",
	)
	return replacer.Replace(value)
}

func canManageProperties(tenantContext tenant.Context) bool {
	return tenantContext.IsSuperAdmin ||
		tenantContext.HasRole("owner", "admin", "manager") ||
		tenantContext.HasPermission("property_manage")
}

func canCreateProperties(tenantContext tenant.Context) bool {
	if canManageProperties(tenantContext) || tenantContext.HasPermission("property_create") {
		return true
	}
	return tenantContext.IsOrganizationMember()
}

func canCreatePropertyOwners(tenantContext tenant.Context) bool {
	if canManageProperties(tenantContext) || tenantContext.HasPermission("property_owner_create") {
		return true
	}
	return tenantContext.IsOrganizationMember()
}

func canAssignProperties(tenantContext tenant.Context) bool {
	return canManageProperties(tenantContext) || tenantContext.HasPermission("property_assign")
}

func isPropertyAssignmentChange(input propertyRequest, current propertySnapshot) bool {
	if value, ok := input["created_by"]; ok && !sameOptionalUUID(value, current.CreatorID) {
		return true
	}
	if value, ok := input["responsible_user_id"]; ok && !sameOptionalUUID(value, current.ResponsibleUserID) {
		return true
	}
	if value, ok := input["cadastrado_por"]; ok && !sameOptionalUUID(value, current.ResponsibleUserID) {
		return true
	}
	return false
}

func sameOptionalUUID(value any, current string) bool {
	var next string
	switch typed := value.(type) {
	case nil:
		next = ""
	case string:
		next = strings.TrimSpace(typed)
	default:
		next = strings.TrimSpace(fmt.Sprint(typed))
	}
	return next == strings.TrimSpace(current)
}

func canEditProperty(tenantContext tenant.Context, creatorID string, responsibleUserID string, editPolicy ...string) bool {
	if canManageProperties(tenantContext) {
		return true
	}
	if len(editPolicy) > 0 && editPolicy[0] == "everyone" && tenantContext.UserID != "" {
		return true
	}
	return (creatorID != "" && creatorID == tenantContext.UserID) ||
		(responsibleUserID != "" && responsibleUserID == tenantContext.UserID)
}

func canUpdatePropertyAvailability(tenantContext tenant.Context, input propertyRequest) bool {
	return tenantContext.IsOrganizationMember() && isPropertyAvailabilityUpdate(input)
}

func isPropertyAvailabilityUpdate(input propertyRequest) bool {
	if len(input) == 0 {
		return false
	}

	for key := range input {
		switch key {
		case "status":
			status, ok := input[key].(string)
			if !ok || !isQuickPropertyStatus(status) {
				return false
			}
		case "published_on_site":
		default:
			return false
		}
	}

	return true
}

func isQuickPropertyStatus(status string) bool {
	switch status {
	case "active", "reserved", "sold", "rented":
		return true
	default:
		return false
	}
}

func canDeleteProperties(tenantContext tenant.Context) bool {
	return tenantContext.IsSuperAdmin ||
		tenantContext.HasRole("owner", "admin") ||
		tenantContext.HasPermission("property_delete")
}
