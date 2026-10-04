package whatsapp

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

var errAIFollowUpClaimStale = errors.New("AI follow-up claim already completed or cancelled")
var errAIFollowUpLegacyReview = errors.New("legacy AI follow-up enqueue retained for review")

type aiFollowUpAttempt struct {
	ID string
}

// Reserve only a stable identity. Neither a database transaction nor a pool
// connection remains held while the model runs or the outbox is enqueued.
func (repo Repository) reserveAIFollowUpAttempt(ctx context.Context, candidate aiFollowUpCandidate) (aiFollowUpAttempt, error) {
	var attempt aiFollowUpAttempt
	var status string
	err := repo.db.Pool().QueryRow(ctx, `
		with legacy as (
			select wm.id as message_id, wm.client_message_id,
			       wo.id as outbox_id, wo.status as outbox_status
			from public.whatsapp_messages wm
			left join public.whatsapp_outbox wo
			  on wo.organization_id = wm.organization_id
			 and wo.session_id = wm.session_id
			 and wo.conversation_id = wm.conversation_id
			 and wo.message_id = wm.id
			 and wo.client_message_id = wm.client_message_id
			where wm.organization_id = $1::uuid
			  and wm.lead_id = $2::uuid
			  and wm.conversation_id = $3::uuid
			  and wm.session_id = $4::uuid
			  and wm.from_me = true
			  and wm.client_message_id ~ ('^ai-followup-' || ($2::uuid)::text || '-[0-9]+$')
			  -- Old claims moved next_follow_up_at by 15 minutes before the AI
			  -- call. The 20-minute lookback allows five minutes before that
			  -- lease; the five-minute lookahead allows a slower AI call. Older
			  -- legitimate cycles are never held merely for lacking an event.
			  and wm.created_at >= $5::timestamptz - interval '20 minutes'
			  and wm.created_at <= $5::timestamptz + interval '5 minutes'
			order by wm.created_at desc, wm.id desc
			limit 1
		)
		insert into private.whatsapp_ai_followup_attempts as current_attempt (
			organization_id, lead_id, conversation_id, session_id, due_at,
			status, legacy_message_id, legacy_client_message_id,
			legacy_outbox_id, legacy_outbox_status
		)
		select $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::timestamptz,
		       case when legacy.message_id is null then 'active' else 'legacy_review' end,
		       legacy.message_id, legacy.client_message_id,
		       legacy.outbox_id, legacy.outbox_status
		from (select true) seed left join legacy on true
		on conflict (organization_id, lead_id) do update
		set attempt_id = case when current_attempt.status = 'active'
		                      then current_attempt.attempt_id
		                      else pg_catalog.gen_random_uuid() end,
		    conversation_id = excluded.conversation_id,
		    session_id = excluded.session_id,
		    due_at = case when current_attempt.status = 'active'
		                  then current_attempt.due_at else excluded.due_at end,
		    status = case when current_attempt.status = 'active'
		                  then 'active' else excluded.status end,
		    next_due_at = null,
		    legacy_message_id = case when current_attempt.status = 'active'
		                             then current_attempt.legacy_message_id else excluded.legacy_message_id end,
		    legacy_client_message_id = case when current_attempt.status = 'active'
		                                    then current_attempt.legacy_client_message_id else excluded.legacy_client_message_id end,
		    legacy_outbox_id = case when current_attempt.status = 'active'
		                           then current_attempt.legacy_outbox_id else excluded.legacy_outbox_id end,
		    legacy_outbox_status = case when current_attempt.status = 'active'
		                               then current_attempt.legacy_outbox_status else excluded.legacy_outbox_status end,
		    updated_at = clock_timestamp()
		where (current_attempt.status = 'active'
		       and current_attempt.conversation_id = excluded.conversation_id
		       and current_attempt.session_id = excluded.session_id)
		   or (current_attempt.status = 'completed'
		       and excluded.due_at >= current_attempt.next_due_at)
		   or (current_attempt.status = 'cancelled'
		       and excluded.due_at > current_attempt.updated_at)
		returning attempt_id::text, status
	`, candidate.OrganizationID, candidate.LeadID, candidate.ConversationID,
		candidate.SessionID, candidate.DueAt).Scan(&attempt.ID, &status)
	if errors.Is(err, pgx.ErrNoRows) {
		if lookupErr := repo.db.Pool().QueryRow(ctx, `
			select status from private.whatsapp_ai_followup_attempts
			where organization_id = $1::uuid and lead_id = $2::uuid
		`, candidate.OrganizationID, candidate.LeadID).Scan(&status); lookupErr != nil {
			return aiFollowUpAttempt{}, lookupErr
		}
		if status == "completed" || status == "cancelled" {
			return aiFollowUpAttempt{}, errAIFollowUpClaimStale
		}
		if status == "legacy_review" {
			return aiFollowUpAttempt{}, errAIFollowUpLegacyReview
		}
		return aiFollowUpAttempt{}, fmt.Errorf("%w: AI follow-up route changed during an active attempt", ErrInvalidReference)
	}
	if err == nil && status == "legacy_review" {
		return aiFollowUpAttempt{}, errAIFollowUpLegacyReview
	}
	return attempt, err
}

// A matching canonical message and its canonical outbox row prove that the
// enqueue committed. Anything else, including a partial/mismatched row, fails
// closed instead of generating a second message with a new id.
func (repo Repository) hasAIFollowUpEnqueueProof(ctx context.Context, candidate aiFollowUpCandidate, clientMessageID string) (bool, error) {
	var messageID, conversationID, sessionID, leadID, origin, messageType, outboxID string
	var fromMe bool
	err := repo.db.Pool().QueryRow(ctx, `
		select wm.id::text, wm.conversation_id::text, wm.session_id::text,
		       coalesce(wm.lead_id::text, ''), coalesce(wm.metadata->>'origin', ''),
		       wm.from_me, wm.message_type, coalesce(wo.id::text, '')
		from public.whatsapp_messages wm
		left join public.whatsapp_outbox wo
		  on wo.organization_id = wm.organization_id
		 and wo.session_id = wm.session_id
		 and wo.conversation_id = wm.conversation_id
		 and wo.message_id = wm.id
		 and wo.client_message_id = wm.client_message_id
		where wm.organization_id = $1::uuid
		  and wm.session_id = $2::uuid
		  and wm.client_message_id = $3
		limit 1
	`, candidate.OrganizationID, candidate.SessionID, clientMessageID).Scan(
		&messageID, &conversationID, &sessionID, &leadID, &origin,
		&fromMe, &messageType, &outboxID,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if messageID == "" || outboxID == "" || conversationID != candidate.ConversationID ||
		sessionID != candidate.SessionID || leadID != candidate.LeadID ||
		origin != "automation" || !fromMe || messageType != "text" {
		return false, fmt.Errorf("%w: AI follow-up enqueue proof is incomplete or mismatched", ErrInvalidReference)
	}
	return true, nil
}

// Move the business schedule and the occurrence state in one short database
// transaction. A retry cannot open a new occurrence until both commit.
func (repo Repository) completeAIFollowUpAttempt(ctx context.Context, candidate aiFollowUpCandidate, attemptID string, requireEnqueueProof bool) error {
	intervalDays := candidate.IntervalDays
	if intervalDays <= 0 {
		intervalDays = 3
	}
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var currentID, status, conversationID, sessionID string
	err = tx.QueryRow(ctx, `
		select attempt_id::text, status, conversation_id::text, session_id::text
		from private.whatsapp_ai_followup_attempts
		where organization_id = $1::uuid and lead_id = $2::uuid
		for update
	`, candidate.OrganizationID, candidate.LeadID).Scan(
		&currentID, &status, &conversationID, &sessionID,
	)
	if err != nil {
		return err
	}
	if currentID != attemptID || conversationID != candidate.ConversationID || sessionID != candidate.SessionID {
		return fmt.Errorf("%w: AI follow-up attempt changed", ErrInvalidReference)
	}
	if status == "completed" {
		return tx.Commit(ctx)
	}
	if status != "active" {
		return errAIFollowUpClaimStale
	}
	if requireEnqueueProof {
		var proved bool
		err = tx.QueryRow(ctx, `
			select exists (
				select 1 from public.whatsapp_messages wm
				join public.whatsapp_outbox wo
				  on wo.organization_id = wm.organization_id
				 and wo.session_id = wm.session_id
				 and wo.conversation_id = wm.conversation_id
				 and wo.message_id = wm.id
				 and wo.client_message_id = wm.client_message_id
				where wm.organization_id = $1::uuid
				  and wm.lead_id = $2::uuid
				  and wm.conversation_id = $3::uuid
				  and wm.session_id = $4::uuid
				  and wm.client_message_id = $5
				  and wm.from_me = true
				  and wm.message_type = 'text'
				  and wm.metadata->>'origin' = 'automation'
			)
		`, candidate.OrganizationID, candidate.LeadID, candidate.ConversationID,
			candidate.SessionID, autoFollowUpMessagePrefix+attemptID).Scan(&proved)
		if err != nil {
			return err
		}
		if !proved {
			return fmt.Errorf("%w: AI follow-up outbox enqueue is unproven", ErrInvalidReference)
		}
	}
	var nextDue time.Time
	err = tx.QueryRow(ctx, `
		update public.leads
		set next_follow_up_at = now() + ($3::integer * interval '1 day'),
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
		  and next_follow_up_at is not null
		returning next_follow_up_at
	`, candidate.OrganizationID, candidate.LeadID, intervalDays).Scan(&nextDue)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `
		update private.whatsapp_ai_followup_attempts
		set status = 'completed', next_due_at = $4::timestamptz,
		    updated_at = clock_timestamp()
		where organization_id = $1::uuid and lead_id = $2::uuid
		  and attempt_id = $3::uuid and status = 'active'
	`, candidate.OrganizationID, candidate.LeadID, attemptID, nextDue)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (repo Repository) clearAIFollowUp(ctx context.Context, organizationID string, leadID string) error {
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `
		update private.whatsapp_ai_followup_attempts
		set status = 'cancelled', next_due_at = null, updated_at = clock_timestamp()
		where organization_id = $1::uuid and lead_id = $2::uuid and status = 'active'
	`, organizationID, leadID); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `
		update public.leads set next_follow_up_at = null, updated_at = now()
		where organization_id = $1::uuid and id = $2::uuid
	`, organizationID, leadID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
