package whatsapp

import (
	"context"
	"fmt"
	"strings"
	"time"
)

func connectionStatusResponse(status string, missing bool, wuid string) ConnectionStatusResponse {
	state := "close"
	if status == "connected" {
		state = "open"
	} else if status == "qr_ready" {
		state = "qr"
	}
	return ConnectionStatusResponse{
		Connected: status == "connected", Status: status, State: state,
		InstanceNotFound: missing, Instance: map[string]any{"wuid": wuid},
	}
}

// A rejected CAS means the provider observation lost to a newer event. Return
// only the current, authorized row; never publish the discarded observation to
// the browser's shared status cache or turn an old missing-instance result into
// a request to recreate a client that has already reconnected.
func reconcileSessionConnectionObservation(
	observed ConnectionStatusResponse,
	apply func() (bool, error),
	reload func() (Session, error),
) (ConnectionStatusResponse, error) {
	applied, err := apply()
	if err != nil {
		return ConnectionStatusResponse{}, err
	}
	if applied {
		return observed, nil
	}
	current, err := reload()
	if err != nil {
		return ConnectionStatusResponse{}, err
	}
	status := strings.TrimSpace(current.Status)
	if !stringIn(status, "connected", "disconnected", "qr_ready") {
		return ConnectionStatusResponse{}, fmt.Errorf("%w: current WhatsApp connection state is unavailable", ErrProviderOutcomeUnknown)
	}
	return connectionStatusResponse(status, false, stringPtrValue(current.PhoneNumber)), nil
}

func (repo Repository) applySessionQRCodeObservation(ctx context.Context, session Session, qr string) (bool, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	command, err := repo.db.Pool().Exec(ctx, `
		update public.whatsapp_sessions ws
		set status = 'qr_ready',
		    qr_code = $3,
		    advanced_settings = coalesce(ws.advanced_settings, '{}'::jsonb)
		      || jsonb_build_object('qr_code', $3::text, 'qr_updated_at', now()),
		    updated_at = now()
		where ws.organization_id = $1::uuid and ws.id = $2::uuid
		  and ws.provider = 'evolution_go' and coalesce(ws.is_active, true)
		  and ws.owner_user_id = $4::uuid
		  and coalesce(ws.status, '') = $5::text
		  and coalesce(ws.status, '') not in ('connected', 'deleted', 'disabled')
		  and coalesce(ws.advanced_settings->>'webhook_state_event_at_ms', '') = $6::text
		  and coalesce(ws.advanced_settings->>'webhook_state_event_rank', '') = $7::text
		  and coalesce(ws.advanced_settings->>'webhook_state_event_key', '') = $8::text
		  and not (
		    lower(coalesce(ws.advanced_settings->>'auto_reconnect_enabled', 'true')) = 'false'
		    and lower(coalesce(ws.advanced_settings->>'auto_reconnect_blocked_reason', '')) = 'user_logged_out'
		  )
		  and exists (
		    select 1 from public.users actor
		    join public.organization_members member on member.user_id = actor.id and member.organization_id = actor.organization_id
		    where actor.id = $4::uuid and actor.organization_id = ws.organization_id
		      and coalesce(actor.is_active, false) and coalesce(member.is_active, false) and member.deleted_at is null
		  )
	`, session.OrganizationID, session.ID, qr, session.OwnerUserID, session.Status,
		stringFromAny(session.AdvancedSettings["webhook_state_event_at_ms"]),
		stringFromAny(session.AdvancedSettings["webhook_state_event_rank"]),
		stringFromAny(session.AdvancedSettings["webhook_state_event_key"]))
	if err != nil {
		return false, err
	}
	return command.RowsAffected() == 1, nil
}
