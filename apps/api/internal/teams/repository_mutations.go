package teams

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/managementintent"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func (repo Repository) Create(ctx context.Context, tenantContext tenant.Context, request CreateTeamRequest) (Team, error) {
	if !tenantContext.HasPermission(permissions.TeamManage) {
		return Team{}, tenant.ErrOrganizationAccessDenied
	}
	if invalidTeamMemberFormats(request.membersProvided, request.memberIDsProvided, request.Members, request.MemberIDs) {
		return Team{}, ErrInvalidInput
	}
	name, err := normalizeTeamName(request.Name)
	if err != nil || !validTeamLogoURL(request.LogoURL) {
		return Team{}, ErrInvalidInput
	}
	isActive := true
	if request.IsActive != nil {
		isActive = *request.IsActive
	}
	members, err := normalizeMembersStrict(normalizeMemberInputs(request))
	if err != nil {
		return Team{}, err
	}
	if err := validateMemberAvailabilityWeeks(members, true); err != nil {
		return Team{}, err
	}
	if !managementintent.ValidKey(request.IdempotencyKey) {
		return Team{}, managementintent.ErrInvalidKey
	}
	canonicalRequest, err := json.Marshal(struct {
		Name     string
		Members  []TeamMemberInput
		LogoURL  any
		IsActive bool
	}{name, members, textOrNil(request.LogoURL), isActive})
	if err != nil {
		return Team{}, err
	}

	tx, err := repo.beginTeamMutation(ctx)
	if err != nil {
		return Team{}, err
	}
	defer tx.Rollback(ctx)
	if err := setAuditActor(ctx, tx, tenantContext); err != nil {
		return Team{}, err
	}
	reservation, err := managementintent.Lookup(ctx, tx, tenantContext.OrganizationID, tenantContext.UserID, "team", request.IdempotencyKey, canonicalRequest)
	if err != nil {
		return Team{}, err
	}
	if reservation.EntityID != "" {
		if !canRecoverTeamCreation(tenantContext, reservation.EntityID) {
			return Team{}, tenant.ErrOrganizationAccessDenied
		}
		team, err := repo.getWithQueryer(ctx, tx, tenantContext, reservation.EntityID)
		if errors.Is(err, ErrTeamNotFound) {
			return Team{}, managementintent.ErrResultUnavailable
		}
		if err != nil {
			return Team{}, err
		}
		if err := tx.Commit(ctx); err != nil {
			return Team{}, err
		}
		return team, nil
	}
	// A committed request may itself have made the creator a team leader.
	// Recovery above is scoped to that result; a new key still needs the
	// organization-wide creation authority, exactly as before.
	if !canManageTeams(tenantContext) {
		return Team{}, tenant.ErrOrganizationAccessDenied
	}

	var teamID string
	err = tx.QueryRow(ctx, `
		insert into public.teams (organization_id, name, logo_url, is_active, created_by)
		values ($1::uuid, $2, $3, $4, $5::uuid)
		returning id::text
	`, tenantContext.OrganizationID, name, textOrNil(request.LogoURL), isActive, tenantContext.UserID).Scan(&teamID)
	if err != nil {
		return Team{}, err
	}

	if len(members) > 0 {
		if err := lockTeamRosterDependencies(ctx, tx, tenantContext.OrganizationID, teamID, memberUserIDs(members)); err != nil {
			return Team{}, err
		}
	}
	if _, err := replaceMembers(ctx, tx, tenantContext.OrganizationID, teamID, members); err != nil {
		return Team{}, err
	}
	if _, err := repo.replaceMemberAvailabilityWeeks(ctx, tx, tenantContext.OrganizationID, teamID, members); err != nil {
		return Team{}, err
	}
	team, err := repo.getWithQueryer(ctx, tx, tenantContext, teamID)
	if err != nil {
		return Team{}, err
	}
	if err := managementintent.Record(ctx, tx, reservation, teamID); err != nil {
		return Team{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Team{}, err
	}

	return team, nil
}

func (repo Repository) Update(ctx context.Context, tenantContext tenant.Context, teamID string, request UpdateTeamRequest) (Team, error) {
	return repo.update(ctx, tenantContext, teamID, request, true)
}

func (repo Repository) update(ctx context.Context, tenantContext tenant.Context, teamID string, request UpdateTeamRequest, requireRevision bool) (Team, error) {
	teamID, ok := normalizeUUID(teamID)
	if !ok {
		return Team{}, ErrInvalidInput
	}
	if invalidTeamMemberFormats(request.membersProvided, request.memberIDsProvided, request.Members, request.MemberIDs) {
		return Team{}, ErrInvalidInput
	}
	if !hasTeamUpdate(request) {
		return Team{}, ErrInvalidInput
	}
	if requireRevision && (request.ExpectedRevision == nil || *request.ExpectedRevision < 1 || *request.ExpectedRevision > maxTeamRevision) {
		return Team{}, ErrInvalidInput
	}
	isAdminScope := canManageTeams(tenantContext)
	if !isAdminScope {
		if !tenantContext.LeadsTeam(teamID) || !hasMemberUpdate(request) {
			return Team{}, tenant.ErrOrganizationAccessDenied
		}
		if request.Name != nil || request.LogoURL != nil || request.IsActive != nil {
			return Team{}, tenant.ErrOrganizationAccessDenied
		}
		request.PreserveLeadership = true
	}
	if request.Name != nil {
		if _, err := normalizeTeamName(*request.Name); err != nil {
			return Team{}, err
		}
	}
	if !validTeamLogoURL(request.LogoURL) {
		return Team{}, ErrInvalidInput
	}
	var normalizedMemberInputs []TeamMemberInput
	if hasMemberUpdate(request) {
		var err error
		normalizedMemberInputs, err = normalizeMembersStrict(normalizeMemberInputsFromUpdate(request))
		if err != nil {
			return Team{}, err
		}
	}

	tx, err := repo.beginTeamMutation(ctx)
	if err != nil {
		return Team{}, err
	}
	defer tx.Rollback(ctx)
	if err := setAuditActor(ctx, tx, tenantContext); err != nil {
		return Team{}, err
	}
	if hasMemberUpdate(request) {
		if err := lockTeamQueueDomain(ctx, tx, tenantContext.OrganizationID); err != nil {
			return Team{}, err
		}
	}
	currentRevision, err := lockTeamRevision(ctx, tx, tenantContext.OrganizationID, teamID)
	if err != nil {
		return Team{}, err
	}
	if requireRevision && currentRevision != *request.ExpectedRevision {
		return Team{}, ErrTeamRevisionConflict
	}
	if hasMemberUpdate(request) {
		if err := lockTeamQueueParents(ctx, tx, tenantContext.OrganizationID, teamID); err != nil {
			return Team{}, err
		}
	}
	if requireRevision && hasMemberUpdate(request) {
		if err := verifyExpectedTeamMembers(ctx, tx, tenantContext.OrganizationID, teamID, request.ExpectedMemberIDs, memberUserIDs(normalizedMemberInputs)); err != nil {
			return Team{}, err
		}
	}

	args := []any{tenantContext.OrganizationID, teamID}
	changed := false
	assignments := []string{}
	changePredicates := []string{}
	if request.Name != nil {
		name, _ := normalizeTeamName(*request.Name)
		args = append(args, name)
		assignments = append(assignments, fmt.Sprintf("name = $%d", len(args)))
		changePredicates = append(changePredicates, fmt.Sprintf("name is distinct from $%d", len(args)))
	}
	if request.LogoURL != nil {
		args = append(args, textOrNil(request.LogoURL))
		assignments = append(assignments, fmt.Sprintf("logo_url = $%d", len(args)))
		changePredicates = append(changePredicates, fmt.Sprintf("logo_url is distinct from $%d", len(args)))
	}
	if request.IsActive != nil {
		args = append(args, *request.IsActive)
		assignments = append(assignments, fmt.Sprintf("is_active = $%d", len(args)))
		changePredicates = append(changePredicates, fmt.Sprintf("is_active is distinct from $%d", len(args)))
	}
	if len(assignments) > 0 {
		assignments = append(assignments, "updated_at = now()")
		tag, err := tx.Exec(ctx, `
			update public.teams
			set `+strings.Join(assignments, ", ")+`
			where organization_id = $1::uuid
			  and id = $2::uuid
			  and (`+strings.Join(changePredicates, " or ")+`)
		`, args...)
		if err != nil {
			return Team{}, err
		}
		changed = tag.RowsAffected() > 0
	}

	if hasMemberUpdate(request) {
		memberInputs := normalizedMemberInputs
		if err := validateMemberAvailabilityWeeks(memberInputs, false); err != nil {
			return Team{}, err
		}
		currentMemberIDs, err := repo.currentMemberIDSet(ctx, tx, tenantContext.OrganizationID, teamID)
		if err != nil {
			return Team{}, err
		}
		if err := validateNewMemberAvailabilityWeeks(memberInputs, currentMemberIDs); err != nil {
			return Team{}, err
		}
		if request.PreserveLeadership {
			current, err := repo.currentLeaderMap(ctx, tx, teamID)
			if err != nil {
				return Team{}, err
			}
			if !isAdminScope && !preservesCurrentLeaders(current, memberInputs) {
				return Team{}, tenant.ErrOrganizationAccessDenied
			}
			for index := range memberInputs {
				memberInputs[index].IsLeader = current[memberInputs[index].UserID]
			}
		}
		membersChanged, err := replaceMembers(ctx, tx, tenantContext.OrganizationID, teamID, memberInputs)
		if err != nil {
			return Team{}, err
		}
		changed = changed || membersChanged
		availabilityChanged, err := repo.replaceMemberAvailabilityWeeks(ctx, tx, tenantContext.OrganizationID, teamID, memberInputs)
		if err != nil {
			return Team{}, err
		}
		changed = changed || availabilityChanged
		keepMemberIDs, err := currentTeamQueueKeepIDs(ctx, tx, tenantContext.OrganizationID, teamID)
		if err != nil {
			return Team{}, err
		}
		if err := syncRoundRobinWithTeamPreserving(
			ctx,
			tx,
			tenantContext.OrganizationID,
			teamID,
			memberUserIDs(memberInputs),
			keepMemberIDs,
		); err != nil {
			return Team{}, err
		}
	}
	if changed {
		if err := bumpTeamRevision(ctx, tx, tenantContext.OrganizationID, teamID); err != nil {
			return Team{}, err
		}
	}

	team, err := repo.getWithQueryer(ctx, tx, tenantContext, teamID)
	if err != nil {
		return Team{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Team{}, err
	}
	return team, nil
}

func (repo Repository) UpdateStatus(ctx context.Context, tenantContext tenant.Context, teamID string, isActive bool) (Team, error) {
	return repo.update(ctx, tenantContext, teamID, UpdateTeamRequest{IsActive: &isActive}, false)
}

func (repo Repository) Delete(ctx context.Context, tenantContext tenant.Context, teamID string) error {
	if !canManageTeams(tenantContext) {
		return tenant.ErrOrganizationAccessDenied
	}
	teamID, ok := normalizeUUID(teamID)
	if !ok {
		return ErrInvalidInput
	}

	tx, err := repo.beginTeamMutation(ctx)
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

	var teamInUse bool
	if err := tx.QueryRow(ctx, `
		select exists (
			select 1
			from public.round_robin_members member
			join public.round_robins queue
			  on queue.id = member.round_robin_id
			 and queue.organization_id = $1::uuid
			where member.team_id = $2::uuid
		)
	`, tenantContext.OrganizationID, teamID).Scan(&teamInUse); err != nil {
		return err
	}
	if teamInUse {
		return ErrTeamInUse
	}

	tag, err := tx.Exec(ctx, `
		delete from public.teams
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, tenantContext.OrganizationID, teamID)
	if err != nil {
		if isTeamInUseForeignKeyViolation(err) {
			return ErrTeamInUse
		}
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrTeamNotFound
	}
	return tx.Commit(ctx)
}

func isTeamInUseForeignKeyViolation(err error) bool {
	var databaseError *pgconn.PgError
	return errors.As(err, &databaseError) &&
		databaseError.Code == "23503" &&
		databaseError.ConstraintName == "round_robin_members_team_id_fkey"
}

func normalizeTeamName(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" || utf8.RuneCountInString(value) > maxTeamNameLength {
		return "", ErrInvalidInput
	}
	return value, nil
}

func validTeamLogoURL(value *string) bool {
	if value == nil {
		return true
	}
	return utf8.RuneCountInString(strings.TrimSpace(*value)) <= maxTeamLogoURLLength
}
