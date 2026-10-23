package properties

// A canonical Site publication takes precedence over the legacy property flag.
// A first canonical request keeps an already-public legacy announcement live
// until delivery. Explicit withdrawal/pausing still overrides that legacy flag.
// The status guard matches the public-site listing eligibility.
func propertyPublishedOnSiteSQL(propertyAlias string, publicationAlias string) string {
	return `(lower(trim(coalesce(` + propertyAlias + `.status, ''))) in ('active', 'ativo', 'available', 'disponivel', 'disponível')
		and ` + PropertyInventoryOpenSQL(propertyAlias) + `
		and ` + propertyAlias + `.autorizado_comercializacao is distinct from false
		and case
			when ` + publicationAlias + `.id is not null then
				` + publicationAlias + `.desired_state = 'published' and (
					` + publicationAlias + `.published_version is not null
					or coalesce(` + propertyAlias + `.published_on_site, false)
				)
			else coalesce(` + propertyAlias + `.published_on_site, false)
		end)`
}

// Keep operational publication state alongside the public-visibility boolean.
// The metadata contains no source payload, provider credentials or actor data.
func propertySitePublicationMetadataSQL(publicationAlias string, propertyAliases ...string) string {
	propertyAlias := "p"
	if len(propertyAliases) > 0 {
		propertyAlias = propertyAliases[0]
	}
	return `case when ` + publicationAlias + `.id is null then null::jsonb else jsonb_build_object(
		'id', ` + publicationAlias + `.id,
		'desired_state', ` + publicationAlias + `.desired_state,
		'observed_state', ` + publicationAlias + `.observed_state,
		'published_version', ` + publicationAlias + `.published_version,
		'public_visible', ` + propertyPublishedOnSiteSQL(propertyAlias, publicationAlias) + `,
		'last_error_code', ` + publicationAlias + `.last_error_code,
		'last_error_message', ` + publicationAlias + `.last_error_message
	) end`
}

func propertySitePublicationJoinSQL(propertyAlias string, publicationAlias string) string {
	return `left join public.property_channel_publications ` + publicationAlias + `
		on ` + publicationAlias + `.organization_id = ` + propertyAlias + `.organization_id
		and ` + publicationAlias + `.property_id = ` + propertyAlias + `.id
		and ` + publicationAlias + `.channel = 'site'
		and ` + publicationAlias + `.channel_account_key = 'default'`
}
