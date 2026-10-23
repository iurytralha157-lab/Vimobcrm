package whatsapp

// Queuing or failing an outbound message does not answer the lead. Use the
// current immutable card context and the same canonical tuple as the v2 reader.
func conversationPendingReplySQL() string {
	return `coalesce((
		select not wm.from_me
		from public.whatsapp_messages wm
		where wm.organization_id=wc.organization_id
		  and wm.conversation_id=wc.id
		  and wm.lead_id is not distinct from wc.lead_id
		  and wm.capture_state is distinct from 'suppressed'
		  and wm.reaction_to_message_id is null
		  and wm.message_type<>'reaction'
		  and (not wm.from_me or lower(wm.status) in ('sent','delivered','read','played'))
		order by ` + messageOrderSQL(MessageFilter{OrderingVersion: 2}) + `
		limit 1
	),false)`
}
