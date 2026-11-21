package teams

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func (repo Repository) ListAvailability(ctx context.Context, tenantContext tenant.Context, teamMemberIDs []string) ([]MemberAvailability, error) {
	if !canReadTeamAvailability(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	return listAvailabilityWithQueryer(ctx, repo.db.Pool(), tenantContext, teamMemberIDs)
}

func listAvailabilityWithQueryer(ctx context.Context, q teamReadExecutor, tenantContext tenant.Context, teamMemberIDs []string) ([]MemberAvailability, error) {
	if !canReadTeamAvailability(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	ids, err := normalizeUUIDList(teamMemberIDs)
	if err != nil {
		return nil, err
	}

	args := []any{tenantContext.OrganizationID}
	where := []string{"t.organization_id = $1::uuid"}
	if len(ids) > 0 {
		placeholders := []string{}
		for _, id := range ids {
			args = append(args, id)
			placeholders = append(placeholders, fmt.Sprintf("$%d::uuid", len(args)))
		}
		where = append(where, "ma.team_member_id in ("+strings.Join(placeholders, ", ")+")")
	}
	if !canViewAllTeams(tenantContext) {
		if !tenantContext.IsTeamLeader || len(tenantContext.LedTeamIDs) == 0 {
			return []MemberAvailability{}, nil
		}
		placeholders := []string{}
		for _, ledTeamID := range tenantContext.LedTeamIDs {
			args = append(args, ledTeamID)
			placeholders = append(placeholders, fmt.Sprintf("$%d::uuid", len(args)))
		}
		where = append(where, "tm.team_id in ("+strings.Join(placeholders, ", ")+")")
	}

	rows, err := q.Query(ctx, `
		select
			ma.id::text,
			ma.team_member_id::text,
			ma.day_of_week,
			ma.start_time::text,
			ma.end_time::text,
			coalesce(ma.is_all_day, false),
			coalesce(ma.is_active, true),
			ma.created_at::text,
			ma.updated_at::text
		from public.member_availability ma
		join public.team_members tm on tm.id = ma.team_member_id
		join public.teams t on t.id = tm.team_id
		join public.organization_members om
		  on om.organization_id = tm.organization_id
		 and om.user_id = tm.user_id
		 and om.is_active = true
		 and om.deleted_at is null
		 and om.membership_generation = tm.membership_generation
		where `+strings.Join(where, " and ")+`
		  and coalesce(tm.is_active, true) = true
		order by ma.team_member_id asc, ma.day_of_week asc
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []MemberAvailability{}
	for rows.Next() {
		item, err := scanMemberAvailability(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return items, nil
}

func (repo Repository) UpsertAvailability(ctx context.Context, tenantContext tenant.Context, request AvailabilityRequest) (AvailabilityMutationResponse, error) {
	if !validExpectedTeamRevision(request.ExpectedRevision) {
		return AvailabilityMutationResponse{}, ErrInvalidInput
	}
	input, err := normalizeAvailabilityRequest(request)
	if err != nil {
		return AvailabilityMutationResponse{}, err
	}
	tx, err := repo.beginTeamMutation(ctx)
	if err != nil {
		return AvailabilityMutationResponse{}, err
	}
	defer tx.Rollback(ctx)
	if err := setAuditActor(ctx, tx, tenantContext); err != nil {
		return AvailabilityMutationResponse{}, err
	}
	teamID, err := teamIDForMember(ctx, tx, tenantContext.OrganizationID, input.TeamMemberID)
	if err != nil {
		return AvailabilityMutationResponse{}, err
	}
	currentRevision, err := lockTeamRevision(ctx, tx, tenantContext.OrganizationID, teamID)
	if err != nil {
		if errors.Is(err, ErrTeamNotFound) {
			return AvailabilityMutationResponse{}, ErrTeamMemberNotFound
		}
		return AvailabilityMutationResponse{}, err
	}
	if currentRevision != *request.ExpectedRevision {
		return AvailabilityMutationResponse{}, ErrTeamRevisionConflict
	}
	if err := repo.ensureCanManageAvailability(ctx, tx, tenantContext, input.TeamMemberID); err != nil {
		return AvailabilityMutationResponse{}, err
	}
	if err := lockTeamMemberAvailability(ctx, tx, tenantContext.OrganizationID, input.TeamMemberID); err != nil {
		return AvailabilityMutationResponse{}, err
	}
	item, changed, err := repo.upsertAvailability(ctx, tx, tenantContext.OrganizationID, input)
	if err != nil {
		return AvailabilityMutationResponse{}, err
	}
	if !input.IsActive {
		var hasActiveDay bool
		if err := tx.QueryRow(ctx, `
			select exists (
				select 1
				from public.member_availability
				where organization_id = $1::uuid
				  and team_member_id = $2::uuid
				  and coalesce(is_active, true) = true
			)
		`, tenantContext.OrganizationID, input.TeamMemberID).Scan(&hasActiveDay); err != nil {
			return AvailabilityMutationResponse{}, err
		}
		if !hasActiveDay {
			return AvailabilityMutationResponse{}, ErrInvalidInput
		}
	}
	if changed {
		if err := bumpTeamRevision(ctx, tx, tenantContext.OrganizationID, teamID); err != nil {
			return AvailabilityMutationResponse{}, err
		}
	}
	if changed {
		currentRevision++
	}
	if err := tx.Commit(ctx); err != nil {
		return AvailabilityMutationResponse{}, err
	}
	return AvailabilityMutationResponse{Data: item, Revision: currentRevision}, nil
}

func (repo Repository) ReplaceAvailability(ctx context.Context, tenantContext tenant.Context, teamMemberID string, requests []AvailabilityRequest, expectedRevision *int64) (AvailabilitySnapshot, error) {
	if !validExpectedTeamRevision(expectedRevision) {
		return AvailabilitySnapshot{}, ErrInvalidInput
	}
	teamMemberID, ok := normalizeUUID(teamMemberID)
	if !ok {
		return AvailabilitySnapshot{}, ErrInvalidInput
	}
	normalized, err := normalizeCompleteAvailabilityWeek(teamMemberID, requests)
	if err != nil {
		return AvailabilitySnapshot{}, err
	}

	tx, err := repo.beginTeamMutation(ctx)
	if err != nil {
		return AvailabilitySnapshot{}, err
	}
	defer tx.Rollback(ctx)
	if err := setAuditActor(ctx, tx, tenantContext); err != nil {
		return AvailabilitySnapshot{}, err
	}
	teamID, err := teamIDForMember(ctx, tx, tenantContext.OrganizationID, teamMemberID)
	if err != nil {
		return AvailabilitySnapshot{}, err
	}
	currentRevision, err := lockTeamRevision(ctx, tx, tenantContext.OrganizationID, teamID)
	if err != nil {
		if errors.Is(err, ErrTeamNotFound) {
			return AvailabilitySnapshot{}, ErrTeamMemberNotFound
		}
		return AvailabilitySnapshot{}, err
	}
	if currentRevision != *expectedRevision {
		return AvailabilitySnapshot{}, ErrTeamRevisionConflict
	}

	if err := ensureTeamMemberBelongsToOrganization(ctx, tx, tenantContext.OrganizationID, teamMemberID); err != nil {
		return AvailabilitySnapshot{}, err
	}
	if err := repo.ensureCanManageAvailability(ctx, tx, tenantContext, teamMemberID); err != nil {
		return AvailabilitySnapshot{}, err
	}
	if err := lockTeamMemberAvailability(ctx, tx, tenantContext.OrganizationID, teamMemberID); err != nil {
		return AvailabilitySnapshot{}, err
	}

	changed := false
	for _, input := range normalized {
		_, dayChanged, err := repo.upsertAvailability(ctx, tx, tenantContext.OrganizationID, input)
		if err != nil {
			return AvailabilitySnapshot{}, err
		}
		changed = changed || dayChanged
	}
	if changed {
		if err := bumpTeamRevision(ctx, tx, tenantContext.OrganizationID, teamID); err != nil {
			return AvailabilitySnapshot{}, err
		}
		currentRevision++
	}

	items, err := listAvailabilityWithQueryer(ctx, tx, tenantContext, []string{teamMemberID})
	if err != nil {
		return AvailabilitySnapshot{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return AvailabilitySnapshot{}, err
	}

	return AvailabilitySnapshot{Data: items, Revision: currentRevision}, nil
}

func scanMemberAvailability(row teamScanner) (MemberAvailability, error) {
	var item MemberAvailability
	var startTime, endTime pgtype.Text
	if err := row.Scan(
		&item.ID,
		&item.TeamMemberID,
		&item.DayOfWeek,
		&startTime,
		&endTime,
		&item.IsAllDay,
		&item.IsActive,
		&item.CreatedAt,
		&item.UpdatedAt,
	); err != nil {
		return MemberAvailability{}, err
	}
	item.StartTime = textPointer(startTime)
	item.EndTime = textPointer(endTime)
	return item, nil
}

type availabilityInput struct {
	TeamMemberID string  `json:"team_member_id"`
	DayOfWeek    int     `json:"day_of_week"`
	StartTime    *string `json:"start_time"`
	EndTime      *string `json:"end_time"`
	IsAllDay     bool    `json:"is_all_day"`
	IsActive     bool    `json:"is_active"`
}

func normalizeAvailabilityRequest(request AvailabilityRequest) (availabilityInput, error) {
	teamMemberID, ok := normalizeUUID(request.TeamMemberID)
	if !ok || request.DayOfWeek < 0 || request.DayOfWeek > 6 {
		return availabilityInput{}, ErrInvalidInput
	}
	isAllDay := false
	if request.IsAllDay != nil {
		isAllDay = *request.IsAllDay
	}
	isActive := true
	if request.IsActive != nil {
		isActive = *request.IsActive
	}
	startTime := cleanTimePointer(request.StartTime)
	endTime := cleanTimePointer(request.EndTime)
	if isAllDay {
		startTime = nil
		endTime = nil
	}
	for _, clock := range []*string{startTime, endTime} {
		if clock != nil {
			if _, ok := parseAvailabilityClock(clock); !ok {
				return availabilityInput{}, ErrInvalidInput
			}
		}
	}
	if isActive && !isAllDay {
		start, startOK := parseAvailabilityClock(startTime)
		end, endOK := parseAvailabilityClock(endTime)
		if !startOK || !endOK || start.Equal(end) {
			return availabilityInput{}, ErrInvalidInput
		}
	}
	return availabilityInput{
		TeamMemberID: teamMemberID,
		DayOfWeek:    request.DayOfWeek,
		StartTime:    startTime,
		EndTime:      endTime,
		IsAllDay:     isAllDay,
		IsActive:     isActive,
	}, nil
}

func normalizeCompleteAvailabilityWeek(teamMemberID string, requests []AvailabilityRequest) ([]availabilityInput, error) {
	teamMemberID, ok := normalizeUUID(teamMemberID)
	if !ok || len(requests) != 7 {
		return nil, ErrInvalidInput
	}

	normalized := make([]availabilityInput, 0, 7)
	seenDays := make(map[int]struct{}, 7)
	hasActiveDay := false
	for _, request := range requests {
		request.TeamMemberID = teamMemberID
		input, err := normalizeAvailabilityRequest(request)
		if err != nil {
			return nil, err
		}
		if _, exists := seenDays[input.DayOfWeek]; exists {
			return nil, ErrInvalidInput
		}
		seenDays[input.DayOfWeek] = struct{}{}

		if input.IsActive && !input.IsAllDay {
			start, startOK := parseAvailabilityClock(input.StartTime)
			end, endOK := parseAvailabilityClock(input.EndTime)
			// start.Equal(end) is a zero-length window and always invalid.
			// start after end is allowed: it represents a shift that rolls
			// over past midnight into the next day (e.g. 22:00 to 06:00),
			// which the distribution-availability SQL already interprets
			// correctly (see internal/distribution/availability.go).
			if !startOK || !endOK || start.Equal(end) {
				return nil, ErrInvalidInput
			}
		}
		hasActiveDay = hasActiveDay || input.IsActive
		normalized = append(normalized, input)
	}
	for day := 0; day < 7; day++ {
		if _, exists := seenDays[day]; !exists {
			return nil, ErrInvalidInput
		}
	}
	if !hasActiveDay {
		return nil, ErrInvalidInput
	}
	return normalized, nil
}

var availabilityClockPattern = regexp.MustCompile(`^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$`)

func parseAvailabilityClock(value *string) (time.Time, bool) {
	if value == nil {
		return time.Time{}, false
	}
	cleaned := strings.TrimSpace(*value)
	if !availabilityClockPattern.MatchString(cleaned) {
		return time.Time{}, false
	}
	for _, layout := range []string{"15:04", "15:04:05"} {
		parsed, err := time.Parse(layout, cleaned)
		if err == nil {
			return parsed, true
		}
	}
	return time.Time{}, false
}

func normalizeUUIDList(values []string) ([]string, error) {
	out := []string{}
	seen := map[string]struct{}{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		normalized, ok := normalizeUUID(value)
		if !ok {
			return nil, ErrInvalidInput
		}
		if _, exists := seen[normalized]; exists {
			continue
		}
		seen[normalized] = struct{}{}
		out = append(out, normalized)
	}
	return out, nil
}
