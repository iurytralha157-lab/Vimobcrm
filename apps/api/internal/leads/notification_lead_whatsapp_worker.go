package leads

import (
	"context"
	"errors"
	"log/slog"
	"strings"
	"time"
)

type notificationClaimLane string

const (
	notificationClaimLegacy   notificationClaimLane = ""
	notificationClaimGeneral  notificationClaimLane = "|lead_wa_general_v1"
	notificationClaimLeadWA   notificationClaimLane = "|lead_wa_fast_v1"
	leadWhatsAppClaimInterval                       = 2 * time.Second
)

const leadWhatsAppClaimCapability = "pg_catalog.to_regprocedure('private.notification_lead_whatsapp_fast_claim_v1()') is not null"

func (repo Repository) startLeadWhatsAppNotificationWorker(ctx context.Context, logger *slog.Logger) notificationClaimLane {
	probeCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()

	var supported bool
	if err := repo.db.Pool().QueryRow(probeCtx, "select "+leadWhatsAppClaimCapability).Scan(&supported); err != nil {
		if ctx.Err() == nil {
			logger.Warn("lead WhatsApp notification claim capability check failed")
		}
		return notificationClaimLegacy
	}
	if !supported {
		return notificationClaimLegacy
	}
	go repo.runLeadWhatsAppNotificationWorker(ctx, logger)
	logger.Info("lead WhatsApp notification worker started")
	return notificationClaimGeneral
}

func (repo Repository) runLeadWhatsAppNotificationWorker(ctx context.Context, logger *slog.Logger) {
	timer := time.NewTimer(0)
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
			deadline := time.Now().Add(notificationDispatchDrainTimeout)
			for range notificationDispatchDrainLimit {
				if ctx.Err() != nil || time.Now().After(deadline) {
					break
				}
				processed, err := repo.processOneNormalizedNotificationDeliveryForLane(ctx, logger, notificationClaimLeadWA)
				if err != nil && !errors.Is(err, context.Canceled) {
					repo.recordNotificationDispatchError()
					logger.Error("lead WhatsApp notification worker failed", "error", err)
				}
				if err != nil || !processed {
					break
				}
			}
			timer.Reset(leadWhatsAppClaimInterval)
		}
	}
}

func isFastLeadWhatsAppNotification(channel string, notification pendingNotification) bool {
	if channel != "whatsapp" {
		return false
	}
	switch strings.ToLower(strings.TrimSpace(stringFromMap(notification.Metadata, "event_key"))) {
	case "new_lead_received", "lead_redistribution_warning", "lead_redistributed_received", "lead_redistributed_away":
		return true
	default:
		return false
	}
}
