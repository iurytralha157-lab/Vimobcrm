package whatsapp

import (
	"context"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

const sessionHealthRecheckDelay = 3 * time.Second

// SessionHealthNotificationWriter enqueues an internal notice in the caller's transaction.
type SessionHealthNotificationWriter func(ctx context.Context, tx pgx.Tx, organizationID, userID, eventKey, dedupeKey string, variables map[string]any) error

func (repo Repository) WithSessionHealthNotifications(writer SessionHealthNotificationWriter) Repository {
	repo.sessionHealthNotificationWriter = writer
	return repo
}

type sessionStatusObservation struct {
	result        map[string]any
	status        string
	authoritative bool
	missing       bool
	confirmedLoss bool
}

func sessionHealthConfirmationEligible(session Session) bool {
	return session.IsActive && session.Provider == "evolution_go" &&
		(session.Status == "connected" || session.Status == "connecting") &&
		sessionAutoReconnectEnabled(session.AdvancedSettings) &&
		!strings.EqualFold(strings.TrimSpace(stringFromMap(session.AdvancedSettings, "auto_reconnect_blocked_reason")), "user_logged_out")
}

func observeSessionStatus(
	ctx context.Context,
	confirmLoss bool,
	probe func(context.Context) (map[string]any, error),
	wait func(context.Context) error,
) (sessionStatusObservation, error) {
	result, err := probe(ctx)
	if err != nil {
		return sessionStatusObservation{}, err
	}
	status, authoritative, missing := evolutionConnectionObservation(result)
	observation := sessionStatusObservation{result: result, status: status, authoritative: authoritative, missing: missing}
	if !confirmLoss || !authoritative || missing || status != "disconnected" {
		return observation, nil
	}
	if err := wait(ctx); err != nil {
		return sessionStatusObservation{}, err
	}
	if err := ctx.Err(); err != nil {
		return sessionStatusObservation{}, err
	}

	result, err = probe(ctx)
	if err != nil {
		return sessionStatusObservation{}, err
	}
	status, authoritative, missing = evolutionConnectionObservation(result)
	return sessionStatusObservation{
		result:        result,
		status:        status,
		authoritative: authoritative,
		missing:       missing,
		confirmedLoss: authoritative && !missing && status == "disconnected",
	}, nil
}

func waitForSessionHealthRecheck(ctx context.Context) error {
	timer := time.NewTimer(sessionHealthRecheckDelay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func (repo Repository) recordConfirmedSessionDisconnect(ctx context.Context, tx pgx.Tx, session Session) error {
	rows, err := tx.Query(ctx, `
		select account.id::text
		from public.users account
		join public.organization_members membership
		  on membership.user_id = account.id
		 and membership.organization_id = account.organization_id
		where account.organization_id = $1::uuid
		  and account.is_active is true
		  and membership.is_active is true
		  and membership.deleted_at is null
		  and (account.id = $2::uuid or account.role = 'admin')
		order by account.id
		for share of account, membership
	`, session.OrganizationID, session.OwnerUserID)
	if err != nil {
		return err
	}
	recipients, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return err
	}

	episode := sessionHealthEpisode(session)
	displayName := firstNonEmpty(stringPtrValue(session.DisplayName), session.InstanceName)
	for _, userID := range recipients {
		eventKey := "whatsapp_disconnected_admin"
		if userID == session.OwnerUserID {
			eventKey = "whatsapp_disconnected"
		}
		err := repo.sessionHealthNotificationWriter(ctx, tx, session.OrganizationID, userID, eventKey,
			"whatsapp_disconnected:"+session.ID+":"+userID+":"+episode, map[string]any{
				"nome_sessao":        displayName,
				"session_name":       displayName,
				"disconnect_episode": episode,
			})
		if err != nil {
			return err
		}
	}

	_, err = tx.Exec(ctx, `
		insert into public.audit_logs (organization_id, action, entity_type, entity_id, new_data)
		values ($1::uuid, 'whatsapp.session_disconnected', 'whatsapp_session', $2::text, $3::jsonb)
	`, session.OrganizationID, session.ID, jsonb(map[string]any{
		"previous_status": session.Status,
		"new_status":      "disconnected",
		"first_check":     map[string]any{"connected": false},
		"second_check":    map[string]any{"connected": false},
	}))
	return err
}

func sessionHealthEpisode(session Session) string {
	episode := session.UpdatedAt
	if episode.IsZero() && session.LastConnectedAt != nil {
		episode = *session.LastConnectedAt
	}
	if episode.IsZero() {
		episode = session.CreatedAt
	}
	// Match the timestamp text in the Edge function's dedupe key.
	return episode.UTC().Format("2006-01-02T15:04:05.999999-07:00")
}
