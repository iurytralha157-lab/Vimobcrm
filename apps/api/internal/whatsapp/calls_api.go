package whatsapp

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

var ErrCallNotFound = errors.New("whatsapp call not found")
var ErrCallAlreadyClaimed = errors.New("whatsapp call is already being answered")

type WhatsAppCall struct {
	ID                    string     `json:"id"`
	OrganizationID        string     `json:"organization_id"`
	SessionID             string     `json:"session_id"`
	ConversationID        *string    `json:"conversation_id"`
	LeadID                *string    `json:"lead_id"`
	OperatorUserID        *string    `json:"operator_user_id"`
	ProviderCallID        string     `json:"provider_call_id"`
	RemoteJID             string     `json:"remote_jid"`
	Direction             string     `json:"direction"`
	State                 string     `json:"state"`
	Reason                *string    `json:"reason"`
	OfferedAt             *time.Time `json:"offered_at"`
	AnsweredAt            *time.Time `json:"answered_at"`
	EndedAt               *time.Time `json:"ended_at"`
	LastEventAt           time.Time  `json:"last_event_at"`
	RecordingStatus       string     `json:"recording_status"`
	RecordingIncomingPath *string    `json:"-"`
	RecordingOutgoingPath *string    `json:"-"`
	CreatedAt             time.Time  `json:"created_at"`
}

const whatsappCallSelectFields = `
	c.id::text, c.organization_id::text, c.session_id::text,
	c.conversation_id::text, c.lead_id::text, c.operator_user_id::text,
	c.provider_call_id, c.remote_jid, c.direction, c.state, c.reason,
	c.offered_at, c.answered_at, c.ended_at, c.last_event_at,
	c.recording_status, c.recording_incoming_path,
	c.recording_outgoing_path, c.created_at
`

func scanWhatsAppCall(row scanner) (WhatsAppCall, error) {
	var call WhatsAppCall
	err := row.Scan(
		&call.ID, &call.OrganizationID, &call.SessionID,
		&call.ConversationID, &call.LeadID, &call.OperatorUserID,
		&call.ProviderCallID, &call.RemoteJID, &call.Direction, &call.State,
		&call.Reason, &call.OfferedAt, &call.AnsweredAt, &call.EndedAt,
		&call.LastEventAt, &call.RecordingStatus, &call.RecordingIncomingPath,
		&call.RecordingOutgoingPath, &call.CreatedAt,
	)
	return call, err
}

func (repo Repository) ownedCall(
	ctx context.Context,
	tenantContext tenant.Context,
	callID string,
) (WhatsAppCall, error) {
	callID, valid := normalizeUUID(callID)
	if !valid {
		return WhatsAppCall{}, ErrCallNotFound
	}
	args := append(baseConversationArgs(tenantContext), callID)
	call, err := scanWhatsAppCall(repo.db.Pool().QueryRow(ctx, `
		select `+whatsappCallSelectFields+`
		from public.whatsapp_calls c
		join public.whatsapp_sessions ws
		  on ws.id = c.session_id and ws.organization_id = c.organization_id
		left join public.leads l
		  on l.id = c.lead_id and l.organization_id = c.organization_id
		where c.organization_id = $1::uuid
		  and c.id = $5::uuid
		  and ws.owner_user_id = $2::uuid
		  and ws.provider = 'evolution_go'
		  and (
		    c.lead_id is null
		    or (l.id is not null and `+leadVisibilitySQL(canViewOwnWhatsAppLeads(tenantContext))+`)
		  )
	`, args...))
	if errors.Is(err, pgx.ErrNoRows) {
		return WhatsAppCall{}, ErrCallNotFound
	}
	return call, err
}

func (repo Repository) listOwnedCalls(
	ctx context.Context,
	tenantContext tenant.Context,
	sessionID string,
	limit int,
) ([]WhatsAppCall, error) {
	sessionID, valid := normalizeUUID(sessionID)
	if !valid {
		return nil, ErrSessionNotFound
	}
	if err := repo.ensureCanManageSession(ctx, tenantContext, sessionID); err != nil {
		return nil, err
	}
	if limit <= 0 {
		limit = 50
	}
	if limit > 100 {
		limit = 100
	}
	args := append(baseConversationArgs(tenantContext), sessionID, limit)
	rows, err := repo.db.Pool().Query(ctx, `
		select `+whatsappCallSelectFields+`
		from public.whatsapp_calls c
		join public.whatsapp_sessions ws
		  on ws.id = c.session_id and ws.organization_id = c.organization_id
		left join public.leads l
		  on l.id = c.lead_id and l.organization_id = c.organization_id
		where c.organization_id = $1::uuid
		  and c.session_id = $5::uuid
		  and ws.owner_user_id = $2::uuid
		  and (
		    c.lead_id is null
		    or (l.id is not null and `+leadVisibilitySQL(canViewOwnWhatsAppLeads(tenantContext))+`)
		  )
		order by c.last_event_at desc, c.id desc
		limit $6
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]WhatsAppCall, 0)
	for rows.Next() {
		call, scanErr := scanWhatsAppCall(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		result = append(result, call)
	}
	return result, rows.Err()
}

// Historical calls remain visible to the session owner after the feature is
// disabled or the session disconnects. The immutable creation time and ID form
// a stable keyset cursor while state/recording updates are still arriving.
func (repo Repository) listOwnedCallHistory(
	ctx context.Context,
	tenantContext tenant.Context,
	limit int,
	beforeAt *time.Time,
	beforeID *string,
) ([]WhatsAppCall, error) {
	var cursorAt any
	var cursorID any
	if beforeAt != nil && beforeID != nil {
		cursorAt, cursorID = *beforeAt, *beforeID
	}
	args := append(baseConversationArgs(tenantContext), limit, cursorAt, cursorID)
	rows, err := repo.db.Pool().Query(ctx, `
		select `+whatsappCallSelectFields+`
		from public.whatsapp_calls c
		join public.whatsapp_sessions ws
		  on ws.id = c.session_id and ws.organization_id = c.organization_id
		left join public.leads l
		  on l.id = c.lead_id and l.organization_id = c.organization_id
		where c.organization_id = $1::uuid
		  and ws.owner_user_id = $2::uuid
		  and ws.provider = 'evolution_go'
		  and (
		    c.lead_id is null
		    or (l.id is not null and `+leadVisibilitySQL(canViewOwnWhatsAppLeads(tenantContext))+`)
		  )
		  and ($6::timestamptz is null or (c.created_at, c.id) < ($6::timestamptz, $7::uuid))
		order by c.created_at desc, c.id desc
		limit $5
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]WhatsAppCall, 0)
	for rows.Next() {
		call, scanErr := scanWhatsAppCall(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		result = append(result, call)
	}
	return result, rows.Err()
}

func parseCallHistoryQuery(rawLimit, rawBeforeAt, rawBeforeID string) (int, *time.Time, *string, error) {
	limit := 50
	if rawLimit != "" {
		parsed, err := strconv.Atoi(rawLimit)
		if err != nil || parsed <= 0 {
			return 0, nil, nil, ErrInvalidInput
		}
		limit = min(parsed, 100)
	}
	if (rawBeforeAt == "") != (rawBeforeID == "") {
		return 0, nil, nil, ErrInvalidInput
	}
	if rawBeforeAt == "" {
		return limit, nil, nil, nil
	}
	beforeAt, err := time.Parse(time.RFC3339Nano, rawBeforeAt)
	if err != nil {
		return 0, nil, nil, ErrInvalidInput
	}
	beforeID, valid := normalizeUUID(rawBeforeID)
	if !valid {
		return 0, nil, nil, ErrInvalidInput
	}
	return limit, &beforeAt, &beforeID, nil
}

func (repo Repository) listActiveOwnedCalls(
	ctx context.Context,
	tenantContext tenant.Context,
) ([]WhatsAppCall, error) {
	args := baseConversationArgs(tenantContext)
	rows, err := repo.db.Pool().Query(ctx, `
		select `+whatsappCallSelectFields+`
		from public.whatsapp_calls c
		join public.whatsapp_sessions ws
		  on ws.id = c.session_id and ws.organization_id = c.organization_id
		left join public.leads l
		  on l.id = c.lead_id and l.organization_id = c.organization_id
		where c.organization_id = $1::uuid
		  and ws.owner_user_id = $2::uuid
		  and ws.provider = 'evolution_go'
		  and ws.status = 'connected'
		  and coalesce(ws.is_active, true)
		  and lower(coalesce(ws.advanced_settings->>'whatsapp_calls_enabled', 'false')) in ('true','1')
		  and c.state in ('incoming','outgoing','ringing','active',
		                  'end_pending','reject_pending','outcome_unknown')
		  and (c.lead_id is null or (l.id is not null and `+leadVisibilitySQL(canViewOwnWhatsAppLeads(tenantContext))+`))
		order by c.last_event_at desc, c.id desc
		limit 100
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]WhatsAppCall, 0)
	for rows.Next() {
		call, scanErr := scanWhatsAppCall(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		result = append(result, call)
	}
	return result, rows.Err()
}

func (repo Repository) listLeadCalls(
	ctx context.Context,
	tenantContext tenant.Context,
	leadID string,
) ([]WhatsAppCall, error) {
	leadID, valid := normalizeUUID(leadID)
	if !valid {
		return nil, ErrInvalidReference
	}
	args := append(baseConversationArgs(tenantContext), leadID)
	rows, err := repo.db.Pool().Query(ctx, `
		select `+whatsappCallSelectFields+`
		from public.whatsapp_calls c
		join public.whatsapp_sessions ws
		  on ws.id = c.session_id and ws.organization_id = c.organization_id
		join public.leads l
		  on l.id = c.lead_id and l.organization_id = c.organization_id
		where c.organization_id = $1::uuid
		  and c.lead_id = $5::uuid
		  and ws.owner_user_id = $2::uuid
		  and `+leadVisibilitySQL(canViewOwnWhatsAppLeads(tenantContext))+`
		order by c.last_event_at desc, c.id desc
		limit 100
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := make([]WhatsAppCall, 0)
	for rows.Next() {
		call, scanErr := scanWhatsAppCall(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		result = append(result, call)
	}
	return result, rows.Err()
}

func (repo Repository) requireCallFeature(
	ctx context.Context,
	tenantContext tenant.Context,
	sessionID string,
	feature string,
) error {
	sessionID, valid := normalizeUUID(sessionID)
	if !valid {
		return ErrSessionNotFound
	}
	if !stringIn(feature, "whatsapp_calls_enabled", "whatsapp_contact_save_enabled") {
		return ErrInvalidInput
	}
	var status string
	var enabled bool
	err := repo.db.Pool().QueryRow(ctx, `
		select status,
		  case when $4 = 'whatsapp_calls_enabled'
		    then lower(coalesce(advanced_settings->>'whatsapp_calls_enabled', 'false')) in ('true','1')
		    else lower(coalesce(advanced_settings->>'whatsapp_contact_save_enabled', 'false')) in ('true','1')
		  end
		from public.whatsapp_sessions
		where organization_id = $1::uuid
		  and id = $2::uuid
		  and owner_user_id = $3::uuid
		  and provider = 'evolution_go'
		  and coalesce(is_active, true) = true
		  and coalesce(status, '') <> 'deleted'
	`, tenantContext.OrganizationID, sessionID, tenantContext.UserID, feature).Scan(&status, &enabled)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrSessionNotFound
	}
	if err != nil {
		return err
	}
	if !enabled {
		return fmt.Errorf("%w: recurso ainda não habilitado para esta conexão", ErrFeatureUnavailable)
	}
	if status != "connected" {
		return fmt.Errorf("%w: conexão WhatsApp indisponível", ErrFeatureUnavailable)
	}
	return nil
}

func (handler Handler) ListCalls(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := requireTenant(w, r)
	if !ok {
		return
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	calls, err := handler.repo.listOwnedCalls(r.Context(), tenantContext, r.PathValue("id"), limit)
	if err != nil {
		writeWhatsAppError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[[]WhatsAppCall]{Data: calls})
}

func (handler Handler) ListCallHistory(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := requireTenant(w, r)
	if !ok {
		return
	}
	query := r.URL.Query()
	limit, beforeAt, beforeID, err := parseCallHistoryQuery(
		query.Get("limit"), query.Get("before_at"), query.Get("before_id"),
	)
	if err != nil {
		writeWhatsAppError(w, r, err)
		return
	}
	calls, err := handler.repo.listOwnedCallHistory(r.Context(), tenantContext, limit, beforeAt, beforeID)
	if err != nil {
		writeWhatsAppError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[[]WhatsAppCall]{Data: calls})
}

func (handler Handler) ListActiveCalls(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := requireTenant(w, r)
	if !ok {
		return
	}
	calls, err := handler.repo.listActiveOwnedCalls(r.Context(), tenantContext)
	if err != nil {
		writeWhatsAppError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[[]WhatsAppCall]{Data: calls})
}

func (handler Handler) ListLeadCalls(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := requireTenant(w, r)
	if !ok {
		return
	}
	calls, err := handler.repo.listLeadCalls(r.Context(), tenantContext, r.PathValue("id"))
	if err != nil {
		writeWhatsAppError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[[]WhatsAppCall]{Data: calls})
}

func (handler Handler) StartCall(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := requireTenant(w, r)
	if !ok {
		return
	}
	call, err := handler.repo.startCall(r.Context(), tenantContext, r.PathValue("id"))
	if err != nil {
		writeWhatsAppError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[WhatsAppCall]{Data: call})
}

func (handler Handler) CallAction(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := requireTenant(w, r)
	if !ok {
		return
	}
	action := strings.TrimPrefix(r.URL.Path, "/")
	if at := strings.LastIndex(action, "/"); at >= 0 {
		action = action[at+1:]
	}
	call, err := handler.repo.callAction(r.Context(), tenantContext, r.PathValue("id"), action)
	if err != nil {
		writeWhatsAppError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[WhatsAppCall]{Data: call})
}

func (handler Handler) SaveLeadContact(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := requireTenant(w, r)
	if !ok {
		return
	}
	var body struct {
		LeadID string `json:"leadId"`
	}
	if !decodeWhatsAppJSON(w, r, &body, 1<<12) {
		return
	}
	err := handler.repo.saveLeadContact(r.Context(), tenantContext, r.PathValue("id"), body.LeadID)
	if err != nil {
		writeWhatsAppError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[map[string]bool]{Data: map[string]bool{"saved": true}})
}

func (handler Handler) SaveConversationContact(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := requireTenant(w, r)
	if !ok {
		return
	}
	var body struct {
		FullName string `json:"fullName"`
	}
	if !decodeWhatsAppJSON(w, r, &body, 1<<12) {
		return
	}
	err := handler.repo.saveConversationContact(r.Context(), tenantContext, r.PathValue("id"), body.FullName)
	if err != nil {
		writeWhatsAppError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[map[string]bool]{Data: map[string]bool{"saved": true}})
}
