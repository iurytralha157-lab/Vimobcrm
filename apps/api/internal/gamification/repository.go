package gamification

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

var (
	ErrInvalidInput = errors.New("invalid gamification input")
	ErrNotFound     = errors.New("gamification resource not found")
	ErrNotReady     = errors.New("gamification admin schema is not ready")
)

type Repository struct {
	db *dbpkg.Postgres
}

type nullableInt struct {
	Value int
	Valid bool
}

type eventPoint struct {
	EventType string
	Points    int
	CreatedAt time.Time
}

type queryRower interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

func NewRepository(db *dbpkg.Postgres) Repository {
	return Repository{db: db}
}

func (repo Repository) Overview(ctx context.Context, tenantContext tenant.Context) (Overview, error) {
	ranking, err := repo.ranking(ctx, tenantContext)
	if err != nil {
		return Overview{}, err
	}
	events, totalEvents, err := repo.events(ctx, tenantContext, 12, false)
	if err != nil {
		return Overview{}, err
	}
	history, _, err := repo.events(ctx, tenantContext, 2000, true)
	if err != nil {
		return Overview{}, err
	}
	missions, err := repo.missions(ctx, tenantContext, true)
	if err != nil {
		return Overview{}, err
	}
	performance, err := repo.performance(ctx, tenantContext)
	if err != nil {
		return Overview{}, err
	}

	totalPoints := 0
	var myPosition *int
	for index := range ranking {
		ranking[index].Position = index + 1
		ranking[index].IsCurrentUser = ranking[index].UserID == tenantContext.UserID
		totalPoints += ranking[index].Points
		if ranking[index].IsCurrentUser {
			value := ranking[index].Position
			myPosition = &value
		}
	}

	return Overview{
		Ranking:      ranking,
		RecentEvents: events,
		History:      history,
		Missions:     missions,
		Performance:  performance,
		TotalPoints:  totalPoints,
		ActiveUsers:  len(ranking),
		TotalEvents:  totalEvents,
		MyPosition:   myPosition,
	}, nil
}

func (repo Repository) AdminSnapshot(ctx context.Context, tenantContext tenant.Context) (AdminSnapshot, error) {
	canManage := canManageGamification(tenantContext)

	rules, err := repo.rules(ctx, tenantContext)
	if err != nil {
		return AdminSnapshot{}, err
	}
	missions, err := repo.missions(ctx, tenantContext, false)
	if err != nil {
		return AdminSnapshot{}, err
	}
	myEntries, err := repo.manualEntries(ctx, tenantContext, tenantContext.UserID, false)
	if err != nil {
		return AdminSnapshot{}, err
	}

	snapshot := AdminSnapshot{
		Rules:           rules,
		Missions:        missions,
		MyManualEntries: myEntries,
		CanManage:       canManage,
	}

	if canManage {
		participants, err := repo.participants(ctx, tenantContext)
		if err != nil {
			return AdminSnapshot{}, err
		}
		seasons, err := repo.seasons(ctx, tenantContext)
		if err != nil {
			return AdminSnapshot{}, err
		}
		pending, err := repo.manualEntries(ctx, tenantContext, "", true)
		if err != nil {
			return AdminSnapshot{}, err
		}
		users, err := repo.users(ctx, tenantContext)
		if err != nil {
			return AdminSnapshot{}, err
		}
		snapshot.Participants = participants
		snapshot.Seasons = seasons
		snapshot.PendingManualEntries = pending
		snapshot.Users = users
	}

	return snapshot, nil
}

func (repo Repository) UpsertRule(ctx context.Context, tenantContext tenant.Context, actionType string, request RuleRequest) (Rule, error) {
	if !canManageGamification(tenantContext) {
		return Rule{}, tenant.ErrOrganizationAccessDenied
	}
	actionType = normalizeActionType(actionType)
	if actionType == "" || request.Points < 0 {
		return Rule{}, ErrInvalidInput
	}
	if ok, err := repo.tableExists(ctx, "gamification_rules"); err != nil {
		return Rule{}, err
	} else if !ok {
		return Rule{}, ErrNotReady
	}

	isActive := true
	if request.IsActive != nil {
		isActive = *request.IsActive
	}

	return scanRule(repo.db.Pool().QueryRow(ctx, `
		insert into public.gamification_rules (
			organization_id,
			action_type,
			points,
			is_active
		)
		values ($1::uuid, $2, $3, $4)
		on conflict (organization_id, action_type)
		do update set
			points = excluded.points,
			is_active = excluded.is_active,
			updated_at = now()
		returning id::text, action_type, points, is_active, false
	`, tenantContext.OrganizationID, actionType, request.Points, isActive))
}

func (repo Repository) SetParticipant(ctx context.Context, tenantContext tenant.Context, userID string, request ParticipantRequest) (Participant, error) {
	if !canManageGamification(tenantContext) {
		return Participant{}, tenant.ErrOrganizationAccessDenied
	}
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return Participant{}, ErrInvalidInput
	}
	if ok, err := repo.tableExists(ctx, "gamification_participants"); err != nil {
		return Participant{}, err
	} else if !ok {
		return Participant{}, ErrNotReady
	}

	tag, err := repo.db.Pool().Exec(ctx, `
		insert into public.gamification_participants (
			organization_id,
			user_id,
			participates
		)
		select $1::uuid, u.id, $3
		from public.users u
		where u.organization_id = $1::uuid
		  and u.id = $2::uuid
		on conflict (organization_id, user_id)
		do update set
			participates = excluded.participates,
			updated_at = now()
	`, tenantContext.OrganizationID, userID, request.Participates)
	if err != nil {
		return Participant{}, err
	}
	if tag.RowsAffected() == 0 {
		return Participant{}, ErrNotFound
	}

	participants, err := repo.participants(ctx, tenantContext)
	if err != nil {
		return Participant{}, err
	}
	for _, participant := range participants {
		if participant.UserID == userID {
			return participant, nil
		}
	}
	return Participant{}, ErrNotFound
}

func (repo Repository) CreateMission(ctx context.Context, tenantContext tenant.Context, request MissionRequest) (Mission, error) {
	if !canManageGamification(tenantContext) {
		return Mission{}, tenant.ErrOrganizationAccessDenied
	}
	input, err := normalizeMissionRequest(request)
	if err != nil {
		return Mission{}, err
	}

	hasExtended, err := repo.columnExists(ctx, "gamification_missions", "action_type")
	if err != nil {
		return Mission{}, err
	}
	isActive := true
	if input.IsActive != nil {
		isActive = *input.IsActive
	}

	if hasExtended {
		return repo.scanMission(repo.db.Pool().QueryRow(ctx, `
			insert into public.gamification_missions (
				organization_id,
				title,
				description,
				action_type,
				target_count,
				bonus_points,
				period,
				is_active,
				target_scope,
				target_user_id
			)
			values ($1::uuid, $2, $3, $4, $5, $6, $7, $8, $9, $10::uuid)
			returning `+missionSelectFields(true)+`
		`, tenantContext.OrganizationID, input.Title, input.Description, input.ActionType, input.TargetCount, input.BonusPoints, input.Period, isActive, input.TargetScope, input.TargetUserID), true)
	}

	return repo.scanMission(repo.db.Pool().QueryRow(ctx, `
		insert into public.gamification_missions (
			organization_id,
			title,
			description,
			target_count,
			bonus_points,
			period,
			is_active
		)
		values ($1::uuid, $2, $3, $4, $5, $6, $7)
		returning `+missionSelectFields(false)+`
	`, tenantContext.OrganizationID, input.Title, input.Description, input.TargetCount, input.BonusPoints, input.Period, isActive), false)
}

func (repo Repository) UpdateMission(ctx context.Context, tenantContext tenant.Context, missionID string, request MissionRequest) (Mission, error) {
	if !canManageGamification(tenantContext) {
		return Mission{}, tenant.ErrOrganizationAccessDenied
	}
	missionID = strings.TrimSpace(missionID)
	if missionID == "" {
		return Mission{}, ErrInvalidInput
	}
	input, err := normalizeMissionRequest(request)
	if err != nil {
		return Mission{}, err
	}
	hasExtended, err := repo.columnExists(ctx, "gamification_missions", "action_type")
	if err != nil {
		return Mission{}, err
	}
	isActive := true
	if input.IsActive != nil {
		isActive = *input.IsActive
	}

	if hasExtended {
		mission, err := repo.scanMission(repo.db.Pool().QueryRow(ctx, `
			update public.gamification_missions
			set title = $3,
			    description = $4,
			    action_type = $5,
			    target_count = $6,
			    bonus_points = $7,
			    period = $8,
			    is_active = $9,
			    target_scope = $10,
			    target_user_id = $11::uuid,
			    updated_at = now()
			where organization_id = $1::uuid
			  and id = $2::uuid
			returning `+missionSelectFields(true)+`
		`, tenantContext.OrganizationID, missionID, input.Title, input.Description, input.ActionType, input.TargetCount, input.BonusPoints, input.Period, isActive, input.TargetScope, input.TargetUserID), true)
		if errors.Is(err, pgx.ErrNoRows) {
			return Mission{}, ErrNotFound
		}
		return mission, err
	}

	mission, err := repo.scanMission(repo.db.Pool().QueryRow(ctx, `
		update public.gamification_missions
		set title = $3,
		    description = $4,
		    target_count = $5,
		    bonus_points = $6,
		    period = $7,
		    is_active = $8,
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
		returning `+missionSelectFields(false)+`
	`, tenantContext.OrganizationID, missionID, input.Title, input.Description, input.TargetCount, input.BonusPoints, input.Period, isActive), false)
	if errors.Is(err, pgx.ErrNoRows) {
		return Mission{}, ErrNotFound
	}
	return mission, err
}

func (repo Repository) DeleteMission(ctx context.Context, tenantContext tenant.Context, missionID string) error {
	if !canManageGamification(tenantContext) {
		return tenant.ErrOrganizationAccessDenied
	}
	missionID = strings.TrimSpace(missionID)
	if missionID == "" {
		return ErrInvalidInput
	}
	tag, err := repo.db.Pool().Exec(ctx, `
		delete from public.gamification_missions
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, tenantContext.OrganizationID, missionID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (repo Repository) CreateManualEntry(ctx context.Context, tenantContext tenant.Context, request ManualEntryRequest) (ManualEntry, error) {
	if ok, err := repo.tableExists(ctx, "gamification_manual_entries"); err != nil {
		return ManualEntry{}, err
	} else if !ok {
		return ManualEntry{}, ErrNotReady
	}
	actionKey := normalizeActionType(request.ActionKey)
	if actionKey == "" || request.Quantity < 1 || request.Quantity > 100 {
		return ManualEntry{}, ErrInvalidInput
	}
	notes := strings.TrimSpace(request.Notes)

	var entryID string
	if err := repo.db.Pool().QueryRow(ctx, `
		insert into public.gamification_manual_entries (
			organization_id,
			user_id,
			action_key,
			quantity,
			notes,
			status
		)
		values ($1::uuid, $2::uuid, $3, $4, nullif($5, ''), 'pending')
		returning id::text
	`, tenantContext.OrganizationID, tenantContext.UserID, actionKey, request.Quantity, notes).Scan(&entryID); err != nil {
		return ManualEntry{}, err
	}

	return repo.manualEntryByID(ctx, repo.db.Pool(), tenantContext, entryID, false)
}

func (repo Repository) DecideManualEntry(ctx context.Context, tenantContext tenant.Context, entryID string, request ManualEntryDecisionRequest) (ManualEntry, error) {
	if !canManageGamification(tenantContext) {
		return ManualEntry{}, tenant.ErrOrganizationAccessDenied
	}
	if ok, err := repo.tableExists(ctx, "gamification_manual_entries"); err != nil {
		return ManualEntry{}, err
	} else if !ok {
		return ManualEntry{}, ErrNotReady
	}
	entryID = strings.TrimSpace(entryID)
	status := strings.TrimSpace(request.Status)
	if entryID == "" || (status != "approved" && status != "rejected") {
		return ManualEntry{}, ErrInvalidInput
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return ManualEntry{}, err
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback(ctx)
		}
	}()

	var existing ManualEntry
	existing, err = scanManualEntry(tx.QueryRow(ctx, `
		select `+manualEntrySelectFields()+`
		from public.gamification_manual_entries gme
		left join public.users u on u.id = gme.user_id
		where gme.organization_id = $1::uuid
		  and gme.id = $2::uuid
		for update of gme
	`, tenantContext.OrganizationID, entryID))
	if errors.Is(err, pgx.ErrNoRows) {
		return ManualEntry{}, ErrNotFound
	}
	if err != nil {
		return ManualEntry{}, err
	}
	if existing.Status != "pending" {
		return ManualEntry{}, ErrInvalidInput
	}

	_, err = tx.Exec(ctx, `
		update public.gamification_manual_entries
		set status = $3,
		    approved_by = $4::uuid,
		    approved_at = now(),
		    rejection_reason = case when $3 = 'rejected' then nullif($5, '') else null end,
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, tenantContext.OrganizationID, entryID, status, tenantContext.UserID, strings.TrimSpace(request.Reason))
	if err != nil {
		return ManualEntry{}, err
	}

	if status == "approved" {
		if err = repo.recordGamificationEvent(ctx, tx, tenantContext, existing.UserID, existing.ActionKey, existing.Quantity, "manual_entry", existing.ID); err != nil {
			return ManualEntry{}, err
		}
	}

	entry, err := repo.manualEntryByID(ctx, tx, tenantContext, entryID, false)
	if err != nil {
		return ManualEntry{}, err
	}

	err = tx.Commit(ctx)
	if err != nil {
		return ManualEntry{}, err
	}
	return entry, nil
}

func (repo Repository) ResetSeason(ctx context.Context, tenantContext tenant.Context, request SeasonRequest) (Season, error) {
	if !canManageGamification(tenantContext) {
		return Season{}, tenant.ErrOrganizationAccessDenied
	}
	if ok, err := repo.tableExists(ctx, "gamification_seasons"); err != nil {
		return Season{}, err
	} else if !ok {
		return Season{}, ErrNotReady
	}
	name := strings.TrimSpace(request.Name)
	if name == "" {
		return Season{}, ErrInvalidInput
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return Season{}, err
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback(ctx)
		}
	}()

	if _, err = tx.Exec(ctx, `
		update public.gamification_seasons
		set is_active = false,
		    ended_at = coalesce(ended_at, now())
		where organization_id = $1::uuid
		  and is_active = true
	`, tenantContext.OrganizationID); err != nil {
		return Season{}, err
	}

	season, err := scanSeason(tx.QueryRow(ctx, `
		insert into public.gamification_seasons (
			organization_id,
			name,
			reset_reason,
			created_by
		)
		values ($1::uuid, $2, nullif($3, ''), $4::uuid)
		returning `+seasonSelectFields()+`
	`, tenantContext.OrganizationID, name, strings.TrimSpace(request.Reason), tenantContext.UserID))
	if err != nil {
		return Season{}, err
	}

	if _, err = tx.Exec(ctx, `
		update public.user_gamification_stats
		set total_points = 0,
		    points = 0,
		    xp = 0,
		    xp_total = 0,
		    xp_current_level = 0,
		    xp_next_level = 1000,
		    current_level = 1,
		    current_rank = 'Bronze',
		    rank_tier = 'Bronze',
		    streak_days = 0,
		    updated_at = now()
		where organization_id = $1::uuid
	`, tenantContext.OrganizationID); err != nil {
		return Season{}, err
	}

	err = tx.Commit(ctx)
	if err != nil {
		return Season{}, err
	}
	return season, nil
}

func (repo Repository) ranking(ctx context.Context, tenantContext tenant.Context) ([]RankingEntry, error) {
	hasParticipants, err := repo.tableExists(ctx, "gamification_participants")
	if err != nil {
		return nil, err
	}
	hasActivityLogs, err := repo.tableExists(ctx, "gamification_activity_logs")
	if err != nil {
		return nil, err
	}

	joinParticipants := ""
	participationFilter := ""
	if hasParticipants {
		joinParticipants = `
		left join public.gamification_participants gp
		  on gp.user_id = u.id
		 and gp.organization_id = u.organization_id`
		participationFilter = "and coalesce(gp.participates, true) = true"
	}
	activityJoin := ""
	activityPointsExpr := "0::int"
	activityLastExpr := "null::text"
	if hasActivityLogs {
		activityJoin = `
		left join (
			select
				organization_id,
				user_id,
				sum(coalesce(points_earned, 0))::int as total_points,
				max(created_at)::text as last_activity_at
			from public.gamification_activity_logs
			group by organization_id, user_id
		) gal
		  on gal.user_id = u.id
		 and gal.organization_id = u.organization_id`
		activityPointsExpr = "gal.total_points"
		activityLastExpr = "gal.last_activity_at"
	}

	rows, err := repo.db.Pool().Query(ctx, `
		select
			u.id::text,
			coalesce(nullif(u.name, ''), u.email, 'Usuario'),
			u.avatar_url,
			u.points,
			u.xp,
			ugs.current_level,
			ugs.current_rank,
			ugs.rank_tier,
			ugs.streak_days,
			ugs.total_points,
			ugs.xp,
			ugs.xp_current_level,
			ugs.xp_next_level,
			ugs.xp_total,
			ugs.last_activity_at::text,
			`+activityPointsExpr+`,
			`+activityLastExpr+`
		from public.users u
		left join public.user_gamification_stats ugs
		  on ugs.user_id = u.id
		 and ugs.organization_id = u.organization_id
		`+joinParticipants+`
		`+activityJoin+`
		where u.organization_id = $1::uuid
		  and coalesce(u.is_active, true) = true
		  `+participationFilter+`
	`, tenantContext.OrganizationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	ranking := []RankingEntry{}
	for rows.Next() {
		var entry RankingEntry
		var avatarURL, currentRank, rankTier, lastActivityAt, logLastActivityAt pgtype.Text
		var userPoints, userXP, level, streakDays, totalPoints, statXP, xpCurrent, xpNext, xpTotal, logPoints pgtype.Int4
		if err := rows.Scan(
			&entry.UserID,
			&entry.Name,
			&avatarURL,
			&userPoints,
			&userXP,
			&level,
			&currentRank,
			&rankTier,
			&streakDays,
			&totalPoints,
			&statXP,
			&xpCurrent,
			&xpNext,
			&xpTotal,
			&lastActivityAt,
			&logPoints,
			&logLastActivityAt,
		); err != nil {
			return nil, err
		}

		entry.AvatarURL = textPointer(avatarURL)
		entry.Points = maxPositiveInt(totalPoints, logPoints, userPoints)
		entry.XP = maxPositiveInt(xpTotal, statXP, userXP, logPoints)
		entry.Level = firstInt(level)
		if entry.Level <= 0 {
			entry.Level = fallbackLevel(entry.XP)
		}
		entry.Rank = firstText(currentRank, rankTier, "Bronze")
		entry.StreakDays = firstInt(streakDays)
		entry.XPCurrentLevel = firstInt(xpCurrent)
		if entry.XPCurrentLevel == 0 {
			entry.XPCurrentLevel = entry.XP % 1000
		}
		entry.XPNextLevel = firstInt(xpNext)
		if entry.XPNextLevel <= 0 {
			entry.XPNextLevel = 1000
		}
		entry.LastActivityAt = textPointer(firstTextValue(lastActivityAt, logLastActivityAt))
		ranking = append(ranking, entry)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	sort.SliceStable(ranking, func(i, j int) bool {
		if ranking[i].Points != ranking[j].Points {
			return ranking[i].Points > ranking[j].Points
		}
		return ranking[i].XP > ranking[j].XP
	})

	return ranking, nil
}

func (repo Repository) events(ctx context.Context, tenantContext tenant.Context, limit int, includeAll bool) ([]Event, int, error) {
	useActivityLogs, err := repo.useActivityLogs(ctx, tenantContext.OrganizationID)
	if err != nil {
		return nil, 0, err
	}

	totalEvents := 0
	if useActivityLogs {
		if err := repo.db.Pool().QueryRow(ctx, `
			select count(*)::int
			from public.gamification_activity_logs
			where organization_id = $1::uuid
		`, tenantContext.OrganizationID).Scan(&totalEvents); err != nil {
			return nil, 0, err
		}
	} else if err := repo.db.Pool().QueryRow(ctx, `
		select count(*)::int
		from public.gamification_events
		where organization_id = $1::uuid
	`, tenantContext.OrganizationID).Scan(&totalEvents); err != nil {
		return nil, 0, err
	}

	userFilter := ""
	if !includeAll {
		userFilter = ""
	}
	if limit <= 0 {
		limit = 12
	}

	var rows pgx.Rows
	if useActivityLogs {
		rows, err = repo.db.Pool().Query(ctx, `
			select
				gal.id::text,
				gal.user_id::text,
				coalesce(nullif(u.name, ''), u.email, 'Usuario'),
				gal.action_type,
				coalesce(gal.points_earned, 0),
				coalesce(gal.created_at, now())::text,
				coalesce(
					nullif(gal.metadata->>'details', ''),
					nullif(gal.metadata->>'notes', ''),
					nullif(gal.metadata->>'description', ''),
					nullif(gal.metadata->>'lead_name', ''),
					nullif(gal.metadata->>'title', '')
				),
				coalesce(nullif(gal.metadata->>'source_module', ''), 'gamification')
			from public.gamification_activity_logs gal
			left join public.users u on u.id = gal.user_id
			where gal.organization_id = $1::uuid
			`+userFilter+`
			order by gal.created_at desc nulls last
			limit $2
		`, tenantContext.OrganizationID, limit)
	} else {
		rows, err = repo.db.Pool().Query(ctx, `
		select
			ge.id::text,
			ge.user_id::text,
			coalesce(nullif(u.name, ''), u.email, 'Usuario'),
			ge.event_type,
			coalesce(ge.points_earned, 0),
			ge.created_at::text,
			coalesce(nullif(ge.metadata->>'details', ''), nullif(ge.metadata->>'notes', ''), nullif(ge.metadata->>'description', '')),
			coalesce(nullif(ge.metadata->>'source_module', ''), nullif(ge.metadata->>'source', ''))
		from public.gamification_events ge
		left join public.users u on u.id = ge.user_id
		where ge.organization_id = $1::uuid
		`+userFilter+`
		order by ge.created_at desc
		limit $2
	`, tenantContext.OrganizationID, limit)
	}
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	events := []Event{}
	for rows.Next() {
		event, err := scanEvent(rows)
		if err != nil {
			return nil, 0, err
		}
		events = append(events, event)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	return events, totalEvents, nil
}

func (repo Repository) missions(ctx context.Context, tenantContext tenant.Context, activeOnly bool) ([]Mission, error) {
	hasExtended, err := repo.columnExists(ctx, "gamification_missions", "action_type")
	if err != nil {
		return nil, err
	}
	where := "organization_id = $1::uuid"
	limit := ""
	if activeOnly {
		where += " and coalesce(is_active, true) = true"
		limit = " limit 6"
	}

	rows, err := repo.db.Pool().Query(ctx, `
		select `+missionSelectFields(hasExtended)+`
		from public.gamification_missions
		where `+where+`
		order by updated_at desc
		`+limit+`
	`, tenantContext.OrganizationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	missions := []Mission{}
	for rows.Next() {
		mission, err := repo.scanMission(rows, hasExtended)
		if err != nil {
			return nil, err
		}
		missions = append(missions, mission)
	}
	return missions, rows.Err()
}

func (repo Repository) performance(ctx context.Context, tenantContext tenant.Context) (Performance, error) {
	now := time.Now()
	startCurrentMonth := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
	startLastMonth := startCurrentMonth.AddDate(0, -1, 0)
	weekday := int(now.Weekday())
	if weekday == 0 {
		weekday = 7
	}
	startWeek := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()).AddDate(0, 0, -(weekday - 1))
	endWeek := startWeek.AddDate(0, 0, 7)

	useActivityLogs, err := repo.useActivityLogs(ctx, tenantContext.OrganizationID)
	if err != nil {
		return Performance{}, err
	}

	var rows pgx.Rows
	if useActivityLogs {
		rows, err = repo.db.Pool().Query(ctx, `
			select action_type, coalesce(points_earned, 0), coalesce(created_at, now())
			from public.gamification_activity_logs
			where organization_id = $1::uuid
			  and coalesce(created_at, now()) >= $2
		`, tenantContext.OrganizationID, startLastMonth)
	} else {
		rows, err = repo.db.Pool().Query(ctx, `
			select event_type, coalesce(points_earned, 0), coalesce(created_at, now())
			from public.gamification_events
			where organization_id = $1::uuid
			  and coalesce(created_at, now()) >= $2
		`, tenantContext.OrganizationID, startLastMonth)
	}
	if err != nil {
		return Performance{}, err
	}
	defer rows.Close()

	events := []eventPoint{}
	for rows.Next() {
		var item eventPoint
		if err := rows.Scan(&item.EventType, &item.Points, &item.CreatedAt); err != nil {
			return Performance{}, err
		}
		events = append(events, item)
	}
	if err := rows.Err(); err != nil {
		return Performance{}, err
	}

	labels := []string{"Seg", "Ter", "Qua", "Qui", "Sex", "Sab", "Dom"}
	chartData := make([]PerformanceDay, 7)
	for i := 0; i < 7; i++ {
		chartData[i] = PerformanceDay{Name: labels[i]}
	}

	thisMonthPoints := 0
	lastMonthPoints := 0
	thisMonthActions := 0
	positiveEvents := 0
	activeDays := map[string]bool{}
	distribution := map[string]int{
		"Ligacoes":         0,
		"Mensagens":        0,
		"Propostas/Vendas": 0,
		"Reunioes/Visitas": 0,
		"Lead/Outros":      0,
	}
	positiveTypes := map[string]bool{
		"sale_closed":         true,
		"contract_signed":     true,
		"proposal_sent":       true,
		"lost_lead_recovered": true,
		"contact_made":        true,
		"visit_scheduled":     true,
		"visit_confirmed":     true,
		"meeting_held":        true,
		"meeting_scheduled":   true,
		"property_created":    true,
	}

	for _, event := range events {
		if !event.CreatedAt.Before(startWeek) && event.CreatedAt.Before(endWeek) {
			index := int(event.CreatedAt.Weekday()) - 1
			if index < 0 {
				index = 6
			}
			chartData[index].Points += event.Points
			chartData[index].Actions++
		}

		if !event.CreatedAt.Before(startCurrentMonth) {
			thisMonthPoints += event.Points
			thisMonthActions++
			activeDays[event.CreatedAt.Format("2006-01-02")] = true
			if positiveTypes[event.EventType] {
				positiveEvents++
			}
			distribution[distributionBucket(event.EventType)]++
		} else {
			lastMonthPoints += event.Points
		}
	}

	growth := 0
	if lastMonthPoints == 0 {
		if thisMonthPoints > 0 {
			growth = 100
		}
	} else {
		growth = int(math.Round((float64(thisMonthPoints-lastMonthPoints) / float64(lastMonthPoints)) * 100))
	}
	dayOfMonth := now.Day()
	avgActions := 0.0
	if dayOfMonth > 0 {
		avgActions = math.Round((float64(thisMonthActions)/float64(dayOfMonth))*10) / 10
	}
	efficiency := 0
	if thisMonthActions > 0 {
		efficiency = int(math.Round((float64(positiveEvents) / float64(thisMonthActions)) * 100))
	}
	consistency := 0
	if dayOfMonth > 0 {
		consistency = int(math.Round((float64(len(activeDays)) / float64(dayOfMonth)) * 100))
	}

	return Performance{
		ChartData: chartData,
		Metrics: PerformanceMetrics{
			Points:           thisMonthPoints,
			Growth:           growth,
			AvgActionsPerDay: avgActions,
			TotalActions:     thisMonthActions,
			Efficiency:       efficiency,
			Consistency:      consistency,
		},
		Distribution: []ActivityDistribution{
			{Label: "Ligacoes", Value: distribution["Ligacoes"]},
			{Label: "Mensagens", Value: distribution["Mensagens"]},
			{Label: "Propostas/Vendas", Value: distribution["Propostas/Vendas"]},
			{Label: "Reunioes/Visitas", Value: distribution["Reunioes/Visitas"]},
			{Label: "Lead/Outros", Value: distribution["Lead/Outros"]},
		},
	}, nil
}

func (repo Repository) rules(ctx context.Context, tenantContext tenant.Context) ([]Rule, error) {
	out := append([]Rule{}, defaultRules()...)
	if ok, err := repo.tableExists(ctx, "gamification_rules"); err != nil {
		return nil, err
	} else if !ok {
		return out, nil
	}

	rows, err := repo.db.Pool().Query(ctx, `
		select id::text, action_type, points, is_active, false
		from public.gamification_rules
		where organization_id = $1::uuid
	`, tenantContext.OrganizationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	byAction := map[string]Rule{}
	for _, rule := range out {
		byAction[rule.ActionType] = rule
	}
	for rows.Next() {
		rule, err := scanRule(rows)
		if err != nil {
			return nil, err
		}
		byAction[rule.ActionType] = rule
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	out = out[:0]
	for _, base := range defaultRules() {
		out = append(out, byAction[base.ActionType])
		delete(byAction, base.ActionType)
	}
	for _, rule := range byAction {
		out = append(out, rule)
	}
	return out, nil
}

func (repo Repository) participants(ctx context.Context, tenantContext tenant.Context) ([]Participant, error) {
	hasParticipants, err := repo.tableExists(ctx, "gamification_participants")
	if err != nil {
		return nil, err
	}
	join := ""
	participatesExpr := "true"
	if hasParticipants {
		join = `
		left join public.gamification_participants gp
		  on gp.organization_id = u.organization_id
		 and gp.user_id = u.id`
		participatesExpr = "coalesce(gp.participates, true)"
	}

	rows, err := repo.db.Pool().Query(ctx, `
		select
			u.id::text,
			coalesce(nullif(u.name, ''), u.email, 'Usuario'),
			coalesce(u.email, ''),
			coalesce(u.role, ''),
			coalesce(u.is_active, true),
			`+participatesExpr+`,
			coalesce(ugs.total_points, u.points, 0)
		from public.users u
		left join public.user_gamification_stats ugs
		  on ugs.organization_id = u.organization_id
		 and ugs.user_id = u.id
		`+join+`
		where u.organization_id = $1::uuid
		  and coalesce(u.is_active, true) = true
		order by coalesce(nullif(u.name, ''), u.email, 'Usuario')
	`, tenantContext.OrganizationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []Participant{}
	for rows.Next() {
		var participant Participant
		if err := rows.Scan(
			&participant.UserID,
			&participant.Name,
			&participant.Email,
			&participant.Role,
			&participant.IsActive,
			&participant.Participates,
			&participant.Points,
		); err != nil {
			return nil, err
		}
		out = append(out, participant)
	}
	return out, rows.Err()
}

func (repo Repository) seasons(ctx context.Context, tenantContext tenant.Context) ([]Season, error) {
	if ok, err := repo.tableExists(ctx, "gamification_seasons"); err != nil {
		return nil, err
	} else if !ok {
		return []Season{}, nil
	}

	rows, err := repo.db.Pool().Query(ctx, `
		select `+seasonSelectFields()+`
		from public.gamification_seasons
		where organization_id = $1::uuid
		order by started_at desc, created_at desc
	`, tenantContext.OrganizationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	seasons := []Season{}
	for rows.Next() {
		season, err := scanSeason(rows)
		if err != nil {
			return nil, err
		}
		seasons = append(seasons, season)
	}
	return seasons, rows.Err()
}

func (repo Repository) manualEntries(ctx context.Context, tenantContext tenant.Context, userID string, pendingOnly bool) ([]ManualEntry, error) {
	if ok, err := repo.tableExists(ctx, "gamification_manual_entries"); err != nil {
		return nil, err
	} else if !ok {
		return []ManualEntry{}, nil
	}

	args := []any{tenantContext.OrganizationID}
	where := "gme.organization_id = $1::uuid"
	if pendingOnly {
		where += " and gme.status = 'pending'"
	} else if strings.TrimSpace(userID) != "" {
		args = append(args, userID)
		where += " and gme.user_id = $2::uuid"
	}

	rows, err := repo.db.Pool().Query(ctx, `
		select `+manualEntrySelectFields()+`
		from public.gamification_manual_entries gme
		left join public.users u on u.id = gme.user_id
		where `+where+`
		order by gme.created_at desc
		limit 20
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := []ManualEntry{}
	for rows.Next() {
		entry, err := scanManualEntry(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, entry)
	}
	return out, rows.Err()
}

func (repo Repository) manualEntryByID(ctx context.Context, query queryRower, tenantContext tenant.Context, entryID string, forUpdate bool) (ManualEntry, error) {
	lock := ""
	if forUpdate {
		lock = " for update of gme"
	}
	entry, err := scanManualEntry(query.QueryRow(ctx, `
		select `+manualEntrySelectFields()+`
		from public.gamification_manual_entries gme
		left join public.users u on u.id = gme.user_id
		where gme.organization_id = $1::uuid
		  and gme.id = $2::uuid
		`+lock+`
	`, tenantContext.OrganizationID, entryID))
	if errors.Is(err, pgx.ErrNoRows) {
		return ManualEntry{}, ErrNotFound
	}
	return entry, err
}

func (repo Repository) users(ctx context.Context, tenantContext tenant.Context) ([]UserOption, error) {
	rows, err := repo.db.Pool().Query(ctx, `
		select id::text, coalesce(nullif(name, ''), email, 'Usuario')
		from public.users
		where organization_id = $1::uuid
		  and coalesce(is_active, true) = true
		order by coalesce(nullif(name, ''), email, 'Usuario')
	`, tenantContext.OrganizationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	users := []UserOption{}
	for rows.Next() {
		var user UserOption
		if err := rows.Scan(&user.ID, &user.Name); err != nil {
			return nil, err
		}
		users = append(users, user)
	}
	return users, rows.Err()
}

// RecordAction is the public interface for other modules to award gamification points
// for automated CRM actions like making a call or completing a task.
func (repo Repository) RecordAction(ctx context.Context, tenantContext tenant.Context, actionType string, quantity int, referenceID string) error {
	actionType = normalizeActionType(actionType)
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	err = repo.recordGamificationEvent(ctx, tx, tenantContext, tenantContext.UserID, actionType, quantity, "system_action", referenceID)
	if err != nil {
		return err
	}

	return tx.Commit(ctx)
}

func (repo Repository) recordGamificationEvent(ctx context.Context, tx pgx.Tx, tenantContext tenant.Context, userID string, actionType string, quantity int, source string, referenceID string) error {
	actionType = normalizeActionType(actionType)
	points := repo.rulePoints(ctx, tx, tenantContext.OrganizationID, actionType)
	total := points * quantity
	if total <= 0 {
		return nil
	}

	metadata := jsonb(map[string]any{
		"count":         quantity,
		"unit_points":   points,
		"source_module": source,
		"reference_id":  referenceID,
	})
	referenceUUID := uuidTextOrNil(referenceID)
	idempotencyKey := gamificationIdempotencyKey(actionType, referenceID, quantity, userID)

	if ok, err := repo.tableExists(ctx, "gamification_activity_logs"); err != nil {
		return err
	} else if ok {
		_, err = tx.Exec(ctx, `
			insert into public.gamification_activity_logs (
				organization_id,
				user_id,
				action_type,
				points_earned,
				reference_id,
				metadata,
				idempotency_key,
				quantity,
				xp_awarded
			)
			values ($1::uuid, $2::uuid, $3, $4, $5::uuid, $6::jsonb, $7, $8, $4)
			on conflict (idempotency_key) do nothing
		`, tenantContext.OrganizationID, userID, actionType, total, referenceUUID, metadata, idempotencyKey, quantity)
		if err != nil {
			return err
		}
	}

	_, err := tx.Exec(ctx, `
		insert into public.gamification_events (
			organization_id,
			user_id,
			event_type,
			points_earned,
			metadata
		)
		values (
			$1::uuid,
			$2::uuid,
			$3,
			$4,
			$5::jsonb
		)
	`, tenantContext.OrganizationID, userID, actionType, total, metadata)
	if err != nil {
		return err
	}

	_, err = tx.Exec(ctx, `
		insert into public.user_gamification_stats (
			organization_id,
			user_id,
			total_points,
			points,
			xp,
			xp_total,
			xp_current_level,
			xp_next_level,
			current_level,
			last_activity_at
		)
		values (
			$1::uuid,
			$2::uuid,
			$3,
			$3,
			$3,
			$3,
			$3 % 1000,
			1000,
			greatest(1, ($3 / 1000) + 1),
			now()
		)
		on conflict (organization_id, user_id)
		do update set
			total_points = public.user_gamification_stats.total_points + excluded.total_points,
			points = public.user_gamification_stats.points + excluded.points,
			xp = public.user_gamification_stats.xp + excluded.xp,
			xp_total = public.user_gamification_stats.xp_total + excluded.xp_total,
			xp_current_level = (public.user_gamification_stats.xp_total + excluded.xp_total) % 1000,
			xp_next_level = 1000,
			current_level = greatest(1, ((public.user_gamification_stats.xp_total + excluded.xp_total) / 1000) + 1),
			last_activity_at = now(),
			updated_at = now()
	`, tenantContext.OrganizationID, userID, total)
	return err
}

func (repo Repository) useActivityLogs(ctx context.Context, organizationID string) (bool, error) {
	ok, err := repo.tableExists(ctx, "gamification_activity_logs")
	if err != nil || !ok {
		return false, err
	}

	count := 0
	if err := repo.db.Pool().QueryRow(ctx, `
		select count(*)::int
		from public.gamification_activity_logs
		where organization_id = $1::uuid
	`, organizationID).Scan(&count); err != nil {
		return false, err
	}
	return count > 0, nil
}

func (repo Repository) rulePoints(ctx context.Context, tx pgx.Tx, organizationID string, actionType string) int {
	actionType = normalizeActionType(actionType)
	if ok, err := repo.tableExists(ctx, "gamification_rules"); err != nil || !ok {
		return defaultRulePoints(actionType)
	}
	points := 0
	err := tx.QueryRow(ctx, `
		select points
		from public.gamification_rules
		where organization_id = $1::uuid
		  and action_type = $2
		  and is_active = true
	`, organizationID, actionType).Scan(&points)
	if err != nil || points <= 0 {
		return defaultRulePoints(actionType)
	}
	return points
}

func (repo Repository) tableExists(ctx context.Context, table string) (bool, error) {
	var exists bool
	err := repo.db.Pool().QueryRow(ctx, `select to_regclass($1) is not null`, "public."+table).Scan(&exists)
	return exists, err
}

func (repo Repository) columnExists(ctx context.Context, table string, column string) (bool, error) {
	var exists bool
	err := repo.db.Pool().QueryRow(ctx, `
		select exists (
			select 1
			from information_schema.columns
			where table_schema = 'public'
			  and table_name = $1
			  and column_name = $2
		)
	`, table, column).Scan(&exists)
	return exists, err
}

func scanEvent(row interface{ Scan(dest ...any) error }) (Event, error) {
	var event Event
	var userID, createdAt, details, source pgtype.Text
	if err := row.Scan(
		&event.ID,
		&userID,
		&event.UserName,
		&event.EventType,
		&event.Points,
		&createdAt,
		&details,
		&source,
	); err != nil {
		return Event{}, err
	}
	event.UserID = textPointer(userID)
	if event.UserID == nil {
		event.UserName = "Sistema"
	}
	event.CreatedAt = textPointer(createdAt)
	event.Details = textPointer(details)
	event.Source = textPointer(source)
	event.EventType = normalizeActionType(event.EventType)
	return event, nil
}

func (repo Repository) scanMission(row interface{ Scan(dest ...any) error }, hasExtended bool) (Mission, error) {
	var mission Mission
	var description, actionType, period, targetUserID, createdAt, updatedAt pgtype.Text
	if hasExtended {
		if err := row.Scan(
			&mission.ID,
			&mission.Title,
			&description,
			&actionType,
			&mission.TargetCount,
			&mission.CurrentProgress,
			&mission.BonusPoints,
			&period,
			&mission.IsActive,
			&mission.TargetScope,
			&targetUserID,
			&createdAt,
			&updatedAt,
		); err != nil {
			return Mission{}, err
		}
	} else {
		if err := row.Scan(
			&mission.ID,
			&mission.Title,
			&description,
			&mission.TargetCount,
			&mission.CurrentProgress,
			&mission.BonusPoints,
			&period,
			&mission.IsActive,
			&createdAt,
			&updatedAt,
		); err != nil {
			return Mission{}, err
		}
		mission.TargetScope = "organization"
	}
	mission.Description = textPointer(description)
	mission.ActionType = textPointer(actionType)
	mission.Period = textPointer(period)
	mission.TargetUserID = textPointer(targetUserID)
	mission.CreatedAt = textPointer(createdAt)
	mission.UpdatedAt = textPointer(updatedAt)
	if mission.TargetScope == "" {
		mission.TargetScope = "organization"
	}
	return mission, nil
}

func scanRule(row interface{ Scan(dest ...any) error }) (Rule, error) {
	var rule Rule
	if err := row.Scan(&rule.ID, &rule.ActionType, &rule.Points, &rule.IsActive, &rule.IsTemp); err != nil {
		return Rule{}, err
	}
	return rule, nil
}

func scanSeason(row interface{ Scan(dest ...any) error }) (Season, error) {
	var season Season
	var resetReason, startedAt, endedAt, createdAt pgtype.Text
	if err := row.Scan(&season.ID, &season.Name, &resetReason, &season.IsActive, &startedAt, &endedAt, &createdAt); err != nil {
		return Season{}, err
	}
	season.ResetReason = textPointer(resetReason)
	season.StartedAt = textPointer(startedAt)
	season.EndedAt = textPointer(endedAt)
	season.CreatedAt = textPointer(createdAt)
	return season, nil
}

func scanManualEntry(row interface{ Scan(dest ...any) error }) (ManualEntry, error) {
	var entry ManualEntry
	var notes, approvedBy, approvedAt, rejectionReason, createdAt pgtype.Text
	if err := row.Scan(
		&entry.ID,
		&entry.UserID,
		&entry.UserName,
		&entry.ActionKey,
		&entry.Quantity,
		&notes,
		&entry.Status,
		&approvedBy,
		&approvedAt,
		&rejectionReason,
		&createdAt,
	); err != nil {
		return ManualEntry{}, err
	}
	entry.Notes = textPointer(notes)
	entry.ApprovedBy = textPointer(approvedBy)
	entry.ApprovedAt = textPointer(approvedAt)
	entry.RejectionReason = textPointer(rejectionReason)
	entry.CreatedAt = textPointer(createdAt)
	entry.ActionKey = normalizeActionType(entry.ActionKey)
	return entry, nil
}

func missionSelectFields(hasExtended bool) string {
	if hasExtended {
		return `
			id::text,
			title,
			description,
			action_type,
			target_count,
			coalesce(current_progress, 0),
			bonus_points,
			period,
			coalesce(is_active, true),
			coalesce(target_scope, 'organization'),
			target_user_id::text,
			created_at::text,
			updated_at::text`
	}
	return `
		id::text,
		title,
		description,
		target_count,
		coalesce(current_progress, 0),
		bonus_points,
		period,
		coalesce(is_active, true),
		created_at::text,
		updated_at::text`
}

func seasonSelectFields() string {
	return `
		id::text,
		name,
		reset_reason,
		is_active,
		started_at::text,
		ended_at::text,
		created_at::text`
}

func manualEntrySelectFields() string {
	return `
		gme.id::text,
		gme.user_id::text,
		coalesce(nullif(u.name, ''), u.email, 'Usuario'),
		gme.action_key,
		gme.quantity,
		gme.notes,
		gme.status,
		gme.approved_by::text,
		gme.approved_at::text,
		gme.rejection_reason,
		gme.created_at::text`
}

func normalizeMissionRequest(request MissionRequest) (MissionRequest, error) {
	request.Title = strings.TrimSpace(request.Title)
	if request.Title == "" || request.TargetCount < 1 || request.BonusPoints < 0 {
		return MissionRequest{}, ErrInvalidInput
	}
	if request.Description != nil {
		value := strings.TrimSpace(*request.Description)
		if value == "" {
			request.Description = nil
		} else {
			request.Description = &value
		}
	}
	if request.ActionType != nil {
		value := normalizeActionType(*request.ActionType)
		if value == "" {
			request.ActionType = nil
		} else {
			request.ActionType = &value
		}
	}
	if request.Period != nil {
		value := strings.TrimSpace(*request.Period)
		if value == "" {
			request.Period = nil
		} else {
			request.Period = &value
		}
	}
	request.TargetScope = strings.TrimSpace(request.TargetScope)
	if request.TargetScope == "" {
		request.TargetScope = "organization"
	}
	if request.TargetScope != "organization" && request.TargetScope != "user" {
		return MissionRequest{}, ErrInvalidInput
	}
	if request.TargetScope == "organization" {
		request.TargetUserID = nil
	}
	if request.TargetScope == "user" && (request.TargetUserID == nil || strings.TrimSpace(*request.TargetUserID) == "") {
		return MissionRequest{}, ErrInvalidInput
	}
	if request.TargetUserID != nil {
		value := strings.TrimSpace(*request.TargetUserID)
		request.TargetUserID = &value
	}
	return request, nil
}

func normalizeActionType(actionType string) string {
	key := strings.ToLower(strings.TrimSpace(actionType))
	key = strings.ReplaceAll(key, " ", "_")
	key = strings.ReplaceAll(key, "-", "_")
	switch key {
	case "ligacao_realizada", "ligacao", "call":
		return "call_made"
	case "mensagem", "mensagem_enviada", "whatsapp_message", "message":
		return "message_sent"
	case "contato_efetivo", "contato":
		return "contact_made"
	case "visita_agendada":
		return "visit_scheduled"
	case "visita_realizada", "visita_confirmada":
		return "visit_confirmed"
	case "reuniao_agendada":
		return "meeting_scheduled"
	case "reuniao_realizada":
		return "meeting_held"
	case "proposta_enviada":
		return "proposal_sent"
	case "venda_concluida", "lead_ganho", "ganho":
		return "sale_closed"
	case "contrato_assinado":
		return "contract_signed"
	case "lead_criado", "novo_lead":
		return "lead_created"
	case "lead_manual", "lead_criado_manual":
		return "lead_created_manual"
	case "imovel_captado", "imovel_criado":
		return "property_created"
	case "lead_recuperado", "recuperar_lead_perdido", "lost_lead_reopened":
		return "lost_lead_recovered"
	default:
		return key
	}
}

func distributionBucket(eventType string) string {
	eventType = normalizeActionType(eventType)
	switch eventType {
	case "call_made":
		return "Ligacoes"
	case "message_sent":
		return "Mensagens"
	case "sale_closed", "contract_signed", "proposal_sent":
		return "Propostas/Vendas"
	case "visit_scheduled", "visit_confirmed", "meeting_held", "meeting_scheduled":
		return "Reunioes/Visitas"
	default:
		return "Lead/Outros"
	}
}

func canManageGamification(tenantContext tenant.Context) bool {
	return tenantContext.HasPermission("gamification_manage")
}

func defaultRules() []Rule {
	return []Rule{
		{ID: "default-call_made", ActionType: "call_made", Points: 5, IsActive: true, IsTemp: true},
		{ID: "default-message_sent", ActionType: "message_sent", Points: 2, IsActive: true, IsTemp: true},
		{ID: "default-contact_made", ActionType: "contact_made", Points: 3, IsActive: true, IsTemp: true},
		{ID: "default-visit_scheduled", ActionType: "visit_scheduled", Points: 20, IsActive: true, IsTemp: true},
		{ID: "default-visit_confirmed", ActionType: "visit_confirmed", Points: 35, IsActive: true, IsTemp: true},
		{ID: "default-meeting_scheduled", ActionType: "meeting_scheduled", Points: 10, IsActive: true, IsTemp: true},
		{ID: "default-meeting_held", ActionType: "meeting_held", Points: 25, IsActive: true, IsTemp: true},
		{ID: "default-proposal_sent", ActionType: "proposal_sent", Points: 30, IsActive: true, IsTemp: true},
		{ID: "default-sale_closed", ActionType: "sale_closed", Points: 500, IsActive: true, IsTemp: true},
		{ID: "default-contract_signed", ActionType: "contract_signed", Points: 250, IsActive: true, IsTemp: true},
		{ID: "default-lost_lead_recovered", ActionType: "lost_lead_recovered", Points: 20, IsActive: true, IsTemp: true},
		{ID: "default-lead_created", ActionType: "lead_created", Points: 10, IsActive: true, IsTemp: true},
		{ID: "default-lead_created_manual", ActionType: "lead_created_manual", Points: 10, IsActive: true, IsTemp: true},
		{ID: "default-property_created", ActionType: "property_created", Points: 50, IsActive: true, IsTemp: true},
		{ID: "default-prospecting_report", ActionType: "prospecting_report", Points: 10, IsActive: true, IsTemp: true},
	}
}

func defaultRulePoints(actionType string) int {
	actionType = normalizeActionType(actionType)
	for _, rule := range defaultRules() {
		if rule.ActionType == actionType && rule.IsActive {
			return rule.Points
		}
	}
	return 10
}

func firstInt(values ...pgtype.Int4) int {
	for _, value := range values {
		if value.Valid {
			return int(value.Int32)
		}
	}
	return 0
}

func maxPositiveInt(values ...pgtype.Int4) int {
	maxValue := 0
	for _, value := range values {
		if value.Valid && int(value.Int32) > maxValue {
			maxValue = int(value.Int32)
		}
	}
	return maxValue
}

func firstTextValue(values ...pgtype.Text) pgtype.Text {
	for _, value := range values {
		if value.Valid && value.String != "" {
			return value
		}
	}
	return pgtype.Text{}
}

func firstText(values ...any) string {
	fallback := "Bronze"
	for _, value := range values {
		switch typed := value.(type) {
		case pgtype.Text:
			if typed.Valid && typed.String != "" {
				return typed.String
			}
		case string:
			if typed != "" {
				fallback = typed
			}
		}
	}
	return fallback
}

func fallbackLevel(xp int) int {
	level := xp/1000 + 1
	if level < 1 {
		return 1
	}
	return level
}

func textPointer(value pgtype.Text) *string {
	if !value.Valid || value.String == "" {
		return nil
	}
	return &value.String
}

func jsonb(value any) string {
	payload, err := json.Marshal(value)
	if err != nil {
		return "{}"
	}

	return string(payload)
}

func gamificationIdempotencyKey(actionType string, referenceID string, quantity int, userID string) string {
	return strings.Join([]string{
		normalizeActionType(actionType),
		strings.TrimSpace(referenceID),
		strconv.Itoa(quantity),
		strings.TrimSpace(userID),
	}, "_")
}

func uuidTextOrNil(value string) *string {
	text := strings.TrimSpace(value)
	if len(text) != 36 {
		return nil
	}
	for index, char := range text {
		switch index {
		case 8, 13, 18, 23:
			if char != '-' {
				return nil
			}
		default:
			if !isUUIDHex(char) {
				return nil
			}
		}
	}
	return &text
}

func isUUIDHex(char rune) bool {
	return (char >= '0' && char <= '9') || (char >= 'a' && char <= 'f') || (char >= 'A' && char <= 'F')
}
