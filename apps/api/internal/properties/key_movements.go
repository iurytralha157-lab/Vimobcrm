package properties

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const (
	keyMovementPageDefaultLimit = 20
	keyMovementPageMaxLimit     = 100
	keyMovementCursorMaxLength  = 512
)

type PropertyKeyMovementRecord struct {
	ID               string  `json:"id"`
	PropertyKeyID    string  `json:"property_key_id"`
	KeyName          string  `json:"key_name"`
	MovementType     string  `json:"movement_type"`
	ActorName        *string `json:"actor_name"`
	HolderName       *string `json:"holder_name"`
	Reason           *string `json:"reason"`
	Notes            *string `json:"notes"`
	FromLocation     *string `json:"from_location"`
	ToLocation       *string `json:"to_location"`
	OccurredAt       string  `json:"occurred_at"`
	ExpectedReturnAt *string `json:"expected_return_at"`
}

type PropertyKeyMovementPageMeta struct {
	CanViewKeyCustody bool `json:"can_view_key_custody"`
}

type PropertyKeyMovementPage struct {
	Data       []PropertyKeyMovementRecord `json:"data"`
	NextCursor *string                     `json:"next_cursor"`
	Meta       PropertyKeyMovementPageMeta `json:"meta"`
}

type propertyKeyMovementFilter struct {
	Limit  int
	Type   string
	Cursor *keyMovementCursor
}

type keyMovementCursor struct {
	OccurredAt time.Time `json:"occurred_at"`
	ID         string    `json:"id"`
}

func parsePropertyKeyMovementFilter(values url.Values) (propertyKeyMovementFilter, error) {
	filter := propertyKeyMovementFilter{Limit: keyMovementPageDefaultLimit}
	if raw := strings.TrimSpace(values.Get("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > keyMovementPageMaxLimit {
			return filter, fmt.Errorf("%w: limit must be between 1 and %d", ErrInvalidInput, keyMovementPageMaxLimit)
		}
		filter.Limit = parsed
	}
	if raw := strings.ToLower(strings.TrimSpace(values.Get("type"))); raw != "" {
		// "registration" is written by key creation, so it cannot be appended
		// through the movement endpoint but does appear in the history.
		if _, valid := validKeyMovementTypes[raw]; !valid && raw != "registration" {
			return filter, fmt.Errorf("%w: type is invalid", ErrInvalidInput)
		}
		filter.Type = raw
	}
	if raw := strings.TrimSpace(values.Get("cursor")); raw != "" {
		cursor, err := decodeKeyMovementCursor(raw)
		if err != nil {
			return filter, err
		}
		filter.Cursor = &cursor
	}
	return filter, nil
}

func encodeKeyMovementCursor(cursor keyMovementCursor) string {
	payload, _ := json.Marshal(cursor)
	return base64.RawURLEncoding.EncodeToString(payload)
}

func decodeKeyMovementCursor(raw string) (keyMovementCursor, error) {
	invalid := fmt.Errorf("%w: cursor is invalid", ErrInvalidInput)
	if len(raw) > keyMovementCursorMaxLength {
		return keyMovementCursor{}, invalid
	}
	payload, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return keyMovementCursor{}, invalid
	}
	decoder := json.NewDecoder(strings.NewReader(string(payload)))
	decoder.DisallowUnknownFields()
	var cursor keyMovementCursor
	if err := decoder.Decode(&cursor); err != nil {
		return keyMovementCursor{}, invalid
	}
	id, valid := normalizeUUID(cursor.ID)
	if !valid || cursor.OccurredAt.IsZero() {
		return keyMovementCursor{}, invalid
	}
	cursor.ID = id
	return cursor, nil
}

// ListPropertyKeyMovements pages the custody history across every key of one
// property. As in the workspace, physical custody is visible only to property
// managers: other viewers of a visible property receive an empty page with
// can_view_key_custody=false, and an invisible property is a 404.
func (repo Repository) ListPropertyKeyMovements(ctx context.Context, tenantContext tenant.Context, propertyID string, filter propertyKeyMovementFilter) (PropertyKeyMovementPage, error) {
	propertyID, ok := normalizeUUID(propertyID)
	if !ok {
		return PropertyKeyMovementPage{}, ErrPropertyNotFound
	}
	canManage := canManageProperties(tenantContext)
	page := PropertyKeyMovementPage{
		Data: []PropertyKeyMovementRecord{},
		Meta: PropertyKeyMovementPageMeta{CanViewKeyCustody: canManage},
	}

	visibilityArgs, visibilityWhere := []any{tenantContext.OrganizationID, propertyID}, []string{
		"p.organization_id = $1::uuid",
		"p.id = $2::uuid",
	}
	visibilityArgs, visibilityWhere = addScopedPropertyVisibility(visibilityArgs, visibilityWhere, tenantContext, "p", "")
	var visible bool
	if err := repo.db.Pool().QueryRow(ctx, `
		select exists (select 1 from public.properties p where `+strings.Join(visibilityWhere, " and ")+`)
	`, visibilityArgs...).Scan(&visible); err != nil {
		return PropertyKeyMovementPage{}, err
	}
	if !visible {
		return PropertyKeyMovementPage{}, ErrPropertyNotFound
	}
	if !canManage {
		return page, nil
	}

	args := []any{tenantContext.OrganizationID, propertyID, filter.Limit + 1}
	conditions := ""
	if filter.Type != "" {
		args = append(args, filter.Type)
		conditions += fmt.Sprintf(" and movement.movement_type = $%d", len(args))
	}
	if filter.Cursor != nil {
		args = append(args, filter.Cursor.OccurredAt, filter.Cursor.ID)
		conditions += fmt.Sprintf(" and (movement.occurred_at, movement.id) < ($%d::timestamptz, $%d::uuid)", len(args)-1, len(args))
	}
	rows, err := repo.db.Pool().Query(ctx, `
		select movement.id::text,
		       movement.property_key_id::text,
		       property_key.label,
		       movement.movement_type,
		       nullif(btrim(actor.name), ''),
		       coalesce(nullif(btrim(movement.holder_name), ''), nullif(btrim(holder.name), '')),
		       nullif(btrim(movement.metadata ->> 'reason'), ''),
		       movement.notes,
		       movement.from_location,
		       movement.to_location,
		       movement.occurred_at,
		       movement.expected_return_at
		from public.property_key_movements movement
		join public.property_keys property_key
		  on property_key.organization_id = movement.organization_id
		 and property_key.id = movement.property_key_id
		left join public.users actor on actor.id = movement.created_by
		left join public.users holder on holder.id = movement.holder_user_id
		where movement.organization_id = $1::uuid
		  and property_key.property_id = $2::uuid`+conditions+`
		order by movement.occurred_at desc, movement.id desc
		limit $3
	`, args...)
	if err != nil {
		return PropertyKeyMovementPage{}, err
	}
	defer rows.Close()

	var cursors []keyMovementCursor
	for rows.Next() {
		var record PropertyKeyMovementRecord
		var occurredAt time.Time
		var expectedReturn *time.Time
		if err := rows.Scan(
			&record.ID, &record.PropertyKeyID, &record.KeyName, &record.MovementType,
			&record.ActorName, &record.HolderName, &record.Reason, &record.Notes,
			&record.FromLocation, &record.ToLocation, &occurredAt, &expectedReturn,
		); err != nil {
			return PropertyKeyMovementPage{}, err
		}
		record.OccurredAt = occurredAt.UTC().Format(time.RFC3339Nano)
		if expectedReturn != nil {
			formatted := expectedReturn.UTC().Format(time.RFC3339Nano)
			record.ExpectedReturnAt = &formatted
		}
		page.Data = append(page.Data, record)
		cursors = append(cursors, keyMovementCursor{OccurredAt: occurredAt, ID: record.ID})
	}
	if err := rows.Err(); err != nil {
		return PropertyKeyMovementPage{}, err
	}
	if len(page.Data) > filter.Limit {
		page.Data = page.Data[:filter.Limit]
		next := encodeKeyMovementCursor(cursors[filter.Limit-1])
		page.NextCursor = &next
	}
	return page, nil
}

func (handler Handler) ListKeyMovements(w http.ResponseWriter, r *http.Request) {
	setPropertyWorkspacePrivateHeaders(w)
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}
	filter, err := parsePropertyKeyMovementFilter(r.URL.Query())
	if err != nil {
		writePropertyError(w, r, err)
		return
	}
	page, err := handler.repo.ListPropertyKeyMovements(r.Context(), tenantContext, r.PathValue("id"), filter)
	if err != nil {
		writePropertyError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, page)
}
