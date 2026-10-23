package whatsapp

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
)

type outboundQuote struct{ providerID, participant string }
type quoteQueryer interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

// The upstream Evolution Go contract uses messageId and participant, not a
// client-supplied quoted key/body. Its service constructs an empty quoted body.
// https://github.com/evolution-foundation/evolution-go/blob/main/docs/wiki/guias-api/api-messages.md
func resolveOutboundQuote(ctx context.Context, queryer quoteQueryer, organizationID, sessionID, conversationID, leadID, targetID string) (outboundQuote, error) {
	if targetID == "" {
		return outboundQuote{}, nil
	}
	var quote outboundQuote
	var fromMe bool
	var senderJID, remoteJID, sessionPhone string
	err := queryer.QueryRow(ctx, `
	  select coalesce(nullif(target.provider_message_id,''),target.message_id),target.from_me,
	         coalesce(target.sender_jid,''),coalesce(target.remote_jid,''),coalesce(session.phone_number,'')
	  from public.whatsapp_messages target
	  join public.whatsapp_sessions session on session.id=target.session_id and session.organization_id=target.organization_id
	  where target.organization_id=$1::uuid and target.session_id=$2::uuid
	    and target.conversation_id=$3::uuid and target.lead_id=$4::uuid and target.id=$5::uuid
	    and `+messageTargetEligibleSQL("target")+`
	  for share of target
	`, organizationID, sessionID, conversationID, leadID, targetID).Scan(&quote.providerID, &fromMe, &senderJID, &remoteJID, &sessionPhone)
	if errors.Is(err, pgx.ErrNoRows) {
		return outboundQuote{}, ErrQuoteTargetUnavailable
	}
	if err != nil {
		return outboundQuote{}, err
	}
	quote.providerID = safeQuotedMessageReference(quote.providerID)
	if senderJID != "" {
		quote.participant = normalizeRemoteAlias(senderJID)
	} else if fromMe {
		if phone := formatPhoneForWhatsApp(sessionPhone); phone != "" {
			quote.participant = phone + "@s.whatsapp.net"
		}
	} else {
		quote.participant = normalizeRemoteAlias(remoteJID)
	}
	if quote.providerID == "" || strings.TrimSpace(quote.participant) == "" {
		return outboundQuote{}, ErrQuoteTargetUnavailable
	}
	return quote, nil
}

func (quote outboundQuote) payload() map[string]any {
	if quote.providerID == "" {
		return nil
	}
	return map[string]any{"messageId": quote.providerID, "participant": quote.participant}
}
