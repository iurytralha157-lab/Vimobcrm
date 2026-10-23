package admin

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const notificationResetPreviewValidity = 15 * time.Minute

var ErrNotificationResetPreviewExpired = errors.New("notification reset preview expired")

type WhatsAppNotificationResetPreview struct {
	Scope          string    `json:"scope"`
	OrganizationID string    `json:"organizationId,omitempty"`
	CutoffAt       time.Time `json:"cutoffAt"`
	PendingCount   int       `json:"pendingCount"`
	InFlightCount  int       `json:"inFlightCount"`
}

type ResetWhatsAppNotificationsRequest struct {
	Scope          string `json:"scope"`
	OrganizationID string `json:"organizationId,omitempty"`
	CutoffAt       string `json:"cutoffAt"`
	Reason         string `json:"reason"`
	Confirmation   string `json:"confirmation"`
}

type WhatsAppNotificationResetResult struct {
	CancelledCount int `json:"cancelledCount"`
	InFlightCount  int `json:"inFlightCount"`
}

func normalizeWhatsAppNotificationResetScope(scope, organizationID string) (string, string, error) {
	scope = strings.TrimSpace(scope)
	organizationID = strings.TrimSpace(organizationID)
	switch scope {
	case "organization":
		var ok bool
		if organizationID, ok = normalizeUUID(organizationID); !ok {
			return "", "", ErrInvalidInput
		}
	case "all":
		if organizationID != "" {
			return "", "", ErrInvalidInput
		}
	default:
		return "", "", ErrInvalidInput
	}
	return scope, organizationID, nil
}

func normalizeWhatsAppNotificationReset(request ResetWhatsAppNotificationsRequest) (ResetWhatsAppNotificationsRequest, time.Time, error) {
	var err error
	request.Scope, request.OrganizationID, err = normalizeWhatsAppNotificationResetScope(request.Scope, request.OrganizationID)
	if err != nil || request.Confirmation != "RESETAR" {
		return request, time.Time{}, ErrInvalidInput
	}
	var ok bool
	request.Reason, ok = normalizeNotificationReplayReason(request.Reason)
	if !ok {
		return request, time.Time{}, ErrInvalidInput
	}
	cutoff, err := time.Parse(time.RFC3339Nano, request.CutoffAt)
	if err != nil || cutoff.IsZero() {
		return request, time.Time{}, ErrInvalidInput
	}
	return request, cutoff.UTC(), nil
}

func notificationResetCutoffIsFresh(cutoff, databaseNow time.Time) bool {
	return !cutoff.After(databaseNow) && !cutoff.Before(databaseNow.Add(-notificationResetPreviewValidity))
}

func (repo Repository) PreviewWhatsAppNotificationReset(ctx context.Context, tenantContext tenant.Context, scope, organizationID string) (WhatsAppNotificationResetPreview, error) {
	if !tenantContext.IsSuperAdmin {
		return WhatsAppNotificationResetPreview{}, tenant.ErrOrganizationAccessDenied
	}
	scope, organizationID, err := normalizeWhatsAppNotificationResetScope(scope, organizationID)
	if err != nil {
		return WhatsAppNotificationResetPreview{}, err
	}
	preview := WhatsAppNotificationResetPreview{Scope: scope, OrganizationID: organizationID}
	err = repo.db.Pool().QueryRow(ctx, `
		with cutoff as materialized (select statement_timestamp() as at)
		select cutoff.at,
		  count(delivery.id) filter (where delivery.status in ('queued','retry_wait','blocked_dependency','leased')),
		  count(delivery.id) filter (where delivery.status in ('sending','accepted'))
		from cutoff
		left join private.notification_deliveries delivery
		  on delivery.channel='whatsapp' and delivery.created_at<=cutoff.at
		 and delivery.status in ('queued','retry_wait','blocked_dependency','leased','sending','accepted')
		 and ($1='all' or delivery.organization_id=nullif($2,'')::uuid)
		group by cutoff.at
	`, scope, organizationID).Scan(&preview.CutoffAt, &preview.PendingCount, &preview.InFlightCount)
	return preview, err
}

// Reset only withdraws external WhatsApp notification jobs that have not started
// a provider request. The inbox event, other channels and human chat outbox stay
// intact. A cancelled lease cannot pass start_notification_delivery's CAS.
func (repo Repository) ResetWhatsAppNotifications(ctx context.Context, tenantContext tenant.Context, request ResetWhatsAppNotificationsRequest) (WhatsAppNotificationResetResult, error) {
	if !tenantContext.IsSuperAdmin {
		return WhatsAppNotificationResetResult{}, tenant.ErrOrganizationAccessDenied
	}
	request, cutoff, err := normalizeWhatsAppNotificationReset(request)
	if err != nil {
		return WhatsAppNotificationResetResult{}, err
	}
	actorID, ok := normalizeUUID(tenantContext.UserID)
	if !ok {
		return WhatsAppNotificationResetResult{}, ErrInvalidInput
	}
	tx, err := repo.db.Pool().BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return WhatsAppNotificationResetResult{}, err
	}
	defer tx.Rollback(ctx)
	if _, err := tx.Exec(ctx, `set local lock_timeout='3s'; set local statement_timeout='30s'`); err != nil {
		return WhatsAppNotificationResetResult{}, err
	}
	var databaseNow time.Time
	if err := tx.QueryRow(ctx, `select clock_timestamp()`).Scan(&databaseNow); err != nil {
		return WhatsAppNotificationResetResult{}, err
	}
	if !notificationResetCutoffIsFresh(cutoff, databaseNow) {
		return WhatsAppNotificationResetResult{}, ErrNotificationResetPreviewExpired
	}
	result := WhatsAppNotificationResetResult{}
	// Wait for a racing start and recheck its state; never SKIP LOCKED here.
	// Cancelling and recording the ledger share the same transaction. A worker
	// that already won the sending transition is preserved and counted below.
	err = tx.QueryRow(ctx, `
		with candidates as materialized (
		  select delivery.id, delivery.status
		  from private.notification_deliveries delivery
		  where delivery.channel='whatsapp' and delivery.created_at<=$1::timestamptz
		    and ($2='all' or delivery.organization_id=nullif($3,'')::uuid)
		    and delivery.status in ('queued','retry_wait','blocked_dependency','leased')
		  order by delivery.id
		  for update of delivery
		), cancelled as (
		  update private.notification_deliveries delivery
		  set status='cancelled', next_attempt_at=null, lease_token=null,
		      leased_by=null, lease_expires_at=null, dependency_key=null,
		      blocked_at=null, terminal_at=now(), last_error_code='manual_whatsapp_queue_reset',
		      last_error_message='Pending WhatsApp notification cancelled by an administrator.',
		      last_error_at=now(), updated_at=now()
		  from candidates
		  where delivery.id=candidates.id
		    and delivery.status in ('queued','retry_wait','blocked_dependency','leased')
		  returning delivery.id, candidates.status as from_status
		), audit as (
		  insert into private.notification_delivery_attempts
		    (delivery_id,event_type,from_status,outcome,completed_at,error_code,metadata)
		  select cancelled.id,'sweep',cancelled.from_status,'cancelled',now(),
		    'manual_whatsapp_queue_reset',jsonb_strip_nulls(jsonb_build_object(
		      'operation','whatsapp_notification_reset','reason',$4::text,
		      'requested_by',$5::text,'scope',$2::text,
		      'organization_id',nullif($3::text,''),'cutoff_at',$1::timestamptz))
		  from cancelled
		  returning delivery_id
		)
		select count(*) from audit
	`, cutoff, request.Scope, request.OrganizationID, request.Reason, actorID).Scan(&result.CancelledCount)
	if err != nil {
		return WhatsAppNotificationResetResult{}, err
	}
	// A new Read Committed snapshot includes any send transition we waited for.
	if err := tx.QueryRow(ctx, `
		select count(*) from private.notification_deliveries delivery
		where delivery.channel='whatsapp' and delivery.created_at<=$1::timestamptz
		  and ($2='all' or delivery.organization_id=nullif($3,'')::uuid)
		  and delivery.status in ('sending','accepted')
	`, cutoff, request.Scope, request.OrganizationID).Scan(&result.InFlightCount); err != nil {
		return WhatsAppNotificationResetResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return WhatsAppNotificationResetResult{}, err
	}
	return result, nil
}

func (handler Handler) PreviewWhatsAppNotificationReset(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := adminContext(w, r)
	if !ok {
		return
	}
	preview, err := handler.repo.PreviewWhatsAppNotificationReset(r.Context(), tenantContext,
		r.URL.Query().Get("scope"), r.URL.Query().Get("organizationId"))
	if err != nil {
		writeAdminError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[WhatsAppNotificationResetPreview]{Data: preview})
}

func (handler Handler) ResetWhatsAppNotifications(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := adminContext(w, r)
	if !ok {
		return
	}
	defer r.Body.Close()
	var request ResetWhatsAppNotificationsRequest
	if err := httpserver.DecodeJSON(w, r, &request, 16<<10); err != nil {
		return
	}
	result, err := handler.repo.ResetWhatsAppNotifications(r.Context(), tenantContext, request)
	if err != nil {
		if errors.Is(err, ErrNotificationResetPreviewExpired) {
			httpserver.WriteError(w, r, http.StatusConflict, "notification_reset_preview_expired", "A prévia da fila expirou. Gere uma nova prévia antes de resetar.")
			return
		}
		writeAdminError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[WhatsAppNotificationResetResult]{Data: result})
}
