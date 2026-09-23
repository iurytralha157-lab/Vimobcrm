package whatsapp

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// maybeAutoEnterCTWAAttendance is only for the provider event that created a
// new CTWA card. The database RPC rechecks immutable origin, ingress, binding,
// connected session and active owner evidence before recording the entry and
// its timeline event. A different session or a reused card must still join
// explicitly through the authenticated API.
func maybeAutoEnterCTWAAttendance(
	ctx context.Context,
	tx pgx.Tx,
	session nativeEvolutionSession,
	conversation nativeEvolutionConversation,
	message nativeEvolutionMessage,
	storedIdentity nativeEvolutionStoredMessageIdentity,
	bindingID string,
	inboxAcceptedAt time.Time,
	ingressSequence int64,
) error {
	if !nativeCTWAAutoAttendanceEligible(
		conversation, message, storedIdentity, bindingID,
		inboxAcceptedAt, ingressSequence,
	) {
		return nil
	}

	// A nullable result means the trusted database proof rejected this event;
	// the ordinary capture gate will then suppress the message. Never construct
	// an attendance row from the webhook's mutable body alone.
	var entryID *string
	return tx.QueryRow(ctx, `
		select public.auto_enter_whatsapp_ctwa_attendance(
			$1::uuid, $2::uuid, $3::uuid, $4::uuid,
			$5::uuid, $6::text, $7::bigint, $8::timestamptz
		)
	`, session.OrganizationID, conversation.ID, session.ID,
		conversation.LeadID, bindingID, message.ProviderMessageID,
		ingressSequence, message.SentAt).Scan(&entryID)
}

func nativeCTWAAutoAttendanceEligible(
	conversation nativeEvolutionConversation,
	message nativeEvolutionMessage,
	storedIdentity nativeEvolutionStoredMessageIdentity,
	bindingID string,
	inboxAcceptedAt time.Time,
	ingressSequence int64,
) bool {
	return storedIdentity.ID == "" &&
		conversation.LeadIsNew &&
		!conversation.HistoricalBindingReplay &&
		!conversation.LeadScopeCompatibilityFallback &&
		conversation.LeadResolutionQuarantineReason == "" &&
		conversation.ID != "" &&
		conversation.LeadID != "" &&
		conversation.MessageLeadID == conversation.LeadID &&
		bindingID != "" &&
		message.IsCTWAAd &&
		!message.FromMe &&
		!message.IsGroup &&
		!message.ProviderMessageIDSynthetic &&
		strings.TrimSpace(message.ProviderMessageID) != "" &&
		nativeCTWAAdConfirmationMethod(message) != "" &&
		!message.ProviderTimestampMissing &&
		attendanceEventTimesValid(message.SentAt, inboxAcceptedAt) &&
		ingressSequence > 0
}

// attendanceBindingID resolves the immutable card binding under the physical
// conversation lock already held by send and native ingress. A phone number is
// deliberately never used as an attendance identity.
func attendanceBindingID(ctx context.Context, tx pgx.Tx, organizationID, conversationID, sessionID, leadID string) (string, error) {
	if leadID == "" {
		return "", nil
	}
	var bindingID string
	err := tx.QueryRow(ctx, `
		select binding.id::text
		from public.whatsapp_conversation_lead_bindings binding
		where binding.organization_id = $1::uuid
		  and binding.conversation_id = $2::uuid
		  and binding.session_id = $3::uuid
		  and binding.lead_id = $4::uuid
		  and binding.active_to is null
		  and binding.stale = false
		limit 1
	`, organizationID, conversationID, sessionID, leadID).Scan(&bindingID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrConversationBindingChanged
	}
	return bindingID, err
}

// currentAttendanceEntry is used for an authenticated CRM send. The caller
// holds session -> conversation -> lead locks, so a concurrent card rebind
// cannot authorize an outbound message for the previous card.
func currentAttendanceEntry(ctx context.Context, tx pgx.Tx, organizationID, conversationID, sessionID, leadID, bindingID, userID string) (string, error) {
	var entryID string
	err := tx.QueryRow(ctx, `
		select entry.id::text
		from public.whatsapp_attendance_entries entry
		join public.whatsapp_sessions session
		  on session.organization_id = entry.organization_id
		 and session.id = entry.session_id
		 and session.owner_user_id = entry.user_id
		 and coalesce(session.is_active, true) = true
		 and session.status not in ('disabled', 'deleted')
		join public.users actor
		  on actor.id = entry.user_id
		 and actor.organization_id = entry.organization_id
		 and coalesce(actor.is_active, false) = true
		join public.organization_members member
		  on member.organization_id = entry.organization_id
		 and member.user_id = entry.user_id
		 and coalesce(member.is_active, true) = true
		where entry.organization_id = $1::uuid
		  and entry.conversation_id = $2::uuid
		  and entry.session_id = $3::uuid
		  and entry.lead_id = $4::uuid
		  and entry.binding_id = $5::uuid
		  and entry.user_id = $6::uuid
		limit 1
	`, organizationID, conversationID, sessionID, leadID, bindingID, userID).Scan(&entryID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrAttendanceRequired
	}
	return entryID, err
}

// eventAttendanceEntry checks the frozen card and ingress fence. Both the
// provider occurrence and the durable inbox acceptance must follow the
// confirmation. A delayed webhook cannot retroactively reveal old messages.
func eventAttendanceEntry(
	ctx context.Context,
	tx pgx.Tx,
	organizationID, conversationID, sessionID, leadID, bindingID string,
	providerMessageID string,
	providerOccurredAt, inboxAcceptedAt time.Time,
	ingressSequence int64,
) (string, error) {
	if leadID == "" || bindingID == "" || !attendanceEventTimesValid(providerOccurredAt, inboxAcceptedAt) {
		return "", nil
	}
	var entryID string
	err := tx.QueryRow(ctx, `
		select entry.id::text
		from public.whatsapp_attendance_entries entry
		join public.whatsapp_sessions session
		  on session.organization_id = entry.organization_id
		 and session.id = entry.session_id
		 and session.owner_user_id = entry.user_id
		 and coalesce(session.is_active, true) = true
		 and session.status not in ('disabled', 'deleted')
		join public.users actor
		  on actor.id = entry.user_id
		 and actor.organization_id = entry.organization_id
		 and coalesce(actor.is_active, false) = true
		join public.organization_members member
		  on member.organization_id = entry.organization_id
		 and member.user_id = entry.user_id
		 and coalesce(member.is_active, true) = true
		where entry.organization_id = $1::uuid
		  and entry.conversation_id = $2::uuid
		  and entry.session_id = $3::uuid
		  and entry.lead_id = $4::uuid
		  and entry.binding_id = $5::uuid
		  and (
		    (
		      entry.entry_source = 'manual'
		      and entry.joined_at <= $6::timestamptz
		      and entry.joined_at <= $7::timestamptz
		      and ($8::bigint = 0 or entry.ingress_sequence_cutoff < $8::bigint)
		    )
		    or (
		      entry.entry_source = 'ctwa_auto'
		      and $8::bigint > 0
		      and (
		        (
		          entry.bootstrap_provider_message_id = $9
		          and entry.bootstrap_ingress_sequence = $8::bigint
		        )
		        or (
		          entry.bootstrap_ingress_sequence < $8::bigint
		          and entry.bootstrap_provider_occurred_at <= $6::timestamptz
		          and entry.bootstrap_inbox_created_at <= $7::timestamptz
		        )
		      )
		    )
		  )
		order by entry.joined_at, entry.id
		limit 1
	`, organizationID, conversationID, sessionID, leadID, bindingID,
		providerOccurredAt, inboxAcceptedAt, ingressSequence, providerMessageID).Scan(&entryID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return entryID, err
}

func attendanceEventTimesValid(providerOccurredAt, inboxAcceptedAt time.Time) bool {
	// A provider clock later than durable inbox acceptance cannot establish
	// that the message actually occurred after a user joined. Fail closed,
	// including implausibly future timestamps from malformed callbacks.
	return !providerOccurredAt.IsZero() &&
		!inboxAcceptedAt.IsZero() &&
		!providerOccurredAt.After(inboxAcceptedAt)
}

// Any joined participant makes this session/card eligible for provider-origin
// or system-origin messages. An API user's own send has a stronger check.
func anyCurrentAttendanceEntry(ctx context.Context, tx pgx.Tx, organizationID, conversationID, sessionID, leadID, bindingID string) (string, error) {
	var entryID string
	err := tx.QueryRow(ctx, `
		select entry.id::text
		from public.whatsapp_attendance_entries entry
		join public.whatsapp_sessions session
		  on session.organization_id = entry.organization_id
		 and session.id = entry.session_id
		 and session.owner_user_id = entry.user_id
		 and coalesce(session.is_active, true) = true
		 and session.status not in ('disabled', 'deleted')
		join public.users actor
		  on actor.id = entry.user_id
		 and actor.organization_id = entry.organization_id
		 and coalesce(actor.is_active, false) = true
		join public.organization_members member
		  on member.organization_id = entry.organization_id
		 and member.user_id = entry.user_id
		 and coalesce(member.is_active, true) = true
		where entry.organization_id = $1::uuid
		  and entry.conversation_id = $2::uuid
		  and entry.session_id = $3::uuid
		  and entry.lead_id = $4::uuid
		  and entry.binding_id = $5::uuid
		order by entry.joined_at, entry.id
		limit 1
	`, organizationID, conversationID, sessionID, leadID, bindingID).Scan(&entryID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	return entryID, err
}
