package site

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/searchtext"
	"net/url"
	"strings"
)

func (repo Repository) queryJSONRows(ctx context.Context, sql string, args ...any) ([]map[string]any, error) {
	rows, err := repo.db.Pool().Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []map[string]any{}
	for rows.Next() {
		var raw []byte
		if err := rows.Scan(&raw); err != nil {
			return nil, err
		}
		var item map[string]any
		if err := json.Unmarshal(raw, &item); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (repo Repository) queryJSONObject(ctx context.Context, sql string, args ...any) (map[string]any, error) {
	var raw []byte
	if err := repo.db.Pool().QueryRow(ctx, sql, args...).Scan(&raw); err != nil {
		return nil, err
	}
	var item map[string]any
	if err := json.Unmarshal(raw, &item); err != nil {
		return nil, err
	}
	return item, nil
}

func (repo Repository) queryStringArray(ctx context.Context, sql string, args ...any) ([]string, error) {
	var raw []byte
	if err := repo.db.Pool().QueryRow(ctx, sql, args...).Scan(&raw); err != nil {
		return nil, err
	}
	return decodePublicStringArray(raw)
}

func decodePublicStringArray(raw []byte) ([]string, error) {
	items := []string{}
	if err := json.Unmarshal(raw, &items); err != nil {
		return nil, err
	}
	return items, nil
}

func publicPropertyWhereClauses(values url.Values, mode string, args *[]any) []string {
	where := []string{
		"p.organization_id = $1::uuid",
		publicPropertyEligibilitySQL(),
		publicPropertyActiveSQL(),
	}
	add := func(value any, clause string) {
		*args = append(*args, value)
		where = append(where, fmt.Sprintf(clause, len(*args)))
	}

	if search := strings.TrimSpace(values.Get("search")); search != "" {
		*args = append(*args, searchtext.Pattern(search))
		placeholder := len(*args)
		where = append(where, searchtext.AnySQL(
			[]string{
				publicPropertyTextSQL("titulo", "p.title"),
				publicPropertyTextSQL("codigo", "p.code"),
				publicPropertyTextSQL("bairro", "p.bairro"),
				publicPropertyTextSQL("cidade", "p.cidade"),
			},
			fmt.Sprintf("$%d", placeholder),
		))
	}
	if tipo := strings.TrimSpace(values.Get("tipo")); tipo != "" {
		add(searchtext.Normalize(tipo), searchtext.SQL("trim("+publicPropertyTextSQL("tipo_imovel", "p.tipo")+")")+" = $%d::text")
	}
	if finalidade := strings.TrimSpace(values.Get("finalidade")); finalidade != "" {
		aliases := publicDealTypeAliases(finalidade)
		if len(aliases) > 0 {
			add(aliases, "(lower(trim(coalesce("+publicPropertyTextSQL("finalidade", "p.finalidade")+", ''))) = any($%[1]d::text[]) or lower(trim(coalesce(p.tipo_de_negocio, ''))) = any($%[1]d::text[]))")
		}
	}
	if cidade := strings.TrimSpace(values.Get("cidade")); cidade != "" {
		add(searchtext.Normalize(cidade), searchtext.SQL("trim("+publicPropertyTextSQL("cidade", "p.cidade")+")")+" = $%d::text")
	}
	if bairro := strings.TrimSpace(values.Get("bairro")); bairro != "" {
		add(searchtext.Normalize(bairro), searchtext.SQL("trim("+publicPropertyTextSQL("bairro", "p.bairro")+")")+" = $%d::text")
	}
	if condominio := strings.TrimSpace(values.Get("condominio")); condominio != "" {
		// Condominium is an exact-location discriminator. Public filtering may use
		// only the immutable value captured by a complete-address publication;
		// compatibility rows deliberately have no live-table fallback.
		add(searchtext.Normalize(condominio), searchtext.SQL("trim("+publicPropertyTextSQL("condominio_nome", "null::text")+")")+" = $%d::text")
	}
	if ids := parsePublicUUIDList(values.Get("ids"), 60); len(ids) > 0 {
		add(ids, "p.id::text = any($%d::text[])")
	}
	where = addPublicPriceRangeFilter(where, values, args)
	if minUsableArea, ok := parsePublicDecimal(values.Get("area_util_min")); ok {
		add(minUsableArea, "coalesce("+publicPropertyNumberSQL("area_construida", "p.area_util")+", 0) >= $%d")
	}
	if maxUsableArea, ok := parsePublicDecimal(values.Get("area_util_max")); ok {
		add(maxUsableArea, "coalesce("+publicPropertyNumberSQL("area_construida", "p.area_util")+", 0) <= $%d")
	}
	if minTotalArea, ok := parsePublicDecimal(values.Get("area_total_min")); ok {
		add(minTotalArea, "coalesce("+publicPropertyNumberSQL("area_total", "p.area_total")+", 0) >= $%d")
	}
	if maxTotalArea, ok := parsePublicDecimal(values.Get("area_total_max")); ok {
		add(maxTotalArea, "coalesce("+publicPropertyNumberSQL("area_total", "p.area_total")+", 0) <= $%d")
	}
	for _, item := range []struct {
		param  string
		column string
	}{
		{"quartos", "quartos"},
		{"suites", "suites"},
		{"banheiros", "banheiros"},
		{"vagas", "vagas"},
	} {
		if value, ok := parsePublicInt(values.Get(item.param)); ok {
			add(value, "coalesce("+publicPropertyNumberSQL(item.column, "p."+item.column)+", 0) >= $%d")
		}
	}
	if acceptsFinancing, ok := parsePublicBool(values.Get("aceita_financiamento")); ok {
		add(acceptsFinancing, "coalesce("+publicPropertyBooleanSQL("aceita_financiamento", "p.aceita_financiamento")+", false) = $%d::boolean")
	}
	if acceptsExchange, ok := parsePublicBool(values.Get("aceita_permuta")); ok {
		add(acceptsExchange, "coalesce("+publicPropertyBooleanSQL("aceita_permuta", "p.aceita_permuta")+", false) = $%d::boolean")
	}
	if mobilia := strings.ToLower(strings.TrimSpace(values.Get("mobilia"))); mobilia != "" && mobilia != "all" {
		if mobilia == "mobiliado" || mobilia == "true" || mobilia == "sim" || mobilia == "1" {
			where = append(where, publicPropertyBooleanSQL("mobiliado", "p.mobiliado")+" = true")
		} else if mobilia == "nao" || mobilia == "não" || mobilia == "false" || mobilia == "0" {
			where = append(where, publicPropertyBooleanSQL("mobiliado", "p.mobiliado")+" = false")
		}
	}

	switch mode {
	case "featured":
		where = append(where, publicPropertyBooleanSQL("destaque", "p.is_featured")+" = true")
	case "exclusive":
		where = append(where, publicPropertyBooleanSQL("exclusividade", "p.exclusividade")+" = true")
	}

	return where
}

func parsePublicUUIDList(raw string, maxItems int) []string {
	if maxItems <= 0 {
		maxItems = 60
	}
	seen := map[string]bool{}
	items := []string{}
	for _, part := range strings.Split(raw, ",") {
		if len(items) >= maxItems {
			break
		}
		value, ok := normalizeUUID(part)
		if !ok || seen[value] {
			continue
		}
		seen[value] = true
		items = append(items, value)
	}
	return items
}

func addPublicPriceRangeFilter(where []string, values url.Values, args *[]any) []string {
	minPrice, hasMin := parsePublicDecimal(values.Get("min_price"))
	maxPrice, hasMax := parsePublicDecimal(values.Get("max_price"))
	if !hasMin && !hasMax {
		return where
	}

	minPlaceholder := 0
	maxPlaceholder := 0
	if hasMin {
		*args = append(*args, minPrice)
		minPlaceholder = len(*args)
	}
	if hasMax {
		*args = append(*args, maxPrice)
		maxPlaceholder = len(*args)
	}

	columnRange := func(expression string) string {
		clauses := make([]string, 0, 2)
		if minPlaceholder > 0 {
			clauses = append(clauses, fmt.Sprintf("(%s) >= $%d::numeric", expression, minPlaceholder))
		}
		if maxPlaceholder > 0 {
			clauses = append(clauses, fmt.Sprintf("(%s) <= $%d::numeric", expression, maxPlaceholder))
		}
		return "(" + strings.Join(clauses, " and ") + ")"
	}

	saleRange := columnRange(publicPropertyNumberSQL("valor_venda", "p.preco"))
	rentalRange := columnRange(publicPropertyNumberSQL("valor_aluguel", "p.valor_locacao"))
	switch publicPriceFilterMode(values.Get("finalidade")) {
	case "sale":
		where = append(where, saleRange)
	case "rental":
		where = append(where, rentalRange)
	default:
		where = append(where, "("+saleRange+" or "+rentalRange+")")
	}

	return where
}

func publicPriceFilterMode(value string) string {
	switch searchtext.Normalize(value) {
	case "venda", "sale", "lancamento", "launch", "release":
		return "sale"
	case "locacao", "locacao anual", "aluguel", "rent", "temporada", "season":
		return "rental"
	default:
		return "any"
	}
}
func publicDealTypeAliases(dealType string) []string {
	switch strings.ToLower(strings.TrimSpace(dealType)) {
	case "venda", "sale":
		return []string{
			"venda",
			"sale",
			"venda_locacao",
			"venda e aluguel",
			"venda e locacao",
			"venda e locaÃ§Ã£o",
			"venda/locacao",
			"venda/locaÃ§Ã£o",
			"venda/aluguel",
		}
	case "locacao", "loca\u00e7\u00e3o", "locaÃ§Ã£o", "aluguel", "rent":
		return []string{
			"locacao",
			"loca\u00e7\u00e3o",
			"locaÃ§Ã£o",
			"aluguel",
			"locacao anual",
			"loca\u00e7\u00e3o anual",
			"locaÃ§Ã£o anual",
			"rent",
			"venda_locacao",
			"venda e aluguel",
			"venda e locacao",
			"venda e loca\u00e7\u00e3o",
			"venda e locaÃ§Ã£o",
			"venda/locacao",
			"venda/loca\u00e7\u00e3o",
			"venda/locaÃ§Ã£o",
			"venda/aluguel",
		}
	case "temporada", "season":
		return []string{"temporada", "season"}
	case "lancamento", "lanÃ§amento", "launch", "release":
		return []string{"lancamento", "lanÃ§amento", "launch", "release"}
	case "venda_locacao", "venda e aluguel", "venda locacao", "venda locação", "venda/locacao", "venda/locação", "venda/aluguel":
		return []string{
			"venda_locacao",
			"venda e aluguel",
			"venda e locacao",
			"venda e loca\u00e7\u00e3o",
			"venda e locaÃ§Ã£o",
			"venda/locacao",
			"venda/loca\u00e7\u00e3o",
			"venda/locaÃ§Ã£o",
			"venda/aluguel",
		}
	default:
		if strings.TrimSpace(dealType) == "" {
			return []string{}
		}
		return []string{strings.ToLower(strings.TrimSpace(dealType))}
	}
}

func publicPropertyActiveSQL() string {
	return "lower(trim(coalesce(p.status, ''))) in ('active', 'ativo')"
}

func publicPropertySnapshotJoinSQL() string {
	return `public.properties p
	left join lateral (
		select version.payload->'property' as payload
		from public.property_channel_publications as publication
		join public.property_channel_publication_versions as version
		  on version.publication_id = publication.id
		 and version.organization_id = publication.organization_id
		 and version.property_id = publication.property_id
		 and version.channel = publication.channel
		 and version.channel_account_key = publication.channel_account_key
		 and version.version = publication.published_version
		where publication.organization_id = p.organization_id
		  and publication.property_id = p.id
		  and publication.channel = 'site'
		  and publication.channel_account_key = 'default'
		  and publication.desired_state = 'published'
		  and publication.published_version is not null
		limit 1
	) as publication_snapshot on true`
}

func publicPropertyEligibilitySQL() string {
	return `(publication_snapshot.payload is not null or (
		coalesce(p.published_on_site, false) = true
		and not exists (
			select 1
			from public.property_channel_publications as publication_state
			where publication_state.organization_id = p.organization_id
			  and publication_state.property_id = p.id
			  and publication_state.channel = 'site'
			  and publication_state.channel_account_key = 'default'
		)
	))`
}

func publicPropertyStandaloneEligibilitySQL(alias string) string {
	return `(exists (
		select 1
		from public.property_channel_publications as publication
		join public.property_channel_publication_versions as version
		  on version.publication_id = publication.id
		 and version.organization_id = publication.organization_id
		 and version.property_id = publication.property_id
		 and version.channel = publication.channel
		 and version.channel_account_key = publication.channel_account_key
		 and version.version = publication.published_version
		where publication.organization_id = ` + alias + `.organization_id
		  and publication.property_id = ` + alias + `.id
		  and publication.channel = 'site'
		  and publication.channel_account_key = 'default'
		  and publication.desired_state = 'published'
		  and publication.published_version is not null
	) or (
		coalesce(` + alias + `.published_on_site, false) = true
		and not exists (
			select 1
			from public.property_channel_publications as publication_state
			where publication_state.organization_id = ` + alias + `.organization_id
			  and publication_state.property_id = ` + alias + `.id
			  and publication_state.channel = 'site'
			  and publication_state.channel_account_key = 'default'
		)
	))`
}

func publicPropertyOutputSQL() string {
	return `case
		when publication_snapshot.payload is not null then
			case when ` + publicSnapshotHasCompleteAddressSQL() + `
				then publication_snapshot.payload - 'valor_venda_avaliado' - 'valor_locacao_avaliado'
				else publication_snapshot.payload - 'valor_venda_avaliado' - 'valor_locacao_avaliado' - 'condominio_nome'
			end
		else ` + publicPropertyJSONSQL() + `
	end`
}

func publicPropertyTextSQL(snapshotKey string, legacySQL string) string {
	if snapshotKey == "condominio_nome" {
		// Condominium names are exact-location data. Old or malformed snapshots
		// fail closed unless their own frozen privacy marker is canonical/full.
		return `case when publication_snapshot.payload is not null
			and ` + publicSnapshotHasCompleteAddressSQL() + `
			then nullif(publication_snapshot.payload->>'condominio_nome', '')
			else null::text end`
	}
	if snapshotKey == "bairro" {
		legacySQL = `(case when ` + publicAddressVisibilitySQL("p") + ` = 'minimo' then null else ` + legacySQL + ` end)`
	}
	return `case when publication_snapshot.payload is not null
		then nullif(publication_snapshot.payload->>'` + snapshotKey + `', '')
		else ` + legacySQL + ` end`
}

func publicSnapshotHasCompleteAddressSQL() string {
	return "lower(trim(coalesce(publication_snapshot.payload->>'public_address_visibility', ''))) = 'completo'"
}

func publicPropertyNumberSQL(snapshotKey string, legacySQL string) string {
	return `case when publication_snapshot.payload is not null
		then nullif(publication_snapshot.payload->>'` + snapshotKey + `', '')::numeric
		else ` + legacySQL + ` end`
}

func publicPropertyBooleanSQL(snapshotKey string, legacySQL string) string {
	return `case when publication_snapshot.payload is not null
		then nullif(publication_snapshot.payload->>'` + snapshotKey + `', '')::boolean
		else ` + legacySQL + ` end`
}

func publicAddressVisibilitySQL(alias string) string {
	return `case lower(trim(coalesce(
		nullif(` + alias + `.address_visibility, ''),
		nullif(` + alias + `.public_address_visibility, ''),
		'parcial'
	)))
		when 'completo' then 'completo'
		when 'complete' then 'completo'
		when 'full' then 'completo'
		when 'minimo' then 'minimo'
		when 'minimum' then 'minimo'
		when 'city' then 'minimo'
		when 'cidade' then 'minimo'
		else 'parcial'
	end`
}

func publicPropertyJSONSQL() string {
	return `jsonb_build_object(
		'id', p.id::text,
		'codigo', coalesce(p.code, p.id::text),
		'titulo', p.title,
		'descricao', p.descricao_site,
		'tipo_imovel', p.tipo,
		'finalidade', p.finalidade,
		'valor_venda', p.preco,
		'valor_aluguel', p.valor_locacao,
		'valor_condominio', p.condominio,
		'iptu', p.iptu,
		'taxa_de_servico', p.taxa_de_servico,
		'valor_itr', p.valor_itr,
		'seguro_incendio', p.seguro_incendio,
		'quartos', p.quartos,
		'suites', p.suites,
		'banheiros', p.banheiros,
		'vagas', p.vagas,
		'area_total', p.area_total,
		'area_construida', p.area_util,
		'andar', p.andar,
		'public_address_visibility', ` + publicAddressVisibilitySQL("p") + `,
		'bairro', case when ` + publicAddressVisibilitySQL("p") + ` = 'minimo' then null else p.bairro end,
		'cidade', p.cidade,
		'estado', p.uf,
		'pais', case when ` + publicAddressVisibilitySQL("p") + ` = 'completo' then coalesce(nullif(p.pais, ''), 'Brasil') else null end,
		'endereco', case when ` + publicAddressVisibilitySQL("p") + ` = 'completo' then p.endereco else null end,
		'numero', case when ` + publicAddressVisibilitySQL("p") + ` = 'completo' then p.numero else null end,
		'complemento', case when ` + publicAddressVisibilitySQL("p") + ` = 'completo' then p.complemento else null end,
		'cep', case when ` + publicAddressVisibilitySQL("p") + ` = 'completo' then p.cep else null end,
		'latitude', case when ` + publicAddressVisibilitySQL("p") + ` = 'completo' then p.latitude else null end,
		'longitude', case when ` + publicAddressVisibilitySQL("p") + ` = 'completo' then p.longitude else null end,
		'imagem_principal', (
			select img.url
			from unnest(array_remove(array_prepend(nullif(p.imagem_principal, ''), array_cat(
				coalesce(p.image_urls, '{}'::text[]),
				coalesce((
					select array_agg(nullif(trim(case
						when jsonb_typeof(foto.value) = 'string' then foto.value #>> '{}'
						when jsonb_typeof(foto.value) = 'object' then coalesce(foto.value->>'url', foto.value->>'src', foto.value->>'publicUrl')
						else null
					end), '') order by foto.ord)
					from jsonb_array_elements(case when jsonb_typeof(p.fotos) = 'array' then p.fotos else '[]'::jsonb end) with ordinality as foto(value, ord)
				), '{}'::text[])
			)), null)) with ordinality as img(url, ord)
			where not (coalesce(p.metadata->'hidden_site_image_urls', '[]'::jsonb) ? img.url)
			order by img.ord
			limit 1
		),
		'fotos', coalesce((
			select jsonb_agg(img.url order by img.ord)
			from unnest(array_remove(array_prepend(nullif(p.imagem_principal, ''), array_cat(
				coalesce(p.image_urls, '{}'::text[]),
				coalesce((
					select array_agg(nullif(trim(case
						when jsonb_typeof(foto.value) = 'string' then foto.value #>> '{}'
						when jsonb_typeof(foto.value) = 'object' then coalesce(foto.value->>'url', foto.value->>'src', foto.value->>'publicUrl')
						else null
					end), '') order by foto.ord)
					from jsonb_array_elements(case when jsonb_typeof(p.fotos) = 'array' then p.fotos else '[]'::jsonb end) with ordinality as foto(value, ord)
				), '{}'::text[])
			)), null)) with ordinality as img(url, ord)
			where not (coalesce(p.metadata->'hidden_site_image_urls', '[]'::jsonb) ? img.url)
		), '[]'::jsonb),
		'detalhes_extras', coalesce((
			select jsonb_agg(item.value order by item.value)
			from (
				select distinct nullif(trim(value), '') as value
				from unnest(coalesce(p.detalhes_extras, '{}'::text[])) as value
			) item
			where item.value is not null
		), '[]'::jsonb),
		'proximidades', coalesce((
			select jsonb_agg(item.value order by item.value)
			from (
				select distinct nullif(trim(value), '') as value
				from unnest(coalesce(p.proximidades, '{}'::text[])) as value
			) item
			where item.value is not null
		), '[]'::jsonb),
		'video_imovel', p.video_imovel,
		'tour_virtual', p.tour_virtual,
		'aceita_financiamento', p.aceita_financiamento,
		'aceita_permuta', p.aceita_permuta,
		'usou_fgts', p.usou_fgts,
		'exclusividade', p.exclusividade,
		'destaque', p.is_featured,
		'status', p.status,
		'mobiliado', p.mobiliado
	)`
}
