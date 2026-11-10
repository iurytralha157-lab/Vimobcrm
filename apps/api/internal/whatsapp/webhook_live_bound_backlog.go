package whatsapp

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

const liveBoundDeadBacklogBypassSchemaQuery = `
	select coalesce(pg_catalog.has_function_privilege(pg_catalog.to_regprocedure(
		'private.capture_whatsapp_webhook_routing_snapshot_live_bound_v3(uuid,uuid,text,text,text,text,boolean,text[],text,text,text,boolean,boolean,boolean,uuid,uuid,uuid,integer)'
	), 'EXECUTE'), false) and exists (
		select 1
		from pg_catalog.pg_proc
		where oid = pg_catalog.to_regprocedure(
			'private.capture_whatsapp_webhook_routing_snapshot_v2(uuid,uuid,text,text,text,text,boolean,text[],text,text,text,boolean,boolean,boolean,uuid,uuid,uuid,integer)'
		) and pg_catalog.md5(prosrc) = 'c83cd66e37361bfa2188d6317cedfbd8'
	)`

// ValidateLiveBoundDeadBacklogBypassSchema is required before this API may
// accept a webhook using the opt-in RPC.
func ValidateLiveBoundDeadBacklogBypassSchema(ctx context.Context, db *dbpkg.Postgres) error {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	var ready bool
	err := db.Pool().QueryRow(ctx, liveBoundDeadBacklogBypassSchemaQuery).Scan(&ready)
	if err != nil {
		return fmt.Errorf("verify WhatsApp live bound backlog bypass schema: %w", err)
	}
	if !ready {
		return errors.New("WhatsApp live bound backlog bypass requires the pinned legacy routing snapshot v2 and EXECUTE on v3")
	}
	return nil
}

// The RPC still checks the current binding and exact dead predecessor under
// its existing routing lock. These are admission checks on provider evidence
// only. A live lane on its own cannot establish freshness of a message part.
func liveBoundDeadBacklogCaptureEligible(part evolutionWebhookDurablePart, message nativeEvolutionMessage, rule nativeInboundRule, schedulingKey, bindingKey string) bool {
	if part.ProcessingLane != evolutionWebhookLaneLive || part.ReceivedAt.IsZero() || part.ProviderOccurredAt == nil ||
		schedulingKey != bindingKey || bindingKey == "" || bindingKey == evolutionWebhookSessionRoute {
		return false
	}
	if message.FromMe || message.IsGroup || message.IsReaction || message.IsDeletion || message.UnsupportedID ||
		message.UnsupportedMessage || message.ProviderMessageIDSynthetic || strings.TrimSpace(message.ProviderMessageID) == "" ||
		message.IdentityPNConflict || message.HasCampaignSignal || message.IsCTWAAd || message.legacyContextualIntake ||
		!strings.EqualFold(strings.TrimSpace(message.MessageType), "text") || strings.TrimSpace(message.Content) == "" {
		return false
	}
	if rule.ManagedMessageDistribution || rule.ManagedProviderEventPending || rule.ManagedProviderEventHandled ||
		rule.LegacyNonManagedRetry || rule.CanonicalIntakeResolved || rule.ID != "" || rule.TargetRoundRobinID != "" || rule.ManagedProviderEventLeadID != "" {
		return false
	}
	contact, domain, _ := strings.Cut(normalizeRemoteAlias(message.RemoteJID), "@")
	if contact == "" || normalizeDigits(contact) != contact || (domain != "s.whatsapp.net" && domain != "c.us" && domain != "lid") {
		return false
	}
	occurredAt, present := nativeEvolutionMessageProviderOccurredAt(message)
	return present && occurredAt.Equal(*part.ProviderOccurredAt) && evolutionWebhookOccurredInLiveWindow(part.ReceivedAt, occurredAt)
}
