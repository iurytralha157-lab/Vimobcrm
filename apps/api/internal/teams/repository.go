package teams

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/distribution"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/managementintent"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/pgvalue"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

type Repository struct {
	db              *dbpkg.Postgres
	storage         storageClient
	beginMutationTx func(context.Context) (pgx.Tx, error)
}

const (
	maxTeamNameLength    = 120
	maxTeamLogoURLLength = 2000
	maxTeamMembers       = 500
	maxTeamRevision      = 9007199254740991
)

type teamScanner interface {
	Scan(dest ...any) error
}

type queryRowExecutor interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

type teamReadExecutor interface {
	queryRowExecutor
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

func setAuditActor(ctx context.Context, tx pgx.Tx, tenantContext tenant.Context) error {
	userID := strings.TrimSpace(tenantContext.UserID)
	if userID == "" {
		return nil
	}
	_, err := tx.Exec(ctx, `select set_config('app.current_user_id', $1, true)`, userID)
	return err
}

func NewRepository(db *dbpkg.Postgres, storageConfig StorageConfig) Repository {
	return Repository{
		db:      db,
		storage: newStorageClient(storageConfig),
	}
}

func (repo Repository) beginTeamMutation(ctx context.Context) (pgx.Tx, error) {
	if repo.beginMutationTx != nil {
		return repo.beginMutationTx(ctx)
	}
	return repo.db.Pool().Begin(ctx)
}

// Lock the aggregate before locking or changing team_members and availability.
// NO KEY UPDATE still serializes team writers, while letting queue inserts take
// their FK key-share lock on this team as they hold round_robins.
func lockTeamRevision(ctx context.Context, tx pgx.Tx, organizationID, teamID string) (int64, error) {
	var revision int64
	err := tx.QueryRow(ctx, `
		select revision
		from public.teams
		where organization_id = $1::uuid
		  and id = $2::uuid
		for no key update
	`, organizationID, teamID).Scan(&revision)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, ErrTeamNotFound
	}
	return revision, err
}

func bumpTeamRevision(ctx context.Context, tx pgx.Tx, organizationID, teamID string) error {
	tag, err := tx.Exec(ctx, `
		update public.teams
		set revision = revision + 1,
		    updated_at = clock_timestamp()
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, organizationID, teamID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrTeamNotFound
	}
	return nil
}

func teamIDForMember(ctx context.Context, q queryRowExecutor, organizationID, teamMemberID string) (string, error) {
	var teamID string
	err := q.QueryRow(ctx, `
		select team_id::text
		from public.team_members
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, organizationID, teamMemberID).Scan(&teamID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrTeamMemberNotFound
	}
	return teamID, err
}

// A removal and later reinvitation can hide an old team_member without
// changing teams.revision. Lock every row that can change the visible roster,
// including temporarily inactive users and memberships, before comparing it.
func verifyExpectedTeamMembers(ctx context.Context, tx pgx.Tx, organizationID, teamID string, expected, requestedUserIDs []string) error {
	if expected == nil || len(expected) > maxTeamMembers {
		return ErrInvalidInput
	}
	ids, err := normalizeUUIDList(expected)
	if err != nil || len(ids) != len(expected) {
		return ErrInvalidInput
	}
	sort.Strings(ids)
	if err := lockTeamRosterDependencies(ctx, tx, organizationID, teamID, requestedUserIDs); err != nil {
		return err
	}
	rows, err := tx.Query(ctx, `
		select tm.id::text
		from public.team_members tm
		join public.users u on u.id = tm.user_id
		join public.organization_members om
		  on om.organization_id = tm.organization_id
		 and om.user_id = tm.user_id
		 and coalesce(om.is_active, false) = true
		 and om.deleted_at is null
		 and om.membership_generation = tm.membership_generation
		where tm.organization_id = $1::uuid
		  and tm.team_id = $2::uuid
		  and coalesce(tm.is_active, true) = true
		  and coalesce(u.is_active, false) = true
		order by tm.id
	`, organizationID, teamID)
	if err != nil {
		return err
	}
	defer rows.Close()
	index := 0
	for rows.Next() {
		var memberID string
		if err := rows.Scan(&memberID); err != nil {
			return err
		}
		if index >= len(ids) || memberID != ids[index] {
			return ErrTeamRevisionConflict
		}
		index++
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if index != len(ids) {
		return ErrTeamRevisionConflict
	}
	return nil
}

func collectTeamUUIDs(rows pgx.Rows) ([]string, error) {
	defer rows.Close()
	ids := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return ids, nil
}

func lockTeamRosterDependencies(ctx context.Context, tx pgx.Tx, organizationID, teamID string, requestedUserIDs []string) error {
	rows, err := tx.Query(ctx, `
		select distinct tm.user_id::text
		from public.team_members tm
		where tm.organization_id = $1::uuid
		  and tm.team_id = $2::uuid
	`, organizationID, teamID)
	if err != nil {
		return err
	}
	currentUserIDs, err := collectTeamUUIDs(rows)
	if err != nil {
		return err
	}
	targetIDs := make(map[string]struct{}, len(currentUserIDs)+len(requestedUserIDs))
	for _, id := range currentUserIDs {
		targetIDs[id] = struct{}{}
	}
	for _, id := range requestedUserIDs {
		targetIDs[id] = struct{}{}
	}
	userIDs := make([]string, 0, len(targetIDs))
	for id := range targetIDs {
		userIDs = append(userIDs, id)
	}
	sort.Strings(userIDs)
	encodedIDs, err := json.Marshal(userIDs)
	if err != nil {
		return err
	}

	// Each statement finishes before the next one starts. The user lifecycle
	// also locks public.users before organization_members, including when a
	// membership row is absent during a remove/reinvite lifecycle. NO KEY UPDATE
	// still blocks changes to user activity but permits queue FK key-share locks.
	rows, err = tx.Query(ctx, `
		select u.id::text
		from public.users u
		where u.id in (select value::uuid from jsonb_array_elements_text($1::jsonb))
		order by u.id
		for no key update of u
	`, string(encodedIDs))
	if err != nil {
		return err
	}
	lockedUsers, err := collectTeamUUIDs(rows)
	if err != nil {
		return err
	}
	lockedUserSet := make(map[string]struct{}, len(lockedUsers))
	for _, id := range lockedUsers {
		lockedUserSet[id] = struct{}{}
	}
	for _, id := range requestedUserIDs {
		if _, ok := lockedUserSet[id]; !ok {
			return ErrInvalidInput
		}
	}

	rows, err = tx.Query(ctx, `
		select om.user_id::text
		from public.organization_members om
		where om.organization_id = $1::uuid
		  and om.user_id in (select value::uuid from jsonb_array_elements_text($2::jsonb))
		order by om.user_id
		for share of om
	`, organizationID, string(encodedIDs))
	if err != nil {
		return err
	}
	lockedMemberships, err := collectTeamUUIDs(rows)
	if err != nil {
		return err
	}
	lockedMembershipSet := make(map[string]struct{}, len(lockedMemberships))
	for _, id := range lockedMemberships {
		lockedMembershipSet[id] = struct{}{}
	}
	for _, id := range requestedUserIDs {
		if _, ok := lockedMembershipSet[id]; !ok {
			return ErrInvalidInput
		}
	}

	rows, err = tx.Query(ctx, `
		select tm.id::text
		from public.team_members tm
		where tm.organization_id = $1::uuid
		  and tm.team_id = $2::uuid
		order by tm.id
		for share of tm
	`, organizationID, teamID)
	if err != nil {
		return err
	}
	_, err = collectTeamUUIDs(rows)
	return err
}

func (repo Repository) List(ctx context.Context, tenantContext tenant.Context, includeInactive bool) ([]Team, error) {
	where := []string{"t.organization_id = $1::uuid"}
	args := []any{tenantContext.OrganizationID}
	if !includeInactive {
		where = append(where, "t.is_active = true")
	}
	if !canViewAllTeams(tenantContext) {
		if !tenantContext.IsTeamLeader || len(tenantContext.LedTeamIDs) == 0 {
			return []Team{}, nil
		}
		placeholders := []string{}
		for _, teamID := range tenantContext.LedTeamIDs {
			args = append(args, teamID)
			placeholders = append(placeholders, fmt.Sprintf("$%d::uuid", len(args)))
		}
		where = append(where, "t.id in ("+strings.Join(placeholders, ", ")+")")
	}

	rows, err := repo.db.Pool().Query(ctx, `
		select
			t.id::text,
			t.name,
			t.organization_id::text,
			t.created_at::text,
			t.revision,
			t.is_active,
			t.logo_url,
			t.created_by::text,
			u.id::text,
			u.name,
			u.email,
			u.avatar_url
		from public.teams t
		left join public.users u on u.id = t.created_by
		where `+strings.Join(where, " and ")+`
		order by t.name asc, t.created_at desc
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	teams := []Team{}
	for rows.Next() {
		team, err := scanTeam(rows)
		if err != nil {
			return nil, err
		}
		teams = append(teams, team)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(teams) == 0 {
		return []Team{}, nil
	}

	membersByTeam, err := repo.membersByTeam(ctx, tenantContext.OrganizationID)
	if err != nil {
		return nil, err
	}
	for index := range teams {
		teams[index].Members = membersByTeam[teams[index].ID]
		if teams[index].Members == nil {
			teams[index].Members = []TeamMember{}
		}
	}

	return teams, nil
}

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

func (repo Repository) Get(ctx context.Context, tenantContext tenant.Context, teamID string) (Team, error) {
	teamID, ok := normalizeUUID(teamID)
	if !ok {
		return Team{}, ErrInvalidInput
	}
	if !canViewTeam(tenantContext, teamID) {
		return Team{}, tenant.ErrOrganizationAccessDenied
	}
	return repo.getWithQueryer(ctx, repo.db.Pool(), tenantContext, teamID)
}

func (repo Repository) getWithQueryer(
	ctx context.Context,
	q teamReadExecutor,
	tenantContext tenant.Context,
	teamID string,
) (Team, error) {
	team, err := scanTeam(q.QueryRow(ctx, `
		select
			t.id::text,
			t.name,
			t.organization_id::text,
			t.created_at::text,
			t.revision,
			t.is_active,
			t.logo_url,
			t.created_by::text,
			u.id::text,
			u.name,
			u.email,
			u.avatar_url
		from public.teams t
		left join public.users u on u.id = t.created_by
		where t.organization_id = $1::uuid
		  and t.id = $2::uuid
	`, tenantContext.OrganizationID, teamID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Team{}, ErrTeamNotFound
	}
	if err != nil {
		return Team{}, err
	}
	membersByTeam, err := membersByTeamWithQueryer(ctx, q, tenantContext.OrganizationID, &teamID)
	if err != nil {
		return Team{}, err
	}
	team.Members = membersByTeam[team.ID]
	if team.Members == nil {
		team.Members = []TeamMember{}
	}
	return team, nil
}

func (repo Repository) UploadLogo(ctx context.Context, tenantContext tenant.Context, contentType string, size int64, _ string, body io.Reader) (AssetUpload, error) {
	if !canManageTeams(tenantContext) {
		return AssetUpload{}, tenant.ErrOrganizationAccessDenied
	}
	ext := extensionForContentType(contentType)
	if ext == "" {
		return AssetUpload{}, ErrInvalidInput
	}
	objectPath := fmt.Sprintf("organizations/%s/teams/%d%s", tenantContext.OrganizationID, time.Now().UTC().UnixMilli(), ext)
	if err := repo.storage.upload(ctx, "logos", objectPath, contentType, body); err != nil {
		return AssetUpload{}, err
	}
	return AssetUpload{
		URL:         repo.storage.publicURL("logos", objectPath),
		Path:        objectPath,
		Bucket:      "logos",
		ContentType: contentType,
		Size:        size,
	}, nil
}

func (repo Repository) ListTeamPipelines(ctx context.Context, tenantContext tenant.Context, teamID string) ([]TeamPipelineRelation, error) {
	args := []any{tenantContext.OrganizationID}
	where := []string{"tp.organization_id = $1::uuid"}
	if strings.TrimSpace(teamID) != "" {
		normalizedTeamID, ok := normalizeUUID(teamID)
		if !ok {
			return nil, ErrInvalidInput
		}
		if !canViewAllTeams(tenantContext) && !tenantContext.LeadsTeam(normalizedTeamID) {
			return []TeamPipelineRelation{}, nil
		}
		args = append(args, normalizedTeamID)
		where = append(where, fmt.Sprintf("tp.team_id = $%d::uuid", len(args)))
	} else if !canViewAllTeams(tenantContext) {
		if !tenantContext.IsTeamLeader || len(tenantContext.LedTeamIDs) == 0 {
			return []TeamPipelineRelation{}, nil
		}
		placeholders := []string{}
		for _, ledTeamID := range tenantContext.LedTeamIDs {
			args = append(args, ledTeamID)
			placeholders = append(placeholders, fmt.Sprintf("$%d::uuid", len(args)))
		}
		where = append(where, "tp.team_id in ("+strings.Join(placeholders, ", ")+")")
	}

	rows, err := repo.db.Pool().Query(ctx, `
		select
			tp.id::text,
			tp.team_id::text,
			tp.pipeline_id::text,
			tp.created_at::text,
			p.id::text,
			p.name,
			t.id::text,
			t.name
		from public.team_pipelines tp
		join public.pipelines p
		  on p.id = tp.pipeline_id
		 and p.organization_id = tp.organization_id
		join public.teams t
		  on t.id = tp.team_id
		 and t.organization_id = tp.organization_id
		where `+strings.Join(where, " and ")+`
		order by t.name asc, p.name asc
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []TeamPipelineRelation{}
	for rows.Next() {
		item, err := scanTeamPipeline(rows)
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

func (repo Repository) AssignPipelineToTeam(ctx context.Context, tenantContext tenant.Context, request AssignPipelineRequest) (TeamPipelineRelation, error) {
	item, _, err := repo.assignPipelineToTeam(ctx, tenantContext, request)
	return item, err
}

func (repo Repository) assignPipelineToTeam(ctx context.Context, tenantContext tenant.Context, request AssignPipelineRequest) (TeamPipelineRelation, bool, error) {
	teamID, pipelineID, err := normalizeTeamPipelineRequest(request)
	if err != nil {
		return TeamPipelineRelation{}, false, err
	}
	if !canManageTeamPipeline(tenantContext, teamID) {
		return TeamPipelineRelation{}, false, tenant.ErrOrganizationAccessDenied
	}
	tx, err := repo.beginTeamMutation(ctx)
	if err != nil {
		return TeamPipelineRelation{}, false, err
	}
	defer tx.Rollback(ctx)
	if err := setAuditActor(ctx, tx, tenantContext); err != nil {
		return TeamPipelineRelation{}, false, err
	}
	if err := ensureTeamAndPipelineWithQueryer(ctx, tx, tenantContext.OrganizationID, teamID, pipelineID); err != nil {
		return TeamPipelineRelation{}, false, err
	}

	tag, err := tx.Exec(ctx, `
		insert into public.team_pipelines (organization_id, team_id, pipeline_id)
		values ($1::uuid, $2::uuid, $3::uuid)
		on conflict (team_id, pipeline_id) do nothing
	`, tenantContext.OrganizationID, teamID, pipelineID)
	if err != nil {
		return TeamPipelineRelation{}, false, err
	}
	item, err := getTeamPipelineByPairWithQueryer(ctx, tx, tenantContext.OrganizationID, teamID, pipelineID)
	if err != nil {
		return TeamPipelineRelation{}, false, err
	}
	if err := tx.Commit(ctx); err != nil {
		return TeamPipelineRelation{}, false, err
	}

	return item, tag.RowsAffected() > 0, nil
}

func (repo Repository) RemovePipelineFromTeam(ctx context.Context, tenantContext tenant.Context, request AssignPipelineRequest) error {
	_, err := repo.removePipelineFromTeam(ctx, tenantContext, request)
	return err
}

func (repo Repository) removePipelineFromTeam(ctx context.Context, tenantContext tenant.Context, request AssignPipelineRequest) (bool, error) {
	teamID, pipelineID, err := normalizeTeamPipelineRequest(request)
	if err != nil {
		return false, err
	}
	if !canManageTeamPipeline(tenantContext, teamID) {
		return false, tenant.ErrOrganizationAccessDenied
	}

	tx, err := repo.beginTeamMutation(ctx)
	if err != nil {
		return false, err
	}
	defer tx.Rollback(ctx)
	if err := setAuditActor(ctx, tx, tenantContext); err != nil {
		return false, err
	}

	tag, err := tx.Exec(ctx, `
		delete from public.team_pipelines
		where organization_id = $1::uuid
		  and team_id = $2::uuid
		  and pipeline_id = $3::uuid
	`, tenantContext.OrganizationID, teamID, pipelineID)
	if err != nil {
		return false, err
	}
	if err := tx.Commit(ctx); err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
}

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

func (repo Repository) membersByTeam(ctx context.Context, organizationID string) (map[string][]TeamMember, error) {
	return membersByTeamWithQueryer(ctx, repo.db.Pool(), organizationID, nil)
}

func membersByTeamWithQueryer(
	ctx context.Context,
	q teamReadExecutor,
	organizationID string,
	teamID *string,
) (map[string][]TeamMember, error) {
	args := []any{organizationID}
	teamPredicate := ""
	if teamID != nil {
		args = append(args, *teamID)
		teamPredicate = " and t.id = $2::uuid"
	}
	rows, err := q.Query(ctx, `
		select
			tm.id::text,
			tm.team_id::text,
			tm.user_id::text,
			tm.created_at::text,
			coalesce(tm.is_leader, false),
			u.id::text,
			u.name,
			u.email,
			u.avatar_url
		from public.team_members tm
		join public.teams t on t.id = tm.team_id and t.organization_id = $1::uuid
		join public.users u on u.id = tm.user_id
		join public.organization_members om
		  on om.organization_id = t.organization_id
		 and om.user_id = tm.user_id
		 and coalesce(om.is_active, false) = true
		 and om.deleted_at is null
		 and om.membership_generation = tm.membership_generation
		where coalesce(tm.is_active, true) = true`+teamPredicate+`
		  and coalesce(u.is_active, false) = true
		order by tm.created_at asc, tm.id asc
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := map[string][]TeamMember{}
	for rows.Next() {
		member, err := scanTeamMember(rows)
		if err != nil {
			return nil, err
		}
		result[member.TeamID] = append(result[member.TeamID], member)
	}
	return result, rows.Err()
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

func currentTeamQueueKeepIDs(ctx context.Context, tx pgx.Tx, organizationID, teamID string) ([]string, error) {
	rows, err := tx.Query(ctx, `
		select distinct tm.user_id::text
		from public.team_members tm
		where tm.organization_id = $1::uuid
		  and tm.team_id = $2::uuid
		order by tm.user_id::text
	`, organizationID, teamID)
	if err != nil {
		return nil, err
	}
	return collectTeamUUIDs(rows)
}

func syncRoundRobinWithTeam(ctx context.Context, tx pgx.Tx, organizationID string, teamID string, newMemberIDs []string) error {
	return syncRoundRobinWithTeamPreserving(ctx, tx, organizationID, teamID, newMemberIDs, newMemberIDs)
}

func syncRoundRobinWithTeamPreserving(ctx context.Context, tx pgx.Tx, organizationID string, teamID string, newMemberIDs, keepMemberIDs []string) error {
	rows, err := tx.Query(ctx, `
		select
			rrm.id::text,
			rrm.round_robin_id::text,
			rrm.user_id::text,
			coalesce(rrm.position, 0),
			coalesce(rrm.weight, 10),
			coalesce(rrm.membership_generation, 0),
			coalesce((
				select om.membership_generation
				from public.organization_members om
				where om.organization_id = rrm.organization_id
				  and om.user_id = rrm.user_id
			), 0),
			coalesce(rrm.is_active, true),
			exists (
			  select 1 from public.round_robin_members logical
			  where logical.organization_id = rrm.organization_id
			    and logical.round_robin_id = rrm.round_robin_id
			    and logical.team_id = rrm.team_id
			    and logical.user_id is null
			)
		from public.round_robin_members rrm
		join public.round_robins rr
		  on rr.id = rrm.round_robin_id
		 and rr.organization_id = rrm.organization_id
		where rr.organization_id = $1::uuid
		  and rrm.team_id = $2::uuid
		  and rrm.user_id is not null
		order by rr.id, rrm.position, rrm.id
		for update of rr, rrm
	`, organizationID, teamID)
	if err != nil {
		return err
	}
	defer rows.Close()

	type rrMember struct {
		ID                string
		RoundRobinID      string
		UserID            string
		Position          int
		Weight            int
		Generation        int64
		CurrentGeneration int64
		IsActive          bool
		HasLogicalEntry   bool
	}
	byQueue := map[string][]rrMember{}
	for rows.Next() {
		var member rrMember
		if err := rows.Scan(&member.ID, &member.RoundRobinID, &member.UserID, &member.Position, &member.Weight, &member.Generation, &member.CurrentGeneration, &member.IsActive, &member.HasLogicalEntry); err != nil {
			return err
		}
		byQueue[member.RoundRobinID] = append(byQueue[member.RoundRobinID], member)
	}
	if err := rows.Err(); err != nil {
		return err
	}

	nextIDs := map[string]struct{}{}
	for _, id := range keepMemberIDs {
		nextIDs[id] = struct{}{}
	}
	insertIDs := map[string]struct{}{}
	for _, id := range newMemberIDs {
		insertIDs[id] = struct{}{}
	}
	for roundRobinID, currentMembers := range byQueue {
		currentIDs := map[string]struct{}{}
		maxPosition := -1
		defaultWeight := currentMembers[0].Weight
		logicalPresent := currentMembers[0].HasLogicalEntry
		hasResultingTeamEntry := logicalPresent
		anyActive := false
		for _, member := range currentMembers {
			currentIDs[member.UserID] = struct{}{}
			if member.Position > maxPosition {
				maxPosition = member.Position
			}
			if _, keep := nextIDs[member.UserID]; keep {
				hasResultingTeamEntry = true
			}
			anyActive = anyActive || member.IsActive
		}
		// Observe actual INSERT outcomes before deleting the last legacy row.
		// A selected user may already be a direct participant (DO NOTHING), and
		// hidden roster members need not have a participant in this queue.
		position := int64(maxPosition) + 1
		initialCount := int64(-1)
		insertedCount := int64(0)
		if !logicalPresent {
			for _, userID := range newMemberIDs {
				if _, exists := currentIDs[userID]; exists {
					continue
				}
				if initialCount < 0 {
					initialCount, err = teamQueueParticipantCount(ctx, tx, organizationID, roundRobinID)
					if err != nil {
						return err
					}
				}
				if position > maxQueueParticipantPosition {
					// ON CONFLICT cannot protect an overflowing int4 parameter. A
					// direct participant needs no new position or team-bound row.
					exists, err := teamQueueUserExists(ctx, tx, organizationID, roundRobinID, userID)
					if err != nil {
						return err
					}
					if exists {
						continue
					}
					return ErrTeamQueueSyncBlocked
				}
				tag, err := tx.Exec(ctx, `
					insert into public.round_robin_members (organization_id, round_robin_id, team_id, user_id, weight, position, is_active)
					values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, true)
					on conflict (round_robin_id, user_id) do nothing
				`, organizationID, roundRobinID, teamID, userID, defaultWeight, int(position))
				if err != nil {
					return err
				}
				if tag.RowsAffected() > 0 {
					hasResultingTeamEntry = true
					currentIDs[userID] = struct{}{}
					insertedCount += tag.RowsAffected()
					position++
				}
			}
		}
		// Preserve the binding when these effective writes would leave no team
		// participant. A logical entry expands future roster changes directly.
		anchorID := ""
		if !hasResultingTeamEntry {
			first := currentMembers[0]
			tag, err := tx.Exec(ctx, `
				update public.round_robin_members member
				set user_id = null, is_active = $5, updated_at = now()
				where member.organization_id = $1::uuid
				  and member.round_robin_id = $2::uuid
				  and member.team_id = $3::uuid
				  and member.id = $4::uuid
				  and not exists (
				    select 1 from public.round_robin_members logical
				    where logical.organization_id = $1::uuid
				      and logical.round_robin_id = $2::uuid
				      and logical.team_id = $3::uuid
				      and logical.user_id is null
				  )
			`, organizationID, roundRobinID, teamID, first.ID, anyActive)
			if err != nil {
				return err
			}
			if tag.RowsAffected() > 0 {
				anchorID = first.ID
			}
		}
		for _, member := range currentMembers {
			if member.ID == anchorID {
				continue
			}
			if _, keep := nextIDs[member.UserID]; !keep {
				if _, err := tx.Exec(ctx, `
					delete from public.round_robin_members
					where organization_id = $1::uuid
					  and id = $2::uuid
				`, organizationID, member.ID); err != nil {
					return err
				}
			} else if _, selected := insertIDs[member.UserID]; selected && member.Generation != member.CurrentGeneration {
				// An explicit re-enrollment must rebind an existing stale queue row.
				if _, err := tx.Exec(ctx, `
					update public.round_robin_members
					set is_active = true
					where organization_id = $1::uuid
					  and id = $2::uuid
				`, organizationID, member.ID); err != nil {
					return err
				}
			}
		}
		if insertedCount > 0 {
			finalCount, err := teamQueueParticipantCount(ctx, tx, organizationID, roundRobinID)
			if err != nil {
				return err
			}
			// Legacy queues above the cap can retain or reduce their count.
			// Only real growth beyond the cap prevents the entire team save.
			if finalCount > distribution.MaxQueueParticipants && finalCount > initialCount {
				return ErrTeamQueueSyncBlocked
			}
		}
	}
	return nil
}

func scanTeam(row teamScanner) (Team, error) {
	var team Team
	var logoURL, createdBy pgtype.Text
	var creatorID, creatorName, creatorEmail, creatorAvatar pgtype.Text
	err := row.Scan(&team.ID, &team.Name, &team.OrganizationID, &team.CreatedAt, &team.Revision, &team.IsActive, &logoURL, &createdBy, &creatorID, &creatorName, &creatorEmail, &creatorAvatar)
	if err != nil {
		return Team{}, err
	}
	team.LogoURL = textPointer(logoURL)
	team.CreatedBy = textPointer(createdBy)
	if creatorID.Valid {
		team.CreatedByUser = &TeamUser{
			ID:        creatorID.String,
			Name:      textPointer(creatorName),
			Email:     textPointer(creatorEmail),
			AvatarURL: textPointer(creatorAvatar),
		}
	}
	team.Members = []TeamMember{}
	return team, nil
}

func scanTeamMember(row teamScanner) (TeamMember, error) {
	var member TeamMember
	var userName, userEmail, userAvatar pgtype.Text
	var userID string
	if err := row.Scan(&member.ID, &member.TeamID, &member.UserID, &member.CreatedAt, &member.IsLeader, &userID, &userName, &userEmail, &userAvatar); err != nil {
		return TeamMember{}, err
	}
	member.User = &TeamUser{
		ID:        userID,
		Name:      textPointer(userName),
		Email:     textPointer(userEmail),
		AvatarURL: textPointer(userAvatar),
	}
	return member, nil
}

func (repo Repository) getTeamPipelineByPair(ctx context.Context, organizationID string, teamID string, pipelineID string) (TeamPipelineRelation, error) {
	return getTeamPipelineByPairWithQueryer(ctx, repo.db.Pool(), organizationID, teamID, pipelineID)
}

func getTeamPipelineByPairWithQueryer(ctx context.Context, q queryRowExecutor, organizationID string, teamID string, pipelineID string) (TeamPipelineRelation, error) {
	item, err := scanTeamPipeline(q.QueryRow(ctx, `
		select
			tp.id::text,
			tp.team_id::text,
			tp.pipeline_id::text,
			tp.created_at::text,
			p.id::text,
			p.name,
			t.id::text,
			t.name
		from public.team_pipelines tp
		join public.pipelines p
		  on p.id = tp.pipeline_id
		 and p.organization_id = tp.organization_id
		join public.teams t
		  on t.id = tp.team_id
		 and t.organization_id = tp.organization_id
		where tp.organization_id = $1::uuid
		  and tp.team_id = $2::uuid
		  and tp.pipeline_id = $3::uuid
	`, organizationID, teamID, pipelineID))
	if errors.Is(err, pgx.ErrNoRows) {
		return TeamPipelineRelation{}, ErrInvalidInput
	}
	return item, err
}

func scanTeamPipeline(row teamScanner) (TeamPipelineRelation, error) {
	var item TeamPipelineRelation
	var pipelineID, pipelineName, teamID, teamName string
	if err := row.Scan(&item.ID, &item.TeamID, &item.PipelineID, &item.CreatedAt, &pipelineID, &pipelineName, &teamID, &teamName); err != nil {
		return TeamPipelineRelation{}, err
	}
	item.Pipeline = &EntityRef{ID: pipelineID, Name: pipelineName}
	item.Team = &EntityRef{ID: teamID, Name: teamName}
	return item, nil
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

func (repo Repository) ensureTeamAndPipeline(ctx context.Context, organizationID string, teamID string, pipelineID string) error {
	return ensureTeamAndPipelineWithQueryer(ctx, repo.db.Pool(), organizationID, teamID, pipelineID)
}

func ensureTeamAndPipelineWithQueryer(ctx context.Context, q queryRowExecutor, organizationID string, teamID string, pipelineID string) error {
	var ok bool
	if err := q.QueryRow(ctx, `
		select exists (
			select 1
			from public.teams t
			where t.organization_id = $1::uuid
			  and t.id = $2::uuid
		) and exists (
			select 1
			from public.pipelines p
			where p.organization_id = $1::uuid
			  and p.id = $3::uuid
		)
	`, organizationID, teamID, pipelineID).Scan(&ok); err != nil {
		return err
	}
	if !ok {
		return ErrInvalidInput
	}
	return nil
}

func normalizeTeamPipelineRequest(request AssignPipelineRequest) (string, string, error) {
	teamID, ok := normalizeUUID(request.TeamID)
	if !ok {
		return "", "", ErrInvalidInput
	}
	pipelineID, ok := normalizeUUID(request.PipelineID)
	if !ok {
		return "", "", ErrInvalidInput
	}
	return teamID, pipelineID, nil
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

func (repo Repository) ensureCanManageAvailability(ctx context.Context, q queryRowExecutor, tenantContext tenant.Context, teamMemberID string) error {
	if canManageTeams(tenantContext) {
		return nil
	}
	if !tenantContext.IsTeamLeader {
		return tenant.ErrOrganizationAccessDenied
	}
	if !tenantContext.HasPermission(permissions.TeamManage) {
		return tenant.ErrOrganizationAccessDenied
	}

	var teamID string
	err := q.QueryRow(ctx, `
		select tm.team_id::text
		from public.team_members tm
		join public.teams t on t.id = tm.team_id
		join public.organization_members om
		  on om.organization_id = tm.organization_id
		 and om.user_id = tm.user_id
		 and om.is_active = true
		 and om.deleted_at is null
		 and om.membership_generation = tm.membership_generation
		where tm.organization_id = $1::uuid
		  and tm.id = $2::uuid
		  and t.organization_id = $1::uuid
		  and coalesce(tm.is_active, true) = true
		  and coalesce(t.is_active, true) = true
	`, tenantContext.OrganizationID, teamMemberID).Scan(&teamID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrTeamMemberNotFound
	}
	if err != nil {
		return err
	}
	if !tenantContext.LeadsTeam(teamID) {
		return tenant.ErrOrganizationAccessDenied
	}
	return nil
}

func canManageTeams(tenantContext tenant.Context) bool {
	if tenantContext.IsSuperAdmin || tenantContext.HasRole("owner", "admin") {
		return true
	}
	if tenantContext.IsTeamLeader {
		return false
	}

	return tenantContext.HasPermission(permissions.TeamManage)
}

func canRecoverTeamCreation(tenantContext tenant.Context, teamID string) bool {
	return canManageTeams(tenantContext) || (tenantContext.HasPermission(permissions.TeamManage) && tenantContext.LeadsTeam(teamID))
}

func canViewAllTeams(tenantContext tenant.Context) bool {
	if canManageTeams(tenantContext) {
		return true
	}
	if !tenantContext.HasPermission(permissions.TeamView) {
		return false
	}
	if tenantContext.HasRole("manager") {
		return true
	}

	// Team leaders keep a deliberately scoped view of the teams they lead.
	// A manager retains organization-wide read visibility when also assigned
	// as a team leader, while mutations remain restricted to led teams.
	return !tenantContext.IsTeamLeader
}

func canManageTeamPipeline(tenantContext tenant.Context, teamID string) bool {
	if tenantContext.IsSuperAdmin || tenantContext.HasRole("owner", "admin") {
		return true
	}
	if !tenantContext.HasPermission(permissions.PipelineManage) {
		return false
	}
	if tenantContext.IsTeamLeader {
		return tenantContext.LeadsTeam(teamID)
	}
	return true
}

func canViewTeam(tenantContext tenant.Context, teamID string) bool {
	return canViewAllTeams(tenantContext) || tenantContext.LeadsTeam(teamID)
}

func canReadTeamAvailability(tenantContext tenant.Context) bool {
	return tenantContext.IsSuperAdmin || tenantContext.HasRole("owner", "admin") || tenantContext.HasPermission(permissions.TeamView)
}

func textOrNil(value *string) any {
	if value == nil {
		return nil
	}
	cleaned := strings.TrimSpace(*value)
	if cleaned == "" {
		return nil
	}
	return cleaned
}

func textPointer(value pgtype.Text) *string {
	return pgvalue.TextPointer(value)
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

func normalizeUUID(value string) (string, bool) {
	return pgvalue.NormalizeUUID(value)
}

func extensionForContentType(contentType string) string {
	if before, _, ok := strings.Cut(contentType, ";"); ok {
		contentType = before
	}
	switch strings.ToLower(strings.TrimSpace(contentType)) {
	case "image/jpeg":
		return ".jpg"
	case "image/png":
		return ".png"
	case "image/webp":
		return ".webp"
	case "image/gif":
		return ".gif"
	case "image/svg+xml":
		return ".svg"
	default:
		return ""
	}
}
