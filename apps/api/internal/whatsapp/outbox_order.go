package whatsapp

// Serialize durable starts within a physical conversation across both lanes.
// A deferred retry remains the head; terminal outcomes release it. Other
// conversations retain their independent capacity and fair cursor.
const whatsappOutboxOrderPredicate = `
			  and not exists (
			    select 1 from public.whatsapp_outbox active
			    where active.conversation_id=queued.conversation_id
			      and active.organization_id=queued.organization_id
			      and active.session_id=queued.session_id
			      and active.status='processing'
			  )
			  and not exists (
			    select 1 from public.whatsapp_outbox older
			    where older.conversation_id=queued.conversation_id
			      and older.organization_id=queued.organization_id
			      and older.session_id=queued.session_id
			      and older.status in ('pending','retry')
			      and (older.attempts < older.max_attempts
			           or older.last_error='provider_accepted_finalization_pending')
			      and (older.created_at,older.id)<(queued.created_at,queued.id)
			  )`
