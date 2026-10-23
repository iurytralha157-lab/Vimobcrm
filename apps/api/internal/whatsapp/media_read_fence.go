package whatsapp

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type messageMediaReadScope struct {
	ID             string `json:"id"`
	ConversationID string `json:"conversation_id"`
	SessionID      string `json:"session_id"`
	LeadID         string `json:"lead_id"`
	Path           string `json:"path"`
	Capture        string `json:"capture"`
	Kind           string `json:"kind"`
	Status         string `json:"status"`
}

// Bulk hydration resolves the actor and all message scopes once per phase,
// keeping query count independent of the number of parallel signing calls.
func loadMessageMediaReadScopes(ctx context.Context, queryer whatsappQueryRower, actor tenant.Context, ids []string) (map[string]messageMediaReadScope, error) {
	current, snapshot, err := currentWhatsAppActorWithSnapshot(ctx, queryer, actor)
	if err != nil {
		return nil, err
	}
	result := map[string]messageMediaReadScope{}
	if !current.HasPermission(permissions.WhatsAppView) {
		return result, nil
	}
	args := append(baseConversationArgs(current), ids, snapshot)
	var raw string
	err = queryer.QueryRow(ctx, `select coalesce(jsonb_agg(jsonb_build_object('id',wm.id::text,'conversation_id',wm.conversation_id::text,
	 'session_id',coalesce(wm.session_id::text,''),'lead_id',coalesce(wm.lead_id::text,''),'path',wm.media_storage_path,
	 'capture',coalesce(wm.capture_state,''),'kind',wm.message_type,'status',wm.media_status))::text,'[]')
	 from public.whatsapp_messages wm join public.whatsapp_conversations wc on wc.id=wm.conversation_id and wc.organization_id=wm.organization_id
	 left join public.whatsapp_sessions ws on ws.id=wm.session_id and ws.organization_id=wm.organization_id
	 left join public.leads l on l.id=wm.lead_id and l.organization_id=wm.organization_id
	 where wm.organization_id=$1::uuid and wm.id=any($5::uuid[]) and wm.capture_state is distinct from 'suppressed'
	 and wm.unlinked_retention_scrubbed_at is null and wm.message_type not in ('text','reaction','deleted','deleted_event','system')
	 and wm.media_status='ready' and `+messageMediaVisibilitySQL(canViewOwnWhatsAppLeads(current))+` and `+currentWhatsAppActorSnapshotPredicateSQL("$6"), args...).Scan(&raw)
	if err != nil {
		return nil, err
	}
	var scopes []messageMediaReadScope
	if err := json.Unmarshal([]byte(raw), &scopes); err != nil {
		return nil, err
	}
	for _, scope := range scopes {
		result[scope.ID] = scope
	}
	return result, nil
}

func loadMessageMediaReadScope(ctx context.Context, queryer whatsappQueryRower, actor tenant.Context, id string, requireReady bool, operational ...bool) (messageMediaReadScope, error) {
	current, snapshot, err := currentWhatsAppActorWithSnapshot(ctx, queryer, actor)
	if errors.Is(err, tenant.ErrOrganizationAccessDenied) {
		return messageMediaReadScope{}, ErrMessageNotFound
	}
	if err != nil {
		return messageMediaReadScope{}, err
	}
	if !current.HasPermission(permissions.WhatsAppView) {
		return messageMediaReadScope{}, ErrMessageNotFound
	}
	operationPredicate := "true"
	if len(operational) > 0 && operational[0] {
		if !current.HasPermission(permissions.WhatsAppOperate) {
			return messageMediaReadScope{}, tenant.ErrOrganizationAccessDenied
		}
		operationPredicate = `exists(select 1 from public.users original where original.id=$2::uuid and original.organization_id=$1::uuid)`
	}
	args := append(baseConversationArgs(current), id, requireReady, snapshot)
	var scope messageMediaReadScope
	err = queryer.QueryRow(ctx, `select wm.id::text,coalesce(wm.conversation_id::text,''),coalesce(wm.session_id::text,''),coalesce(wm.lead_id::text,''),
	 coalesce(wm.media_storage_path,''),coalesce(wm.capture_state,''),coalesce(wm.message_type,''),coalesce(wm.media_status,'')
	 from public.whatsapp_messages wm join public.whatsapp_conversations wc on wc.id=wm.conversation_id and wc.organization_id=wm.organization_id
	 left join public.whatsapp_sessions ws on ws.id=wm.session_id and ws.organization_id=wm.organization_id
	 left join public.leads l on l.id=wm.lead_id and l.organization_id=wm.organization_id
	 where wm.organization_id=$1::uuid and wm.id=$5::uuid and wm.capture_state is distinct from 'suppressed'
	 and wm.unlinked_retention_scrubbed_at is null and wm.message_type not in ('text','reaction','deleted','deleted_event','system')
	 and (not $6::boolean or wm.media_status='ready')
	 and `+messageMediaVisibilitySQL(canViewOwnWhatsAppLeads(current))+` and `+currentWhatsAppActorSnapshotPredicateSQL("$7")+` and `+operationPredicate, args...).Scan(&scope.ID, &scope.ConversationID, &scope.SessionID, &scope.LeadID, &scope.Path, &scope.Capture, &scope.Kind, &scope.Status)
	if errors.Is(err, pgx.ErrNoRows) {
		return messageMediaReadScope{}, ErrMessageNotFound
	}
	return scope, err
}

func revalidateMessageMediaReadScope(ctx context.Context, queryer whatsappQueryRower, actor tenant.Context, expected messageMediaReadScope, requireReady bool, operational ...bool) error {
	current, err := loadMessageMediaReadScope(ctx, queryer, actor, expected.ID, requireReady, operational...)
	if err != nil {
		return err
	}
	if current.ConversationID != expected.ConversationID || current.SessionID != expected.SessionID || current.LeadID != expected.LeadID || current.Path != expected.Path || current.Capture != expected.Capture || current.Kind != expected.Kind {
		return ErrMessageNotFound
	}
	return nil
}
