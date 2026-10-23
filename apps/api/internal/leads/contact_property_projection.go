package leads

// Contacts use the same property visibility as lead details and the board.
// Project the known metadata reference list too: expanded/raw JSON must not
// restore references hidden by the regular property columns.
func contactPropertyMetadataSQL(propertyVisibility string) string {
	return `case
		when jsonb_typeof(l.metadata->'interestPropertyIds') = 'array' then
			jsonb_set(coalesce(l.metadata, '{}'::jsonb), '{interestPropertyIds}', (
				select coalesce(jsonb_agg(to_jsonb(visible_property.id::text) order by contact_reference.ordinality), '[]'::jsonb)
				from jsonb_array_elements_text(l.metadata->'interestPropertyIds') with ordinality contact_reference(value, ordinality)
				join public.properties visible_property
				  on visible_property.organization_id = l.organization_id
				 and visible_property.id::text = lower(contact_reference.value)
				where ` + propertyVisibility + `
			), false)
		when jsonb_typeof(l.metadata) = 'object' and l.metadata ? 'interestPropertyIds' then
			l.metadata - 'interestPropertyIds'
		else coalesce(l.metadata, '{}'::jsonb)
	end`
}
