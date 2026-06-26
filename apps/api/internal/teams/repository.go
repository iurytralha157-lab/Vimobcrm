package teams

import (
	"context"
	"errors"
	"fmt"
	"io"
	"path/filepath"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

type Repository struct {
	db      *dbpkg.Postgres
	storage storageClient
}

type teamScanner interface {
	Scan(dest ...any) error
}

type queryRowExecutor interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

func NewRepository(db *dbpkg.Postgres, storageConfig StorageConfig) Repository {
	return Repository{
		db:      db,
		storage: newStorageClient(storageConfig),
	}
}

func (repo Repository) List(ctx context.Context, tenantContext tenant.Context, includeInactive bool) ([]Team, error) {
	where := []string{"t.organization_id = $1::uuid"}
	if !includeInactive {
		where = append(where, "t.is_active = true")
	}

	rows, err := repo.db.Pool().Query(ctx, `
		select
			t.id::text,
			t.name,
			t.organization_id::text,
			t.created_at::text,
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
	`, tenantContext.OrganizationID)
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
	if !canManageTeams(tenantContext) {
		return Team{}, tenant.ErrOrganizationAccessDenied
	}
	name := strings.TrimSpace(request.Name)
	if name == "" {
		return Team{}, ErrInvalidInput
	}
	isActive := true
	if request.IsActive != nil {
		isActive = *request.IsActive
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return Team{}, err
	}
	defer tx.Rollback(ctx)

	var teamID string
	err = tx.QueryRow(ctx, `
		insert into public.teams (organization_id, name, logo_url, is_active, created_by)
		values ($1::uuid, $2, $3, $4, $5::uuid)
		returning id::text
	`, tenantContext.OrganizationID, name, textOrNil(request.LogoURL), isActive, tenantContext.UserID).Scan(&teamID)
	if err != nil {
		return Team{}, err
	}

	if err := replaceMembers(ctx, tx, teamID, normalizeMemberInputs(request)); err != nil {
		return Team{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Team{}, err
	}

	return repo.Get(ctx, tenantContext, teamID)
}

func (repo Repository) Update(ctx context.Context, tenantContext tenant.Context, teamID string, request UpdateTeamRequest) (Team, error) {
	if !canManageTeams(tenantContext) {
		return Team{}, tenant.ErrOrganizationAccessDenied
	}
	teamID, ok := normalizeUUID(teamID)
	if !ok {
		return Team{}, ErrInvalidInput
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return Team{}, err
	}
	defer tx.Rollback(ctx)

	args := []any{tenantContext.OrganizationID, teamID}
	assignments := []string{}
	if request.Name != nil {
		name := strings.TrimSpace(*request.Name)
		if name == "" {
			return Team{}, ErrInvalidInput
		}
		args = append(args, name)
		assignments = append(assignments, fmt.Sprintf("name = $%d", len(args)))
	}
	if request.LogoURL != nil {
		args = append(args, textOrNil(request.LogoURL))
		assignments = append(assignments, fmt.Sprintf("logo_url = $%d", len(args)))
	}
	if request.IsActive != nil {
		args = append(args, *request.IsActive)
		assignments = append(assignments, fmt.Sprintf("is_active = $%d", len(args)))
	}
	if len(assignments) > 0 {
		assignments = append(assignments, "updated_at = now()")
		tag, err := tx.Exec(ctx, `
			update public.teams
			set `+strings.Join(assignments, ", ")+`
			where organization_id = $1::uuid
			  and id = $2::uuid
		`, args...)
		if err != nil {
			return Team{}, err
		}
		if tag.RowsAffected() == 0 {
			return Team{}, ErrTeamNotFound
		}
	}

	if hasMemberUpdate(request) {
		memberInputs := normalizeMemberInputsFromUpdate(request)
		if request.PreserveLeadership {
			current, err := repo.currentLeaderMap(ctx, tx, teamID)
			if err != nil {
				return Team{}, err
			}
			for index := range memberInputs {
				memberInputs[index].IsLeader = current[memberInputs[index].UserID]
			}
		}
		if err := replaceMembers(ctx, tx, teamID, memberInputs); err != nil {
			return Team{}, err
		}
		if err := syncRoundRobinWithTeam(ctx, tx, teamID, memberUserIDs(memberInputs)); err != nil {
			return Team{}, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return Team{}, err
	}
	return repo.Get(ctx, tenantContext, teamID)
}

func (repo Repository) UpdateStatus(ctx context.Context, tenantContext tenant.Context, teamID string, isActive bool) (Team, error) {
	return repo.Update(ctx, tenantContext, teamID, UpdateTeamRequest{IsActive: &isActive})
}

func (repo Repository) Delete(ctx context.Context, tenantContext tenant.Context, teamID string) error {
	if !canManageTeams(tenantContext) {
		return tenant.ErrOrganizationAccessDenied
	}
	teamID, ok := normalizeUUID(teamID)
	if !ok {
		return ErrInvalidInput
	}
	tag, err := repo.db.Pool().Exec(ctx, `
		delete from public.teams
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, tenantContext.OrganizationID, teamID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrTeamNotFound
	}
	return nil
}

func (repo Repository) Get(ctx context.Context, tenantContext tenant.Context, teamID string) (Team, error) {
	teamID, ok := normalizeUUID(teamID)
	if !ok {
		return Team{}, ErrInvalidInput
	}
	team, err := scanTeam(repo.db.Pool().QueryRow(ctx, `
		select
			t.id::text,
			t.name,
			t.organization_id::text,
			t.created_at::text,
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
	membersByTeam, err := repo.membersByTeam(ctx, tenantContext.OrganizationID)
	if err != nil {
		return Team{}, err
	}
	team.Members = membersByTeam[team.ID]
	if team.Members == nil {
		team.Members = []TeamMember{}
	}
	return team, nil
}

func (repo Repository) UploadLogo(ctx context.Context, tenantContext tenant.Context, contentType string, size int64, fileName string, body io.Reader) (AssetUpload, error) {
	if !canManageTeams(tenantContext) {
		return AssetUpload{}, tenant.ErrOrganizationAccessDenied
	}
	ext := strings.ToLower(filepath.Ext(fileName))
	if ext == "" {
		ext = extensionForContentType(contentType)
	}
	if ext == "" {
		ext = ".webp"
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
		args = append(args, normalizedTeamID)
		where = append(where, fmt.Sprintf("tp.team_id = $%d::uuid", len(args)))
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
	if !canManageTeams(tenantContext) {
		return TeamPipelineRelation{}, tenant.ErrOrganizationAccessDenied
	}
	teamID, pipelineID, err := normalizeTeamPipelineRequest(request)
	if err != nil {
		return TeamPipelineRelation{}, err
	}
	if err := repo.ensureTeamAndPipeline(ctx, tenantContext.OrganizationID, teamID, pipelineID); err != nil {
		return TeamPipelineRelation{}, err
	}

	if _, err := repo.db.Pool().Exec(ctx, `
		insert into public.team_pipelines (organization_id, team_id, pipeline_id)
		values ($1::uuid, $2::uuid, $3::uuid)
		on conflict (team_id, pipeline_id) do nothing
	`, tenantContext.OrganizationID, teamID, pipelineID); err != nil {
		return TeamPipelineRelation{}, err
	}

	return repo.getTeamPipelineByPair(ctx, tenantContext.OrganizationID, teamID, pipelineID)
}

func (repo Repository) RemovePipelineFromTeam(ctx context.Context, tenantContext tenant.Context, request AssignPipelineRequest) error {
	if !canManageTeams(tenantContext) {
		return tenant.ErrOrganizationAccessDenied
	}
	teamID, pipelineID, err := normalizeTeamPipelineRequest(request)
	if err != nil {
		return err
	}

	_, err = repo.db.Pool().Exec(ctx, `
		delete from public.team_pipelines
		where organization_id = $1::uuid
		  and team_id = $2::uuid
		  and pipeline_id = $3::uuid
	`, tenantContext.OrganizationID, teamID, pipelineID)
	return err
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

	tag, err := repo.db.Pool().Exec(ctx, `
		update public.team_members tm
		set is_leader = $4
		where tm.team_id = $2::uuid
		  and tm.user_id = $3::uuid
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
	return nil
}

func (repo Repository) ListAvailability(ctx context.Context, tenantContext tenant.Context, teamMemberIDs []string) ([]MemberAvailability, error) {
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

	rows, err := repo.db.Pool().Query(ctx, `
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
		where `+strings.Join(where, " and ")+`
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

func (repo Repository) UpsertAvailability(ctx context.Context, tenantContext tenant.Context, request AvailabilityRequest) (MemberAvailability, error) {
	input, err := normalizeAvailabilityRequest(request)
	if err != nil {
		return MemberAvailability{}, err
	}
	return repo.upsertAvailability(ctx, repo.db.Pool(), tenantContext.OrganizationID, input)
}

func (repo Repository) ReplaceAvailability(ctx context.Context, tenantContext tenant.Context, teamMemberID string, requests []AvailabilityRequest) ([]MemberAvailability, error) {
	teamMemberID, ok := normalizeUUID(teamMemberID)
	if !ok {
		return nil, ErrInvalidInput
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	if err := ensureTeamMemberBelongsToOrganization(ctx, tx, tenantContext.OrganizationID, teamMemberID); err != nil {
		return nil, err
	}

	if _, err := tx.Exec(ctx, `
		delete from public.member_availability
		where organization_id = $1::uuid
		  and team_member_id = $2::uuid
	`, tenantContext.OrganizationID, teamMemberID); err != nil {
		return nil, err
	}

	for _, request := range requests {
		request.TeamMemberID = teamMemberID
		input, err := normalizeAvailabilityRequest(request)
		if err != nil {
			return nil, err
		}
		if _, err := repo.upsertAvailability(ctx, tx, tenantContext.OrganizationID, input); err != nil {
			return nil, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	return repo.ListAvailability(ctx, tenantContext, []string{teamMemberID})
}

func (repo Repository) membersByTeam(ctx context.Context, organizationID string) (map[string][]TeamMember, error) {
	rows, err := repo.db.Pool().Query(ctx, `
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
		where coalesce(u.is_active, true) = true
		order by tm.created_at asc, tm.id asc
	`, organizationID)
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
		select user_id::text, coalesce(is_leader, false)
		from public.team_members
		where team_id = $1::uuid
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

func replaceMembers(ctx context.Context, tx pgx.Tx, teamID string, members []TeamMemberInput) error {
	normalized := normalizeMembers(members)
	ids := memberUserIDs(normalized)

	if len(ids) == 0 {
		_, err := tx.Exec(ctx, `delete from public.team_members where team_id = $1::uuid`, teamID)
		return err
	}

	args := []any{teamID}
	placeholders := []string{}
	for _, id := range ids {
		args = append(args, id)
		placeholders = append(placeholders, fmt.Sprintf("$%d::uuid", len(args)))
	}
	if _, err := tx.Exec(ctx, `
		delete from public.team_members
		where team_id = $1::uuid
		  and user_id not in (`+strings.Join(placeholders, ", ")+`)
	`, args...); err != nil {
		return err
	}

	for _, member := range normalized {
		_, err := tx.Exec(ctx, `
			insert into public.team_members (team_id, user_id, is_leader)
			values ($1::uuid, $2::uuid, $3)
			on conflict (team_id, user_id) do update
			set is_leader = excluded.is_leader
		`, teamID, member.UserID, member.IsLeader)
		if err != nil {
			return err
		}
	}
	return nil
}

func syncRoundRobinWithTeam(ctx context.Context, tx pgx.Tx, teamID string, newMemberIDs []string) error {
	rows, err := tx.Query(ctx, `
		select id::text, round_robin_id::text, user_id::text, coalesce(position, 0), coalesce(weight, 10)
		from public.round_robin_members
		where team_id = $1::uuid
	`, teamID)
	if err != nil {
		return err
	}
	defer rows.Close()

	type rrMember struct {
		ID           string
		RoundRobinID string
		UserID       string
		Position     int
		Weight       int
	}
	byQueue := map[string][]rrMember{}
	for rows.Next() {
		var member rrMember
		if err := rows.Scan(&member.ID, &member.RoundRobinID, &member.UserID, &member.Position, &member.Weight); err != nil {
			return err
		}
		byQueue[member.RoundRobinID] = append(byQueue[member.RoundRobinID], member)
	}
	if err := rows.Err(); err != nil {
		return err
	}

	nextIDs := map[string]struct{}{}
	for _, id := range newMemberIDs {
		nextIDs[id] = struct{}{}
	}
	for roundRobinID, currentMembers := range byQueue {
		currentIDs := map[string]struct{}{}
		maxPosition := -1
		defaultWeight := 10
		if len(currentMembers) > 0 {
			defaultWeight = currentMembers[0].Weight
		}
		for _, member := range currentMembers {
			currentIDs[member.UserID] = struct{}{}
			if member.Position > maxPosition {
				maxPosition = member.Position
			}
			if _, keep := nextIDs[member.UserID]; !keep {
				if _, err := tx.Exec(ctx, `delete from public.round_robin_members where id = $1::uuid`, member.ID); err != nil {
					return err
				}
			}
		}
		position := maxPosition + 1
		for _, userID := range newMemberIDs {
			if _, exists := currentIDs[userID]; exists {
				continue
			}
			if _, err := tx.Exec(ctx, `
				insert into public.round_robin_members (round_robin_id, user_id, team_id, weight, position)
				values ($1::uuid, $2::uuid, $3::uuid, $4, $5)
				on conflict (round_robin_id, user_id) do update
				set team_id = excluded.team_id
			`, roundRobinID, userID, teamID, defaultWeight, position); err != nil {
				return err
			}
			position++
		}
	}
	return nil
}

func scanTeam(row teamScanner) (Team, error) {
	var team Team
	var logoURL, createdBy pgtype.Text
	var creatorID, creatorName, creatorEmail, creatorAvatar pgtype.Text
	err := row.Scan(&team.ID, &team.Name, &team.OrganizationID, &team.CreatedAt, &team.IsActive, &logoURL, &createdBy, &creatorID, &creatorName, &creatorEmail, &creatorAvatar)
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
	item, err := scanTeamPipeline(repo.db.Pool().QueryRow(ctx, `
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
	var ok bool
	if err := repo.db.Pool().QueryRow(ctx, `
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
	TeamMemberID string
	DayOfWeek    int
	StartTime    *string
	EndTime      *string
	IsAllDay     bool
	IsActive     bool
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
	return availabilityInput{
		TeamMemberID: teamMemberID,
		DayOfWeek:    request.DayOfWeek,
		StartTime:    startTime,
		EndTime:      endTime,
		IsAllDay:     isAllDay,
		IsActive:     isActive,
	}, nil
}

func (repo Repository) upsertAvailability(ctx context.Context, q queryRowExecutor, organizationID string, input availabilityInput) (MemberAvailability, error) {
	item, err := scanMemberAvailability(q.QueryRow(ctx, `
		insert into public.member_availability (
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
			where t.organization_id = $1::uuid
			  and tm.id = $2::uuid
		)
		on conflict (team_member_id, day_of_week) do update
		set start_time = excluded.start_time,
		    end_time = excluded.end_time,
		    is_all_day = excluded.is_all_day,
		    is_active = excluded.is_active,
		    updated_at = now()
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
	if errors.Is(err, pgx.ErrNoRows) {
		return MemberAvailability{}, ErrTeamMemberNotFound
	}
	return item, err
}

func ensureTeamMemberBelongsToOrganization(ctx context.Context, q queryRowExecutor, organizationID string, teamMemberID string) error {
	var ok bool
	if err := q.QueryRow(ctx, `
		select exists (
			select 1
			from public.team_members tm
			join public.teams t on t.id = tm.team_id
			where t.organization_id = $1::uuid
			  and tm.id = $2::uuid
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
		out = append(out, TeamMemberInput{UserID: userID, IsLeader: member.IsLeader})
	}
	return out
}

func memberUserIDs(members []TeamMemberInput) []string {
	out := make([]string, 0, len(members))
	for _, member := range members {
		out = append(out, member.UserID)
	}
	return out
}

func hasMemberUpdate(request UpdateTeamRequest) bool {
	return request.Members != nil || request.MemberIDs != nil
}

func canManageTeams(tenantContext tenant.Context) bool {
	return tenantContext.HasPermission("settings_manage") ||
		tenantContext.HasPermission("settings_teams") ||
		tenantContext.HasPermission("teams_manage")
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
	if !value.Valid {
		return nil
	}
	return &value.String
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
	var uuid pgtype.UUID
	if err := uuid.Scan(strings.TrimSpace(value)); err != nil {
		return "", false
	}
	if !uuid.Valid {
		return "", false
	}
	return uuid.String(), true
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
