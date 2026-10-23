package whatsapp

// Project a narrow DTO, never the provider's raw metadata. A quote's inline
// provider body is never read. Resolve only a captured target on the same
// immutable card, organization, session and conversation as the visible row.
func messagePresentationSQL() string {
	return `jsonb_strip_nulls(jsonb_build_object(
		'media_filename',wm.metadata->>'media_filename',
		'location',wm.metadata->'message_location',
		'contacts',wm.metadata->'message_contacts',
		'quoted_message',case when length(coalesce(wm.metadata->>'quoted_message_id','')) between 1 and 200 then coalesce((
		  select jsonb_strip_nulls(jsonb_build_object(
		    'message_id',wm.metadata->>'quoted_message_id','available',true,
		    'id',target.id,'from_me',target.from_me,'content',target.content,
		    'message_type',target.message_type,'sender_name',target.sender_name,
		    'media_filename',target.metadata->>'media_filename'
		  ))
		  from public.whatsapp_messages target
		  where target.organization_id=wm.organization_id
		    and target.session_id=wm.session_id and target.conversation_id=wm.conversation_id
		    and wm.lead_id is not null and target.lead_id=wm.lead_id
		    and target.capture_state='captured' and target.unlinked_retention_scrubbed_at is null
		    and target.message_type not in ('deleted','deleted_event','reaction')
		    and (not target.from_me or lower(target.status) in ('sent','delivered','read','played'))
		    and coalesce(nullif(target.provider_message_id,''),target.message_id)=wm.metadata->>'quoted_message_id'
		  limit 1
		),jsonb_build_object('message_id',wm.metadata->>'quoted_message_id','available',false)) else null end
	))`
}
