package properties

// A canonical Site publication takes precedence over the legacy property flag.
// A queued first publication has no published version yet; an update may keep
// its previous published version visible while the new version is processing.
// The status guard matches the public-site listing eligibility.
func propertyPublishedOnSiteSQL(propertyAlias string, publicationAlias string) string {
	return `(lower(trim(coalesce(` + propertyAlias + `.status, ''))) in ('active', 'ativo', 'available', 'disponivel')
		and case
			when ` + publicationAlias + `.id is not null then
				` + publicationAlias + `.desired_state = 'published' and ` + publicationAlias + `.published_version is not null
			else coalesce(` + propertyAlias + `.published_on_site, false)
		end)`
}

func propertySitePublicationJoinSQL(propertyAlias string, publicationAlias string) string {
	return `left join public.property_channel_publications ` + publicationAlias + `
		on ` + publicationAlias + `.organization_id = ` + propertyAlias + `.organization_id
		and ` + publicationAlias + `.property_id = ` + propertyAlias + `.id
		and ` + publicationAlias + `.channel = 'site'
		and ` + publicationAlias + `.channel_account_key = 'default'`
}
