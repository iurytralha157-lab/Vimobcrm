package whatsappbinding

import (
	"context"

	"github.com/jackc/pgx/v5"
)

type queryRower interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

// CanLinkLegacyForFuture checks whether a legacy conversation can accept a
// future binding without claiming earlier history. Callers authorize the
// session and lead, and repeat this check under the conversation lock when
// committing the binding.
func CanLinkLegacyForFuture(ctx context.Context, q queryRower, organizationID, conversationID string) (bool, error) {
	var eligible bool
	err := q.QueryRow(ctx, `
		select exists (
		  select 1
		  from public.whatsapp_conversations wc
		  where wc.organization_id = $1::uuid
		    and wc.id = $2::uuid
		    and wc.lead_id is null
		    and wc.deleted_at is null
		    and wc.retired_at is null
		    and wc.is_group is not true
		    and lower(wc.remote_jid) !~ '@(g[.]us|broadcast|newsletter|status)'
		    and not wc.unlinked_retention_v1
		    and wc.unlinked_retention_scrubbed_at is null
		    and nullif(btrim(wc.last_message), '') is null
		    and nullif(btrim(wc.last_message_preview), '') is null
		    and not exists (
		      select 1
		      from public.whatsapp_conversation_lead_bindings b
		      where b.organization_id = wc.organization_id
		        and b.conversation_id = wc.id
		    )
		    and not exists (
		      select 1
		      from public.whatsapp_inbound_logs log
		      where log.organization_id = wc.organization_id
		        and log.conversation_id = wc.id
		        and log.lead_id is not null
		    )
		    and not exists (
		      select 1
		      from public.whatsapp_messages wm
		      where wm.organization_id = wc.organization_id
		        and wm.conversation_id = wc.id
		        and (
		          wm.session_id is distinct from wc.session_id
		          or wm.lead_id is not null
		          or wm.capture_state is distinct from 'suppressed'
		          or nullif(btrim(wm.content), '') is not null
		          or nullif(btrim(wm.media_url), '') is not null
		          or nullif(btrim(wm.media_storage_path), '') is not null
		        )
		    )
		)
	`, organizationID, conversationID).Scan(&eligible)
	return eligible, err
}
