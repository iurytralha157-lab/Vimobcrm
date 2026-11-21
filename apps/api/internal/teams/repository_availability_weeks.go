package teams

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
)

func validateMemberAvailabilityWeeks(members []TeamMemberInput, required bool) error {
	for _, member := range members {
		if member.Availability == nil {
			if required {
				return ErrInvalidInput
			}
			continue
		}
		if _, err := normalizeCompleteAvailabilityWeek(member.UserID, member.Availability); err != nil {
			return err
		}
	}
	return nil
}

func validateNewMemberAvailabilityWeeks(members []TeamMemberInput, currentMemberIDs map[string]struct{}) error {
	for _, member := range members {
		if member.Availability != nil {
			continue
		}
		if _, exists := currentMemberIDs[member.UserID]; !exists {
			return ErrInvalidInput
		}
	}
	return nil
}

func (repo Repository) replaceMemberAvailabilityWeeks(
	ctx context.Context,
	tx pgx.Tx,
	organizationID string,
	teamID string,
	members []TeamMemberInput,
) (bool, error) {
	userIDs := make([]string, 0, len(members))
	for _, member := range members {
		if member.Availability != nil {
			userIDs = append(userIDs, member.UserID)
		}
	}
	if len(userIDs) == 0 {
		return false, nil
	}

	args := []any{organizationID, teamID}
	placeholders := make([]string, 0, len(userIDs))
	for _, userID := range userIDs {
		args = append(args, userID)
		placeholders = append(placeholders, fmt.Sprintf("$%d::uuid", len(args)))
	}
	rows, err := tx.Query(ctx, `
		select tm.id::text, tm.user_id::text
		from public.team_members tm
		join public.organization_members om
		  on om.organization_id = tm.organization_id
		 and om.user_id = tm.user_id
		 and om.is_active = true
		 and om.deleted_at is null
		 and om.membership_generation = tm.membership_generation
		where tm.organization_id = $1::uuid
		  and tm.team_id = $2::uuid
		  and tm.user_id in (`+strings.Join(placeholders, ", ")+`)
		  and coalesce(tm.is_active, true) = true
	`, args...)
	if err != nil {
		return false, err
	}
	memberIDByUserID := make(map[string]string, len(userIDs))
	for rows.Next() {
		var memberID, userID string
		if err := rows.Scan(&memberID, &userID); err != nil {
			rows.Close()
			return false, err
		}
		memberIDByUserID[userID] = memberID
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return false, err
	}

	inputs, err := normalizeMemberAvailabilityInputs(members, memberIDByUserID)
	if err != nil {
		return false, err
	}
	payload, err := json.Marshal(inputs)
	if err != nil {
		return false, err
	}

	tag, err := tx.Exec(ctx, `
		insert into public.member_availability as current_availability (
			organization_id,
			team_member_id,
			day_of_week,
			start_time,
			end_time,
			is_all_day,
			is_active
		)
		select
			$1::uuid,
			input.team_member_id::uuid,
			input.day_of_week,
			nullif(btrim(input.start_time), '')::time,
			nullif(btrim(input.end_time), '')::time,
			input.is_all_day,
			input.is_active
		from jsonb_to_recordset($2::jsonb) as input (
			team_member_id text,
			day_of_week integer,
			start_time text,
			end_time text,
			is_all_day boolean,
			is_active boolean
		)
		on conflict (team_member_id, day_of_week) do update
		set start_time = excluded.start_time,
		    end_time = excluded.end_time,
		    is_all_day = excluded.is_all_day,
		    is_active = excluded.is_active,
		    updated_at = now()
		where (
			current_availability.start_time,
			current_availability.end_time,
			current_availability.is_all_day,
			current_availability.is_active
		) is distinct from (
			excluded.start_time,
			excluded.end_time,
			excluded.is_all_day,
			excluded.is_active
		)
	`, organizationID, string(payload))
	return tag.RowsAffected() > 0, err
}

func normalizeMemberAvailabilityInputs(
	members []TeamMemberInput,
	memberIDByUserID map[string]string,
) ([]availabilityInput, error) {
	inputs := make([]availabilityInput, 0, len(members)*7)
	for _, member := range members {
		if member.Availability == nil {
			continue
		}
		teamMemberID, ok := memberIDByUserID[member.UserID]
		if !ok {
			return nil, ErrTeamMemberNotFound
		}

		normalized, err := normalizeCompleteAvailabilityWeek(teamMemberID, member.Availability)
		if err != nil {
			return nil, err
		}
		inputs = append(inputs, normalized...)
	}
	return inputs, nil
}

func lockTeamMemberAvailability(
	ctx context.Context,
	tx pgx.Tx,
	organizationID string,
	teamMemberID string,
) error {
	var lockedID string
	err := tx.QueryRow(ctx, `
		select tm.id::text
		from public.team_members tm
		join public.organization_members om
		  on om.organization_id = tm.organization_id
		 and om.user_id = tm.user_id
		 and om.is_active = true
		 and om.deleted_at is null
		 and om.membership_generation = tm.membership_generation
		where tm.organization_id = $1::uuid
		  and tm.id = $2::uuid
		  and coalesce(tm.is_active, true) = true
		for update of tm
	`, organizationID, teamMemberID).Scan(&lockedID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrTeamMemberNotFound
	}
	return err
}

func (repo Repository) upsertAvailability(ctx context.Context, q queryRowExecutor, organizationID string, input availabilityInput) (MemberAvailability, bool, error) {
	item, err := scanMemberAvailability(q.QueryRow(ctx, `
		insert into public.member_availability as current_availability (
			organization_id,
			team_member_id,
			day_of_week,
			start_time,
			end_time,
			is_all_day,
			is_active
		)
		select $1::uuid, $2::uuid, $3, $4::time, $5::time, $6, $7
		where exists (
			select 1
			from public.team_members tm
			join public.teams t on t.id = tm.team_id
			join public.organization_members om
			  on om.organization_id = tm.organization_id
			 and om.user_id = tm.user_id
			 and om.is_active = true
			 and om.deleted_at is null
			 and om.membership_generation = tm.membership_generation
			where t.organization_id = $1::uuid
			  and tm.id = $2::uuid
			  and coalesce(tm.is_active, true) = true
		)
		on conflict (team_member_id, day_of_week) do update
		set start_time = excluded.start_time,
		    end_time = excluded.end_time,
		    is_all_day = excluded.is_all_day,
		    is_active = excluded.is_active,
		    updated_at = now()
		where (
			current_availability.start_time,
			current_availability.end_time,
			current_availability.is_all_day,
			current_availability.is_active
		) is distinct from (
			excluded.start_time,
			excluded.end_time,
			excluded.is_all_day,
			excluded.is_active
		)
		returning
			id::text,
			team_member_id::text,
			day_of_week,
			start_time::text,
			end_time::text,
			coalesce(is_all_day, false),
			coalesce(is_active, true),
			created_at::text,
			updated_at::text
	`, organizationID, input.TeamMemberID, input.DayOfWeek, timeOrNil(input.StartTime), timeOrNil(input.EndTime), input.IsAllDay, input.IsActive))
	changed := err == nil
	if errors.Is(err, pgx.ErrNoRows) {
		item, err = scanMemberAvailability(q.QueryRow(ctx, `
			select
				id::text,
				team_member_id::text,
				day_of_week,
				start_time::text,
				end_time::text,
				coalesce(is_all_day, false),
				coalesce(is_active, true),
				created_at::text,
				updated_at::text
			from public.member_availability
			where organization_id = $1::uuid
			  and team_member_id = $2::uuid
			  and day_of_week = $3
		`, organizationID, input.TeamMemberID, input.DayOfWeek))
		if errors.Is(err, pgx.ErrNoRows) {
			return MemberAvailability{}, false, ErrTeamMemberNotFound
		}
	}
	return item, changed, err
}

func ensureTeamMemberBelongsToOrganization(ctx context.Context, q queryRowExecutor, organizationID string, teamMemberID string) error {
	var ok bool
	if err := q.QueryRow(ctx, `
		select exists (
			select 1
			from public.team_members tm
			join public.teams t on t.id = tm.team_id
			join public.organization_members om
			  on om.organization_id = tm.organization_id
			 and om.user_id = tm.user_id
			 and om.is_active = true
			 and om.deleted_at is null
			 and om.membership_generation = tm.membership_generation
			where t.organization_id = $1::uuid
			  and tm.id = $2::uuid
			  and coalesce(tm.is_active, true) = true
		)
	`, organizationID, teamMemberID).Scan(&ok); err != nil {
		return err
	}
	if !ok {
		return ErrTeamMemberNotFound
	}
	return nil
}

func cleanTimePointer(value *string) *string {
	if value == nil {
		return nil
	}
	cleaned := strings.TrimSpace(*value)
	if cleaned == "" {
		return nil
	}
	return &cleaned
}

func timeOrNil(value *string) any {
	cleaned := cleanTimePointer(value)
	if cleaned == nil {
		return nil
	}
	return *cleaned
}
