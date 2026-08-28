package properties

// The workspace is a BFF response, not a database dump. Keep every projection
// explicit so a column added to one of the normalized tables cannot silently
// become part of the public HTTP contract.

func workspaceOfferProjection(alias string, canViewInternal string) string {
	return `jsonb_build_object(
		'id', ` + alias + `.id,
		'organization_id', ` + alias + `.organization_id,
		'property_id', ` + alias + `.property_id,
		'offer_type', ` + alias + `.offer_type,
		'status', ` + alias + `.status,
		'price', ` + alias + `.price,
		'currency', ` + alias + `.currency,
		'price_period', ` + alias + `.price_period,
		'terms', case when ` + canViewInternal + ` then ` + alias + `.terms else '{}'::jsonb end,
		'available_from', ` + alias + `.available_from,
		'available_until', ` + alias + `.available_until,
		'published_at', ` + alias + `.published_at,
		'completed_at', ` + alias + `.completed_at,
		'metadata', case when ` + canViewInternal + ` then ` + alias + `.metadata else '{}'::jsonb end,
		'created_at', ` + alias + `.created_at,
		'updated_at', ` + alias + `.updated_at
	)`
}

func workspaceOwnershipProjection(ownershipAlias string, ownerAlias string, canViewContacts string, canViewInternal string) string {
	return `jsonb_build_object(
		'id', ` + ownershipAlias + `.id,
		'organization_id', ` + ownershipAlias + `.organization_id,
		'property_id', ` + ownershipAlias + `.property_id,
		'owner_id', ` + ownershipAlias + `.owner_id,
		'ownership_percentage', ` + ownershipAlias + `.ownership_percentage,
		'is_primary', ` + ownershipAlias + `.is_primary,
		'valid_from', ` + ownershipAlias + `.valid_from,
		'valid_to', ` + ownershipAlias + `.valid_to,
		'notes', case when ` + canViewInternal + ` then ` + ownershipAlias + `.notes else null end,
		'owner', jsonb_strip_nulls(jsonb_build_object(
			'id', ` + ownerAlias + `.id,
			'name', ` + ownerAlias + `.name,
			'is_active', ` + ownerAlias + `.is_active,
			'phone_residential', case when ` + canViewContacts + ` then ` + ownerAlias + `.phone_residential else null end,
			'phone_commercial', case when ` + canViewContacts + ` then ` + ownerAlias + `.phone_commercial else null end,
			'cellphone', case when ` + canViewContacts + ` then ` + ownerAlias + `.cellphone else null end,
			'email', case when ` + canViewContacts + ` then ` + ownerAlias + `.email else null end,
			'notify_email', case when ` + canViewContacts + ` then ` + ownerAlias + `.notify_email else null end,
			'media_source', case when ` + canViewContacts + ` then ` + ownerAlias + `.media_source else null end,
			'notes', case when ` + canViewInternal + ` then ` + ownerAlias + `.notes else null end,
			'created_at', ` + ownerAlias + `.created_at,
			'updated_at', ` + ownerAlias + `.updated_at
		)),
		'created_at', ` + ownershipAlias + `.created_at,
		'updated_at', ` + ownershipAlias + `.updated_at
	)`
}

func workspaceAssetProjectionWithAccessPath(alias string, canViewInternal string) string {
	return `(` + workspaceAssetProjection(alias, canViewInternal) + ` || jsonb_build_object(
		'_storage_path_for_access', ` + alias + `.storage_path
	))`
}

func workspaceOwnerProjection(alias string, canViewContacts string, canViewInternal string) string {
	return `jsonb_strip_nulls(jsonb_build_object(
		'id', ` + alias + `.id,
		'organization_id', ` + alias + `.organization_id,
		'name', ` + alias + `.name,
		'is_active', ` + alias + `.is_active,
		'phone_residential', case when ` + canViewContacts + ` then ` + alias + `.phone_residential else null end,
		'phone_commercial', case when ` + canViewContacts + ` then ` + alias + `.phone_commercial else null end,
		'cellphone', case when ` + canViewContacts + ` then ` + alias + `.cellphone else null end,
		'email', case when ` + canViewContacts + ` then ` + alias + `.email else null end,
		'notify_email', case when ` + canViewContacts + ` then ` + alias + `.notify_email else null end,
		'media_source', case when ` + canViewContacts + ` then ` + alias + `.media_source else null end,
		'notes', case when ` + canViewInternal + ` then ` + alias + `.notes else null end,
		'created_at', ` + alias + `.created_at,
		'updated_at', ` + alias + `.updated_at
	))`
}

func workspaceAssetProjection(alias string, canViewInternal string) string {
	return `jsonb_build_object(
		'id', ` + alias + `.id,
		'organization_id', ` + alias + `.organization_id,
		'property_id', ` + alias + `.property_id,
		'asset_type', ` + alias + `.asset_type,
		'visibility', ` + alias + `.visibility,
		'storage_path', case when ` + canViewInternal + ` then ` + alias + `.storage_path else null end,
		'external_url', ` + alias + `.external_url,
		'title', ` + alias + `.title,
		'description', ` + alias + `.description,
		'file_name', ` + alias + `.file_name,
		'mime_type', ` + alias + `.mime_type,
		'file_size_bytes', ` + alias + `.file_size_bytes,
		'sort_order', ` + alias + `.sort_order,
		'is_primary', ` + alias + `.is_primary,
		'document_category', ` + alias + `.document_category,
		'expires_at', ` + alias + `.expires_at,
		'metadata', case
			when ` + canViewInternal + ` then ` + alias + `.metadata
			else jsonb_strip_nulls(jsonb_build_object('url', ` + alias + `.metadata -> 'url'))
		end,
		'created_at', ` + alias + `.created_at,
		'updated_at', ` + alias + `.updated_at
	)`
}

func workspaceKeyProjection(alias string) string {
	return `jsonb_build_object(
		'id', ` + alias + `.id,
		'organization_id', ` + alias + `.organization_id,
		'property_id', ` + alias + `.property_id,
		'label', ` + alias + `.label,
		'key_code', ` + alias + `.key_code,
		'status', ` + alias + `.status,
		'current_location', ` + alias + `.current_location,
		'holder_user_id', ` + alias + `.holder_user_id,
		'holder_name', ` + alias + `.holder_name,
		'checked_out_at', ` + alias + `.checked_out_at,
		'expected_return_at', ` + alias + `.expected_return_at,
		'notes', ` + alias + `.notes,
		'metadata', ` + alias + `.metadata,
		'created_at', ` + alias + `.created_at,
		'updated_at', ` + alias + `.updated_at
	)`
}

func workspaceKeyMovementProjection(alias string) string {
	return `jsonb_build_object(
		'id', ` + alias + `.id,
		'organization_id', ` + alias + `.organization_id,
		'property_key_id', ` + alias + `.property_key_id,
		'movement_type', ` + alias + `.movement_type,
		'holder_user_id', ` + alias + `.holder_user_id,
		'holder_name', ` + alias + `.holder_name,
		'from_location', ` + alias + `.from_location,
		'to_location', ` + alias + `.to_location,
		'occurred_at', ` + alias + `.occurred_at,
		'expected_return_at', ` + alias + `.expected_return_at,
		'idempotency_key', null,
		'notes', ` + alias + `.notes,
		'metadata', ` + alias + `.metadata,
		'created_at', ` + alias + `.created_at
	)`
}

var workspacePropertyBaseFields = []string{
	"id", "organization_id", "code", "title", "status",
	"tipo", "tipo_de_imovel", "tipo_de_negocio", "finalidade",
	"descricao", "descricao_site",
	"endereco", "numero", "complemento", "bairro", "cidade", "uf", "cep",
	"preco", "valor_locacao", "condominio", "iptu", "seguro_incendio", "taxa_de_servico",
	"quartos", "suites", "banheiros", "vagas", "area_util", "area_total", "andar",
	"ano_construcao", "ano_reforma", "mobilia", "mobiliado", "regra_pet",
	"detalhes_extras", "latitude", "longitude", "marcadores", "padrao", "pais",
	"posicao_localizacao", "proximidades", "usou_fgts", "valor_itr",
	"valor_seguro_fianca", "zoneamento",
	"imagem_principal", "fotos", "image_urls", "video_imovel", "tour_virtual",
	"owner_id", "owner_name", "responsible_user_id", "cadastrado_por", "corretor_id",
	"property_type_id", "condominium_id", "city_id", "neighborhood_id",
	"published_on_site", "anunciar", "public_address_visibility", "address_visibility",
	"destaque", "is_featured", "super_destaque", "placa_no_local",
	"aceita_permuta", "aceita_financiamento", "exclusividade",
	"created_at", "updated_at",
}

var workspacePropertyInternalFields = []string{
	"commission_percentage", "comissao_venda", "comissao_locacao", "tipo_comissao",
	"data_inicio_comissao", "condicao_comercial", "condicao_pagamento",
	"comentarios_internos", "local_chaves", "numero_matricula", "codigo_iptu",
	"codigo_eletricidade", "codigo_agua", "observacoes_documentacao",
	"documents", "arquivos", "metadata", "valor_venda_avaliado",
	"valor_locacao_avaliado", "ocupacao", "situacao_imovel",
	"autorizado_comercializacao", "referencia_alternativa", "external_id",
	"external_provider", "imoview_codigo", "vista_codigo", "created_by",
	"aprovacao_ambiental", "projeto_aprovado", "status_descritivo",
}

func projectWorkspaceProperty(source Property, canManage bool, canViewContacts bool) Property {
	projected := Property{}
	copyWorkspacePropertyFields(projected, source, workspacePropertyBaseFields)
	if canViewContacts {
		copyWorkspacePropertyFields(projected, source, propertyOwnerContactFields)
	}
	if canManage {
		copyWorkspacePropertyFields(projected, source, workspacePropertyInternalFields)
	}
	return projected
}

func copyWorkspacePropertyFields(destination Property, source Property, fields []string) {
	for _, field := range fields {
		if value, exists := source[field]; exists {
			destination[field] = value
		}
	}
}
