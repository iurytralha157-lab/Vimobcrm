package whatsapp

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
)

// The caller already holds the lead lock and verified the current assignee.
// Read the latest transition before filtering it so an unassignment or initial
// assignment cannot accidentally reuse an earlier handoff to this same user.
func latestAssignedWhatsAppHandoff(ctx context.Context, tx pgx.Tx, organizationID, leadID, userID string) (string, error) {
	var id string
	err := tx.QueryRow(ctx, `
		select coalesce((
		  select latest.id::text
		  from (
		    select id, previous_user_id, assigned_user_id
		    from private.whatsapp_lead_handoffs
		    where organization_id = $1::uuid and lead_id = $2::uuid
		    order by ordinal desc
		    limit 1
		  ) as latest
		  where latest.previous_user_id is not null and latest.assigned_user_id = $3::uuid
		), '')
	`, organizationID, leadID, userID).Scan(&id)
	return id, err
}

func confirmWhatsAppHandoff(ctx context.Context, tx pgx.Tx, handoffID, organizationID, leadID, userID, entryID, messageID string, acceptedAt time.Time) error {
	handoffID, ok := normalizeUUID(handoffID)
	if !ok {
		return nil
	}
	_, err := tx.Exec(ctx, `
		update private.whatsapp_lead_handoffs as handoff
		set attendance_entry_id = $5::uuid, message_id = $6::uuid, marker_at = $7::timestamptz
		where handoff.id = $1::uuid
		  and handoff.organization_id = $2::uuid
		  and handoff.lead_id = $3::uuid
		  and handoff.previous_user_id is not null
		  and handoff.assigned_user_id = $4::uuid
		  and handoff.marker_at is null
		  and handoff.id = (
		    select latest.id from private.whatsapp_lead_handoffs as latest
		    where latest.organization_id = $2::uuid and latest.lead_id = $3::uuid
		    order by latest.ordinal desc
		    limit 1
		  )
		  and exists (
		    select 1 from public.leads as lead
		    where lead.organization_id = $2::uuid and lead.id = $3::uuid and lead.assigned_user_id = $4::uuid
		  )
	`, handoffID, organizationID, leadID, userID, entryID, messageID, acceptedAt)
	return err
}

func loadWhatsAppHandoffMarkers(ctx context.Context, tx pgx.Tx, organizationID string, scope attendanceScope) ([]AttendanceEntry, error) {
	rows, err := tx.Query(ctx, `
		select handoff.id::text, entry.organization_id::text, entry.conversation_id::text,
		       entry.session_id::text, entry.lead_id::text, entry.binding_id::text,
		       entry.user_id::text, entry.actor_name_snapshot, entry.joined_at,
		       entry.entry_source, entry.ingress_sequence_cutoff, handoff.marker_at, 'joined'::text
		from private.whatsapp_lead_handoffs as handoff
		join public.whatsapp_attendance_entries as entry
		  on entry.id = handoff.attendance_entry_id
		 and entry.organization_id = handoff.organization_id
		 and entry.lead_id = handoff.lead_id
		 and entry.user_id = handoff.assigned_user_id
		where handoff.organization_id = $1::uuid
		  and handoff.lead_id = $2::uuid
		  and entry.conversation_id = $3::uuid
		  and entry.session_id = $4::uuid
		  and handoff.marker_at is not null
		order by handoff.marker_at, handoff.ordinal
	`, organizationID, scope.LeadID, scope.ConversationID, scope.SessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var markers []AttendanceEntry
	for rows.Next() {
		marker, err := scanAttendanceEntryWithMarker(rows)
		if err != nil {
			return nil, err
		}
		markers = append(markers, marker)
	}
	return markers, rows.Err()
}
