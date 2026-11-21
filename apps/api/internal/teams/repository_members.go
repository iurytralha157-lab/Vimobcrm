package teams

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func (repo Repository) SetTeamLeader(ctx context.Context, tenantContext tenant.Context, request SetTeamLeaderRequest) error {
	if !canManageTeams(tenantContext) {
		return tenant.ErrOrganizationAccessDenied
	}
	teamID, ok := normalizeUUID(request.TeamID)
	if !ok {
		return ErrInvalidInput
	}
	userID, ok := normalizeUUID(request.UserID)
	if !ok {
		return ErrInvalidInput
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := setAuditActor(ctx, tx, tenantContext); err != nil {
		return err
	}
	if _, err := lockTeamRevision(ctx, tx, tenantContext.OrganizationID, teamID); err != nil {
		return err
	}
	var currentIsLeader bool
	err = tx.QueryRow(ctx, `
		select coalesce(tm.is_leader, false)
		from public.team_members tm
		join public.organization_members om
		  on om.organization_id = tm.organization_id
		 and om.user_id = tm.user_id
		 and om.is_active = true
		 and om.deleted_at is null
		 and om.membership_generation = tm.membership_generation
		where tm.organization_id = $1::uuid
		  and tm.team_id = $2::uuid
		  and tm.user_id = $3::uuid
		  and coalesce(tm.is_active, true) = true
		for update of tm
	`, tenantContext.OrganizationID, teamID, userID).Scan(&currentIsLeader)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrTeamMemberNotFound
	}
	if err != nil {
		return err
	}
	if currentIsLeader == request.IsLeader {
		return tx.Commit(ctx)
	}

	tag, err := tx.Exec(ctx, `
		update public.team_members tm
		set
			is_leader = $4,
			updated_at = now()
		where tm.organization_id = $1::uuid
		  and tm.team_id = $2::uuid
		  and tm.user_id = $3::uuid
		  and coalesce(tm.is_active, true) = true
		  and exists (
		    select 1
		    from public.organization_members om
		    where om.organization_id = tm.organization_id
		      and om.user_id = tm.user_id
		      and om.is_active = true
		      and om.deleted_at is null
		      and om.membership_generation = tm.membership_generation
		  )
		  and exists (
		    select 1
		    from public.teams t
		    where t.id = tm.team_id
		      and t.organization_id = $1::uuid
		  )
	`, tenantContext.OrganizationID, teamID, userID, request.IsLeader)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrTeamMemberNotFound
	}
	if err := bumpTeamRevision(ctx, tx, tenantContext.OrganizationID, teamID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (repo Repository) currentLeaderMap(ctx context.Context, tx pgx.Tx, teamID string) (map[string]bool, error) {
	rows, err := tx.Query(ctx, `
		select tm.user_id::text, coalesce(tm.is_leader, false)
		from public.team_members tm
		join public.users u on u.id = tm.user_id and coalesce(u.is_active, false) = true
		join public.organization_members om
		  on om.organization_id = tm.organization_id
		 and om.user_id = tm.user_id
		 and om.is_active = true
		 and om.deleted_at is null
		 and om.membership_generation = tm.membership_generation
		where tm.team_id = $1::uuid
		  and coalesce(tm.is_active, true) = true
	`, teamID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := map[string]bool{}
	for rows.Next() {
		var userID string
		var isLeader bool
		if err := rows.Scan(&userID, &isLeader); err != nil {
			return nil, err
		}
		result[userID] = isLeader
	}
	return result, rows.Err()
}

func (repo Repository) currentMemberIDSet(
	ctx context.Context,
	tx pgx.Tx,
	organizationID string,
	teamID string,
) (map[string]struct{}, error) {
	rows, err := tx.Query(ctx, `
		select tm.user_id::text
		from public.team_members tm
		join public.organization_members om
		  on om.organization_id = tm.organization_id
		 and om.user_id = tm.user_id
		 and om.is_active = true
		 and om.deleted_at is null
		 and om.membership_generation = tm.membership_generation
		where tm.organization_id = $1::uuid
		  and tm.team_id = $2::uuid
		  and coalesce(tm.is_active, true) = true
	`, organizationID, teamID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := map[string]struct{}{}
	for rows.Next() {
		var userID string
		if err := rows.Scan(&userID); err != nil {
			return nil, err
		}
		result[userID] = struct{}{}
	}
	return result, rows.Err()
}

func replaceMembers(ctx context.Context, tx pgx.Tx, organizationID string, teamID string, members []TeamMemberInput) (bool, error) {
	var teamExists bool
	if err := tx.QueryRow(ctx, `
		select exists (
			select 1
			from public.teams
			where organization_id = $1::uuid
			  and id = $2::uuid
		)
	`, organizationID, teamID).Scan(&teamExists); err != nil {
		return false, err
	}
	if !teamExists {
		return false, ErrTeamNotFound
	}

	normalized, err := normalizeMembersStrict(members)
	if err != nil {
		return false, err
	}
	ids := memberUserIDs(normalized)
	// The editor replaces only the roster it can see. A member hidden by a
	// temporary suspension keeps the team link and its availability week.
	const visibleMemberPredicate = `
		coalesce(tm.is_active, true) = true
		and exists (
			select 1
			from public.users u
			join public.organization_members om
			  on om.user_id = u.id
			 and om.organization_id = tm.organization_id
			where u.id = tm.user_id
			  and coalesce(u.is_active, false) = true
			  and coalesce(om.is_active, false) = true
			  and om.deleted_at is null
			  and om.membership_generation = tm.membership_generation
		)`

	if len(ids) == 0 {
		tag, err := tx.Exec(ctx, `
			delete from public.team_members tm
			where tm.organization_id = $1::uuid
			  and tm.team_id = $2::uuid
			  and `+visibleMemberPredicate+`
		`, organizationID, teamID)
		return tag.RowsAffected() > 0, err
	}

	if err := ensureUsersBelongToOrganization(ctx, tx, organizationID, ids); err != nil {
		return false, err
	}

	args := []any{organizationID, teamID}
	placeholders := []string{}
	for _, id := range ids {
		args = append(args, id)
		placeholders = append(placeholders, fmt.Sprintf("$%d::uuid", len(args)))
	}
	deleted, err := tx.Exec(ctx, `
		delete from public.team_members tm
		where tm.organization_id = $1::uuid
		  and tm.team_id = $2::uuid
		  and tm.user_id not in (`+strings.Join(placeholders, ", ")+`)
		  and `+visibleMemberPredicate+`
	`, args...)
	if err != nil {
		return false, err
	}

	type memberWriteInput struct {
		UserID   string `json:"user_id"`
		IsLeader bool   `json:"is_leader"`
	}
	payload := make([]memberWriteInput, 0, len(normalized))
	for _, member := range normalized {
		payload = append(payload, memberWriteInput{
			UserID:   member.UserID,
			IsLeader: member.IsLeader,
		})
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		return false, err
	}
	upserted, err := tx.Exec(ctx, `
		insert into public.team_members as current_member (
			organization_id,
			team_id,
			user_id,
			is_leader
		)
		select
			$1::uuid,
			$2::uuid,
			input.user_id::uuid,
			input.is_leader
		from jsonb_to_recordset($3::jsonb) as input (
			user_id text,
			is_leader boolean
		)
		on conflict (team_id, user_id) do update
		set is_leader = excluded.is_leader,
		    is_active = true,
		    membership_generation = excluded.membership_generation,
		    updated_at = now()
		where current_member.organization_id = excluded.organization_id
		  and (
			current_member.is_leader is distinct from excluded.is_leader
			or current_member.is_active is distinct from true
			or current_member.membership_generation is distinct from excluded.membership_generation
		  )
	`, organizationID, teamID, string(encoded))
	return deleted.RowsAffected() > 0 || upserted.RowsAffected() > 0, err
}

func ensureUsersBelongToOrganization(ctx context.Context, tx pgx.Tx, organizationID string, userIDs []string) error {
	args := []any{organizationID}
	placeholders := make([]string, 0, len(userIDs))
	for _, userID := range userIDs {
		args = append(args, userID)
		placeholders = append(placeholders, fmt.Sprintf("$%d::uuid", len(args)))
	}

	var validCount int
	if err := tx.QueryRow(ctx, `
		select count(distinct u.id)
		from public.users u
		join public.organization_members om
		  on om.user_id = u.id
		 and om.organization_id = $1::uuid
		where u.id in (`+strings.Join(placeholders, ", ")+`)
		  and coalesce(u.is_active, false) = true
		  and coalesce(om.is_active, false) = true
		  and om.deleted_at is null
	`, args...).Scan(&validCount); err != nil {
		return err
	}
	if validCount != len(userIDs) {
		return ErrInvalidInput
	}
	return nil
}

func normalizeMemberInputs(request CreateTeamRequest) []TeamMemberInput {
	if len(request.Members) > 0 {
		return request.Members
	}
	out := make([]TeamMemberInput, 0, len(request.MemberIDs))
	for _, id := range request.MemberIDs {
		out = append(out, TeamMemberInput{UserID: id})
	}
	return out
}

func normalizeMemberInputsFromUpdate(request UpdateTeamRequest) []TeamMemberInput {
	if len(request.Members) > 0 {
		return request.Members
	}
	out := make([]TeamMemberInput, 0, len(request.MemberIDs))
	for _, id := range request.MemberIDs {
		out = append(out, TeamMemberInput{UserID: id})
	}
	return out
}

func normalizeMembers(members []TeamMemberInput) []TeamMemberInput {
	out := []TeamMemberInput{}
	seen := map[string]struct{}{}
	for _, member := range members {
		userID, ok := normalizeUUID(member.UserID)
		if !ok {
			continue
		}
		if _, exists := seen[userID]; exists {
			continue
		}
		seen[userID] = struct{}{}
		out = append(out, TeamMemberInput{
			UserID:       userID,
			IsLeader:     member.IsLeader,
			Availability: member.Availability,
		})
	}
	return out
}

func normalizeMembersStrict(members []TeamMemberInput) ([]TeamMemberInput, error) {
	if len(members) > maxTeamMembers {
		return nil, ErrInvalidInput
	}
	for _, member := range members {
		if _, ok := normalizeUUID(strings.TrimSpace(member.UserID)); !ok {
			return nil, ErrInvalidInput
		}
	}
	return normalizeMembers(members), nil
}

func memberUserIDs(members []TeamMemberInput) []string {
	out := make([]string, 0, len(members))
	for _, member := range members {
		out = append(out, member.UserID)
	}
	return out
}

func preservesCurrentLeaders(current map[string]bool, members []TeamMemberInput) bool {
	selected := map[string]struct{}{}
	for _, member := range members {
		if userID, ok := normalizeUUID(member.UserID); ok {
			selected[userID] = struct{}{}
		}
	}
	for userID, isLeader := range current {
		if !isLeader {
			continue
		}
		if _, ok := selected[userID]; !ok {
			return false
		}
	}
	return true
}

func hasMemberUpdate(request UpdateTeamRequest) bool {
	return request.Members != nil || request.MemberIDs != nil
}

func hasTeamUpdate(request UpdateTeamRequest) bool {
	return request.Name != nil || request.LogoURL != nil || request.IsActive != nil || hasMemberUpdate(request)
}
