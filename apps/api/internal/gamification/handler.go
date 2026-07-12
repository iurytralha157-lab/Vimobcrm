package gamification

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type Handler struct {
	repo Repository
}

func NewHandler(repo Repository) Handler {
	return Handler{repo: repo}
}

func (handler Handler) Overview(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := gamificationOrganizationContext(w, r)
	if !ok {
		return
	}

	overview, err := handler.repo.Overview(r.Context(), tenantContext)
	if err != nil {
		writeGamificationError(w, r, err)
		return
	}

	httpserver.WriteJSON(w, http.StatusOK, Envelope[Overview]{Data: overview})
}

func (handler Handler) Ranking(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := gamificationOrganizationContext(w, r)
	if !ok {
		return
	}
	query, err := rankingQueryFromRequest(r)
	if err != nil {
		writeGamificationError(w, r, err)
		return
	}
	ranking, err := handler.repo.FilteredRanking(r.Context(), tenantContext, query)
	if err != nil {
		writeGamificationError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[[]RankingEntry]{Data: ranking})
}

func (handler Handler) Events(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := gamificationOrganizationContext(w, r)
	if !ok {
		return
	}
	query, err := eventQueryFromRequest(r)
	if err != nil {
		writeGamificationError(w, r, err)
		return
	}
	page, err := handler.repo.EventPage(r.Context(), tenantContext, query)
	if err != nil {
		writeGamificationError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[EventPage]{Data: page})
}

func (handler Handler) AdminSnapshot(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := gamificationOrganizationContext(w, r)
	if !ok {
		return
	}
	snapshot, err := handler.repo.AdminSnapshot(r.Context(), tenantContext)
	if err != nil {
		writeGamificationError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[AdminSnapshot]{Data: snapshot})
}

func (handler Handler) UpsertRule(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := gamificationOrganizationContext(w, r)
	if !ok {
		return
	}
	var request RuleRequest
	if !decodeGamificationJSON(w, r, &request) {
		return
	}
	rule, err := handler.repo.UpsertRule(r.Context(), tenantContext, r.PathValue("actionType"), request)
	if err != nil {
		writeGamificationError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[Rule]{Data: rule})
}

func (handler Handler) SetParticipant(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := gamificationOrganizationContext(w, r)
	if !ok {
		return
	}
	var request ParticipantRequest
	if !decodeGamificationJSON(w, r, &request) {
		return
	}
	participant, err := handler.repo.SetParticipant(r.Context(), tenantContext, r.PathValue("userId"), request)
	if err != nil {
		writeGamificationError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[Participant]{Data: participant})
}

func (handler Handler) CreateMission(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := gamificationOrganizationContext(w, r)
	if !ok {
		return
	}
	var request MissionRequest
	if !decodeGamificationJSON(w, r, &request) {
		return
	}
	mission, err := handler.repo.CreateMission(r.Context(), tenantContext, request)
	if err != nil {
		writeGamificationError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusCreated, Envelope[Mission]{Data: mission})
}

func (handler Handler) UpdateMission(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := gamificationOrganizationContext(w, r)
	if !ok {
		return
	}
	var request MissionRequest
	if !decodeGamificationJSON(w, r, &request) {
		return
	}
	mission, err := handler.repo.UpdateMission(r.Context(), tenantContext, r.PathValue("id"), request)
	if err != nil {
		writeGamificationError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[Mission]{Data: mission})
}

func (handler Handler) DeleteMission(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := gamificationOrganizationContext(w, r)
	if !ok {
		return
	}
	if err := handler.repo.DeleteMission(r.Context(), tenantContext, r.PathValue("id")); err != nil {
		writeGamificationError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (handler Handler) CreateManualEntry(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := gamificationOrganizationContext(w, r)
	if !ok {
		return
	}
	var request ManualEntryRequest
	if !decodeGamificationJSON(w, r, &request) {
		return
	}
	entry, err := handler.repo.CreateManualEntry(r.Context(), tenantContext, request)
	if err != nil {
		writeGamificationError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusCreated, Envelope[ManualEntry]{Data: entry})
}

func (handler Handler) DecideManualEntry(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := gamificationOrganizationContext(w, r)
	if !ok {
		return
	}
	var request ManualEntryDecisionRequest
	if !decodeGamificationJSON(w, r, &request) {
		return
	}
	entry, err := handler.repo.DecideManualEntry(r.Context(), tenantContext, r.PathValue("id"), request)
	if err != nil {
		writeGamificationError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, Envelope[ManualEntry]{Data: entry})
}

func (handler Handler) ResetSeason(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := gamificationOrganizationContext(w, r)
	if !ok {
		return
	}
	var request SeasonRequest
	if !decodeGamificationJSON(w, r, &request) {
		return
	}
	season, err := handler.repo.ResetSeason(r.Context(), tenantContext, request)
	if err != nil {
		writeGamificationError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusCreated, Envelope[Season]{Data: season})
}

func gamificationOrganizationContext(w http.ResponseWriter, r *http.Request) (tenant.Context, bool) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return tenant.Context{}, false
	}
	return tenantContext, true
}

func rankingQueryFromRequest(r *http.Request) (RankingQuery, error) {
	query := RankingQuery{}
	var err error
	query.From, err = parseOptionalQueryTime(r, "from")
	if err != nil {
		return RankingQuery{}, err
	}
	query.To, err = parseOptionalQueryTime(r, "to")
	if err != nil {
		return RankingQuery{}, err
	}
	if query.From != nil && query.To != nil && !query.From.Before(*query.To) {
		return RankingQuery{}, ErrInvalidInput
	}

	seen := map[string]struct{}{}
	for _, rawValue := range r.URL.Query()["actionType"] {
		for _, candidate := range strings.Split(rawValue, ",") {
			actionType := normalizeActionType(candidate)
			if actionType == "" {
				return RankingQuery{}, ErrInvalidInput
			}
			if _, exists := seen[actionType]; exists {
				continue
			}
			seen[actionType] = struct{}{}
			query.ActionTypes = append(query.ActionTypes, actionType)
		}
	}
	if len(query.ActionTypes) > len(defaultRules()) {
		return RankingQuery{}, ErrInvalidInput
	}
	return query, nil
}

type eventCursorPayload struct {
	OccurredAt string `json:"occurredAt"`
	ID         string `json:"id"`
}

func eventQueryFromRequest(r *http.Request) (EventQuery, error) {
	query := EventQuery{Limit: 30}
	var err error
	query.From, err = parseOptionalQueryTime(r, "from")
	if err != nil {
		return EventQuery{}, err
	}
	query.To, err = parseOptionalQueryTime(r, "to")
	if err != nil {
		return EventQuery{}, err
	}
	if query.From != nil && query.To != nil && !query.From.Before(*query.To) {
		return EventQuery{}, ErrInvalidInput
	}

	if rawLimit := strings.TrimSpace(r.URL.Query().Get("limit")); rawLimit != "" {
		query.Limit, err = strconv.Atoi(rawLimit)
		if err != nil || query.Limit < 1 || query.Limit > 100 {
			return EventQuery{}, ErrInvalidInput
		}
	}
	query.UserID = strings.TrimSpace(r.URL.Query().Get("userId"))
	if query.UserID != "" && !isUUIDText(query.UserID) {
		return EventQuery{}, ErrInvalidInput
	}

	if rawCursor := strings.TrimSpace(r.URL.Query().Get("cursor")); rawCursor != "" {
		payload, decodeErr := decodeEventCursor(rawCursor)
		if decodeErr != nil {
			return EventQuery{}, decodeErr
		}
		query.CursorOccurredAt = &payload.OccurredAt
		query.CursorID = payload.ID
	}
	return query, nil
}

type decodedEventCursor struct {
	OccurredAt time.Time
	ID         string
}

func encodeEventCursor(occurredAt time.Time, id string) (string, error) {
	payload, err := json.Marshal(eventCursorPayload{
		OccurredAt: occurredAt.UTC().Format(time.RFC3339Nano),
		ID:         id,
	})
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(payload), nil
}

func decodeEventCursor(value string) (decodedEventCursor, error) {
	payload, err := base64.RawURLEncoding.DecodeString(strings.TrimSpace(value))
	if err != nil {
		return decodedEventCursor{}, ErrInvalidInput
	}
	var cursor eventCursorPayload
	if err := json.Unmarshal(payload, &cursor); err != nil || !isUUIDText(cursor.ID) {
		return decodedEventCursor{}, ErrInvalidInput
	}
	occurredAt, err := time.Parse(time.RFC3339Nano, strings.TrimSpace(cursor.OccurredAt))
	if err != nil {
		return decodedEventCursor{}, ErrInvalidInput
	}
	return decodedEventCursor{OccurredAt: occurredAt.UTC(), ID: cursor.ID}, nil
}

func parseOptionalQueryTime(r *http.Request, name string) (*time.Time, error) {
	value := strings.TrimSpace(r.URL.Query().Get(name))
	if value == "" {
		return nil, nil
	}
	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		return nil, ErrInvalidInput
	}
	parsed = parsed.UTC()
	return &parsed, nil
}

func decodeGamificationJSON(w http.ResponseWriter, r *http.Request, target any) bool {
	defer r.Body.Close()
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
		return false
	}
	return true
}

func writeGamificationError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrInvalidInput):
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_gamification_input", "Gamification input is invalid.")
	case errors.Is(err, ErrNotFound):
		httpserver.WriteError(w, r, http.StatusNotFound, "gamification_not_found", "Gamification resource was not found.")
	case errors.Is(err, ErrNotReady):
		httpserver.WriteError(w, r, http.StatusConflict, "gamification_schema_not_ready", "Gamification admin schema is not ready.")
	case errors.Is(err, tenant.ErrOrganizationAccessDenied):
		httpserver.WriteError(w, r, http.StatusForbidden, "permission_denied", "You do not have permission to perform this action.")
	default:
		httpserver.WriteError(w, r, http.StatusInternalServerError, "gamification_operation_failed", "Unable to complete gamification operation.")
	}
}
