package site

import (
	"context"
	"errors"
	"fmt"
	"github.com/jackc/pgx/v5"
	"net/url"
	"strconv"
	"strings"
)

func (repo Repository) listPublicProperties(ctx context.Context, organizationID string, values url.Values, mode string, page int, limit int) ([]map[string]any, int64, error) {
	args := []any{organizationID}
	where := publicPropertyWhereClauses(values, mode, &args)
	whereSQL := strings.Join(where, "\n\t\t  and ")

	var total int64
	if err := repo.db.Pool().QueryRow(ctx, `
		select count(*)
		from `+publicPropertySnapshotJoinSQL()+`
		where `+whereSQL, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	offset := (page - 1) * limit
	rowArgs := append([]any{}, args...)
	rowArgs = append(rowArgs, limit, offset)
	limitIndex := len(rowArgs) - 1
	offsetIndex := len(rowArgs)
	properties, err := repo.queryJSONRows(ctx, `
		select `+publicPropertyOutputSQL()+`
		from `+publicPropertySnapshotJoinSQL()+`
		where `+whereSQL+`
		order by `+publicPropertyBooleanSQL("destaque", "p.is_featured")+` desc, p.created_at desc, p.id desc
		limit $`+strconv.Itoa(limitIndex)+` offset $`+strconv.Itoa(offsetIndex), rowArgs...)
	if err != nil {
		return nil, 0, err
	}
	for _, property := range properties {
		redactPublicPropertyInternalValues(property)
	}
	return properties, total, nil
}

func (repo Repository) getPublicProperty(ctx context.Context, organizationID string, code string) (map[string]any, error) {
	code = strings.TrimSpace(code)
	if code == "" {
		return nil, ErrInvalidInput
	}
	args := []any{organizationID, code}
	item, err := repo.queryJSONObject(ctx, `
		select `+publicPropertyOutputSQL()+`
		from `+publicPropertySnapshotJoinSQL()+`
		where p.organization_id = $1::uuid
		  and `+publicPropertyEligibilitySQL()+`
		  and `+publicPropertyActiveSQL()+`
		  and (
		    lower(trim(coalesce(`+publicPropertyTextSQL("codigo", "p.code")+`, ''))) = lower(trim($2::text))
		    or p.id::text = trim($2::text)
		  )
		limit 1
	`, args...)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	redactPublicPropertyInternalValues(item)
	return item, err
}

func redactPublicPropertyInternalValues(property map[string]any) {
	if property == nil {
		return
	}
	delete(property, "valor_venda_avaliado")
	delete(property, "valor_locacao_avaliado")
	visibility, _ := property["public_address_visibility"].(string)
	if !strings.EqualFold(strings.TrimSpace(visibility), "completo") {
		delete(property, "condominio_nome")
	}
}

func (repo Repository) listPublicPropertyTypes(ctx context.Context, organizationID string) ([]string, error) {
	return repo.queryStringArray(ctx, `
		select coalesce(jsonb_agg(value order by value), '[]'::jsonb)
		from (
			select distinct nullif(trim(`+publicPropertyTextSQL("tipo_imovel", "p.tipo")+`), '') as value
			from `+publicPropertySnapshotJoinSQL()+`
			where p.organization_id = $1::uuid
			  and `+publicPropertyEligibilitySQL()+`
			  and `+publicPropertyActiveSQL()+`
		) items
		where value is not null
	`, organizationID)
}

func (repo Repository) listPublicCities(ctx context.Context, organizationID string) ([]string, error) {
	return repo.queryStringArray(ctx, `
		select coalesce(jsonb_agg(value order by value), '[]'::jsonb)
		from (
			select distinct nullif(trim(`+publicPropertyTextSQL("cidade", "p.cidade")+`), '') as value
			from `+publicPropertySnapshotJoinSQL()+`
			where p.organization_id = $1::uuid
			  and `+publicPropertyEligibilitySQL()+`
			  and `+publicPropertyActiveSQL()+`
		) items
		where value is not null
	`, organizationID)
}

func (repo Repository) listPublicNeighborhoods(ctx context.Context, organizationID string, city string) ([]string, error) {
	args := []any{organizationID}
	city = strings.TrimSpace(city)
	cityFilter := ""
	if city != "" {
		args = append(args, city)
		cityFilter = " and lower(trim(coalesce(" + publicPropertyTextSQL("cidade", "p.cidade") + ", ''))) = lower(trim($2::text))"
	}
	return repo.queryStringArray(ctx, `
		select coalesce(jsonb_agg(value order by value), '[]'::jsonb)
		from (
			select distinct nullif(trim(`+publicPropertyTextSQL("bairro", "p.bairro")+`), '') as value
			from `+publicPropertySnapshotJoinSQL()+`
			where p.organization_id = $1::uuid
			  and `+publicPropertyEligibilitySQL()+`
			  and `+publicPropertyActiveSQL()+cityFilter+`
		) items
		where value is not null
	`, args...)
}

func (repo Repository) listPublicCondominiums(ctx context.Context, organizationID string, city string, neighborhood string) ([]string, error) {
	args := []any{organizationID}
	filters := ""
	city = strings.TrimSpace(city)
	neighborhood = strings.TrimSpace(neighborhood)
	if city != "" {
		args = append(args, city)
		filters += fmt.Sprintf(" and lower(trim(coalesce("+publicPropertyTextSQL("cidade", "p.cidade")+", ''))) = lower(trim($%d::text))", len(args))
	}
	if neighborhood != "" {
		args = append(args, neighborhood)
		filters += fmt.Sprintf(" and lower(trim(coalesce("+publicPropertyTextSQL("bairro", "p.bairro")+", ''))) = lower(trim($%d::text))", len(args))
	}

	return repo.queryStringArray(ctx, `
		select coalesce(jsonb_agg(value order by value), '[]'::jsonb)
		from (
			select distinct nullif(trim(`+publicPropertyTextSQL("condominio_nome", "null::text")+`), '') as value
			from `+publicPropertySnapshotJoinSQL()+`
			where p.organization_id = $1::uuid
			  and `+publicPropertyEligibilitySQL()+`
			  and `+publicPropertyActiveSQL()+filters+`
		) items
		where value is not null
	`, args...)
}

func (repo Repository) listPublicPropertyPurposes(ctx context.Context, organizationID string) ([]string, error) {
	return repo.queryStringArray(ctx, `
		select coalesce(jsonb_agg(value order by value), '[]'::jsonb)
		from (
			select distinct nullif(trim(`+publicPropertyTextSQL("finalidade", "p.finalidade")+`), '') as value
			from `+publicPropertySnapshotJoinSQL()+`
			where p.organization_id = $1::uuid
			  and `+publicPropertyEligibilitySQL()+`
			  and `+publicPropertyActiveSQL()+`
		) items
		where value is not null
	`, organizationID)
}

type publicPropertyFilterOptions struct {
	Types         []string
	Cities        []string
	Neighborhoods []string
	Condominiums  []string
	Purposes      []string
}

func (repo Repository) listPublicPropertyFilterOptions(ctx context.Context, organizationID string, city string, neighborhood string) (publicPropertyFilterOptions, error) {
	args := []any{organizationID}
	city = strings.TrimSpace(city)
	neighborhood = strings.TrimSpace(neighborhood)

	cityFilter := ""
	if city != "" {
		args = append(args, city)
		cityFilter = fmt.Sprintf(" and lower(trim(coalesce(p.public_cidade, ''))) = lower(trim($%d::text))", len(args))
	}

	neighborhoodFilter := ""
	if neighborhood != "" {
		args = append(args, neighborhood)
		neighborhoodFilter = fmt.Sprintf(" and lower(trim(coalesce(p.public_bairro, ''))) = lower(trim($%d::text))", len(args))
	}

	var rawTypes []byte
	var rawCities []byte
	var rawNeighborhoods []byte
	var rawCondominiums []byte
	var rawPurposes []byte
	err := repo.db.Pool().QueryRow(ctx, `
		with public_props as (
			select p.*,
			       `+publicPropertyTextSQL("tipo_imovel", "p.tipo")+` as public_tipo,
			       `+publicPropertyTextSQL("cidade", "p.cidade")+` as public_cidade,
			       `+publicPropertyTextSQL("bairro", "p.bairro")+` as public_bairro,
			       `+publicPropertyTextSQL("condominio_nome", "null::text")+` as public_condominio,
			       `+publicPropertyTextSQL("finalidade", "p.finalidade")+` as public_finalidade
			from `+publicPropertySnapshotJoinSQL()+`
			where p.organization_id = $1::uuid
			  and `+publicPropertyEligibilitySQL()+`
			  and `+publicPropertyActiveSQL()+`
		)
		select
			coalesce((
				select jsonb_agg(value order by lower(value), value)
				from (
					select distinct on (lower(trim(p.public_tipo))) nullif(trim(p.public_tipo), '') as value
					from public_props p
					where nullif(trim(p.public_tipo), '') is not null
					order by lower(trim(p.public_tipo)), trim(p.public_tipo)
				) items
			), '[]'::jsonb) as types,
			coalesce((
				select jsonb_agg(value order by lower(value), value)
				from (
					select distinct on (lower(trim(p.public_cidade))) nullif(trim(p.public_cidade), '') as value
					from public_props p
					where nullif(trim(p.public_cidade), '') is not null
					order by lower(trim(p.public_cidade)), trim(p.public_cidade)
				) items
			), '[]'::jsonb) as cities,
			coalesce((
				select jsonb_agg(value order by lower(value), value)
				from (
					select distinct on (lower(trim(p.public_bairro))) nullif(trim(p.public_bairro), '') as value
					from public_props p
					where nullif(trim(p.public_bairro), '') is not null
					`+cityFilter+`
					order by lower(trim(p.public_bairro)), trim(p.public_bairro)
				) items
			), '[]'::jsonb) as neighborhoods,
			coalesce((
				select jsonb_agg(value order by lower(value), value)
				from (
					select distinct on (lower(trim(p.public_condominio))) nullif(trim(p.public_condominio), '') as value
					from public_props p
					where nullif(trim(p.public_condominio), '') is not null
					`+cityFilter+neighborhoodFilter+`
					order by lower(trim(p.public_condominio)), trim(p.public_condominio)
				) items
			), '[]'::jsonb) as condominiums,
			coalesce((
				select jsonb_agg(value order by lower(value), value)
				from (
					select distinct on (lower(trim(p.public_finalidade))) nullif(trim(p.public_finalidade), '') as value
					from public_props p
					where nullif(trim(p.public_finalidade), '') is not null
					order by lower(trim(p.public_finalidade)), trim(p.public_finalidade)
				) items
			), '[]'::jsonb) as purposes
	`, args...).Scan(&rawTypes, &rawCities, &rawNeighborhoods, &rawCondominiums, &rawPurposes)
	if err != nil {
		return publicPropertyFilterOptions{}, err
	}

	types, err := decodePublicStringArray(rawTypes)
	if err != nil {
		return publicPropertyFilterOptions{}, err
	}
	cities, err := decodePublicStringArray(rawCities)
	if err != nil {
		return publicPropertyFilterOptions{}, err
	}
	neighborhoods, err := decodePublicStringArray(rawNeighborhoods)
	if err != nil {
		return publicPropertyFilterOptions{}, err
	}
	condominiums, err := decodePublicStringArray(rawCondominiums)
	if err != nil {
		return publicPropertyFilterOptions{}, err
	}
	purposes, err := decodePublicStringArray(rawPurposes)
	if err != nil {
		return publicPropertyFilterOptions{}, err
	}

	return publicPropertyFilterOptions{
		Types:         types,
		Cities:        cities,
		Neighborhoods: neighborhoods,
		Condominiums:  condominiums,
		Purposes:      purposes,
	}, nil
}
