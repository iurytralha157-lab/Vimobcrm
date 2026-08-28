package gamification

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"sort"
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
	EventType    string
	Points       int64
	Actions      int
	OccurredDate string
}

type eventPageRow struct {
	Event      Event
	OccurredAt time.Time
}

type missionStructure struct {
	ActionType   string
	TargetCount  int64
	BonusPoints  int64
	Period       string
	TargetScope  string
	TargetUserID string
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
	events, totalEvents, err := repo.events(ctx, tenantContext, 12)
	if err != nil {
		return Overview{}, err
	}
	// Kept for response compatibility. Full history is cursor-paginated by
	// EventPage and must never be duplicated inside the overview payload.
	history := []Event{}
	missions, err := repo.missions(ctx, tenantContext, true)
	if err != nil {
		return Overview{}, err
	}
	performance, err := repo.performance(ctx, tenantContext)
	if err != nil {
		return Overview{}, err
	}

	var totalPoints int64
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

	myEntries, err := repo.manualEntries(ctx, tenantContext, tenantContext.UserID, false)
	if err != nil {
		return AdminSnapshot{}, err
	}

	snapshot := AdminSnapshot{
		Rules:                []Rule{},
		Missions:             []Mission{},
		Participants:         []Participant{},
		Seasons:              []Season{},
		MyManualEntries:      myEntries,
		PendingManualEntries: []ManualEntry{},
		Users:                []UserOption{},
		CanManage:            canManage,
	}

	if canManage {
		rules, err := repo.rules(ctx, tenantContext)
		if err != nil {
			return AdminSnapshot{}, err
		}
		missions, err := repo.missions(ctx, tenantContext, false)
		if err != nil {
			return AdminSnapshot{}, err
		}
		participants, err := repo.participants(ctx, tenantContext)
		if err != nil {
			return AdminSnapshot{}, err
		}
		seasons, err := repo.seasons(ctx, tenantContext)
		if err != nil {
			return AdminSnapshot{}, err
		}
		adminQueue, err := repo.manualEntries(ctx, tenantContext, "", true)
		if err != nil {
			return AdminSnapshot{}, err
		}
		users, err := repo.users(ctx, tenantContext)
		if err != nil {
			return AdminSnapshot{}, err
		}
		snapshot.Rules = rules
		snapshot.Missions = missions
		snapshot.Participants = participants
		snapshot.Seasons = seasons
		snapshot.PendingManualEntries = adminQueue
		snapshot.Users = users
	}

	return snapshot, nil
}

func (repo Repository) UpsertRule(ctx context.Context, tenantContext tenant.Context, actionType string, request RuleRequest) (Rule, error) {
	if !canManageGamification(tenantContext) {
		return Rule{}, tenant.ErrOrganizationAccessDenied
	}
	actionType = normalizeActionType(actionType)
	if actionType == "" || request.Points < 0 || request.Points > 100_000 {
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
	if !isUUIDText(userID) {
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
		join public.organization_members om
		  on om.user_id = u.id
		 and om.organization_id = $1::uuid
		where u.id = $2::uuid
		  and coalesce(u.is_active, false) = true
		  and coalesce(om.is_active, false) = true
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

	if input.TargetUserID != nil {
		isMember, memberErr := repo.isActiveOrganizationMember(ctx, tenantContext.OrganizationID, *input.TargetUserID)
		if memberErr != nil {
			return Mission{}, memberErr
		}
		if !isMember {
			return Mission{}, ErrNotFound
		}
	}
	isActive := true
	if input.IsActive != nil {
		isActive = *input.IsActive
	}

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

func (repo Repository) UpdateMission(ctx context.Context, tenantContext tenant.Context, missionID string, request MissionRequest) (Mission, error) {
	if !canManageGamification(tenantContext) {
		return Mission{}, tenant.ErrOrganizationAccessDenied
	}
	missionID = strings.TrimSpace(missionID)
	if !isUUIDText(missionID) {
		return Mission{}, ErrInvalidInput
	}
	input, err := normalizeMissionRequest(request)
	if err != nil {
		return Mission{}, err
	}
	if input.TargetUserID != nil {
		isMember, memberErr := repo.isActiveOrganizationMember(ctx, tenantContext.OrganizationID, *input.TargetUserID)
		if memberErr != nil {
			return Mission{}, memberErr
		}
		if !isMember {
			return Mission{}, ErrNotFound
		}
	}
	isActive := true
	if input.IsActive != nil {
		isActive = *input.IsActive
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return Mission{}, err
	}
	defer tx.Rollback(ctx)

	var existing missionStructure
	var hasProgress bool
	err = tx.QueryRow(ctx, `
		select
			coalesce(action_type, ''),
			target_count::bigint,
			bonus_points::bigint,
			coalesce(period, 'season'),
			target_scope,
			coalesce(target_user_id::text, ''),
			exists (
				select 1
				from public.gamification_mission_progress progress
				where progress.organization_id = mission.organization_id
				  and progress.mission_id = mission.id
			)
		from public.gamification_missions mission
		where mission.organization_id = $1::uuid
		  and mission.id = $2::uuid
		for update of mission
	`, tenantContext.OrganizationID, missionID).Scan(
		&existing.ActionType,
		&existing.TargetCount,
		&existing.BonusPoints,
		&existing.Period,
		&existing.TargetScope,
		&existing.TargetUserID,
		&hasProgress,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return Mission{}, ErrNotFound
	}
	if err != nil {
		return Mission{}, err
	}

	nextStructure := missionStructure{
		ActionType:   pointerValue(input.ActionType),
		TargetCount:  input.TargetCount,
		BonusPoints:  input.BonusPoints,
		Period:       pointerValue(input.Period),
		TargetScope:  input.TargetScope,
		TargetUserID: pointerValue(input.TargetUserID),
	}
	if hasProgress && missionStructureChanged(existing, nextStructure) {
		return Mission{}, ErrInvalidInput
	}

	mission, err := repo.scanMission(tx.QueryRow(ctx, `
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
	if err != nil {
		return Mission{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Mission{}, err
	}
	return mission, nil
}

func (repo Repository) DeleteMission(ctx context.Context, tenantContext tenant.Context, missionID string) error {
	if !canManageGamification(tenantContext) {
		return tenant.ErrOrganizationAccessDenied
	}
	missionID = strings.TrimSpace(missionID)
	if !isUUIDText(missionID) {
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
	if len(notes) > 2000 {
		return ManualEntry{}, ErrInvalidInput
	}

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
	if !isUUIDText(entryID) || len(strings.TrimSpace(request.Reason)) > 2000 || (status != "approved" && status != "rejected") {
		return ManualEntry{}, ErrInvalidInput
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return ManualEntry{}, err
	}
	defer tx.Rollback(ctx)

	var existing ManualEntry
	existing, err = scanManualEntry(tx.QueryRow(ctx, `
		select `+manualEntrySelectFields()+`
		from public.gamification_manual_entries gme
		left join public.users u on u.id = gme.user_id
		left join public.gamification_outbox goq
		  on goq.organization_id = gme.organization_id
		 and goq.id = gme.outbox_id
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
	if err = validateManualEntryTransition(existing.Status, status, request.Reason); err != nil {
		return ManualEntry{}, err
	}

	var outboxID *string
	if status == "approved" {
		var queuedID string
		queuedID, err = repo.enqueueActionTx(
			ctx,
			tx,
			tenantContext.OrganizationID,
			existing.UserID,
			existing.ActionKey,
			existing.Quantity,
			"manual_entry",
			existing.ID,
			map[string]any{"manual_entry_id": existing.ID},
		)
		if err != nil {
			return ManualEntry{}, err
		}
		if queuedID == "" {
			return ManualEntry{}, ErrNotReady
		}
		outboxID = &queuedID
	}

	_, err = tx.Exec(ctx, `
		update public.gamification_manual_entries
		set status = $3,
		    approved_by = $4::uuid,
		    approved_at = now(),
		    rejection_reason = case when $3 = 'rejected' then nullif($5, '') else null end,
		    outbox_id = $6::uuid,
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
		  and status = 'pending'
	`, tenantContext.OrganizationID, entryID, status, tenantContext.UserID, strings.TrimSpace(request.Reason), outboxID)
	if err != nil {
		return ManualEntry{}, err
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
	reason := strings.TrimSpace(request.Reason)
	if len(name) < 2 || len(name) > 180 || len(reason) < 2 || len(reason) > 2000 {
		return Season{}, ErrInvalidInput
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return Season{}, err
	}
	defer tx.Rollback(ctx)

	var moduleEnabled bool
	err = tx.QueryRow(ctx, `
		select is_enabled
		from public.organization_modules
		where organization_id = $1::uuid
		  and module_name = 'gamification'
		for update
	`, tenantContext.OrganizationID).Scan(&moduleEnabled)
	if errors.Is(err, pgx.ErrNoRows) {
		return Season{}, ErrNotReady
	}
	if err != nil {
		return Season{}, err
	}
	if !moduleEnabled {
		return Season{}, ErrNotReady
	}

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
	`, tenantContext.OrganizationID, name, reason, tenantContext.UserID))
	if err != nil {
		return Season{}, err
	}

	err = tx.Commit(ctx)
	if err != nil {
		return Season{}, err
	}
	return season, nil
}

func (repo Repository) ranking(ctx context.Context, tenantContext tenant.Context) ([]RankingEntry, error) {
	rows, err := repo.db.Pool().Query(ctx, `
		select
			u.id::text,
			coalesce(nullif(u.name, ''), u.email, 'Usuario'),
			u.avatar_url,
			coalesce(ugs.total_points, 0),
			coalesce(ugs.xp_total, 0),
			coalesce(ugs.current_level, 1),
			coalesce(nullif(ugs.current_rank, ''), nullif(ugs.rank_tier, ''), 'Bronze'),
			case
			  when (ugs.last_activity_at at time zone 'America/Sao_Paulo')::date
			       >= (now() at time zone 'America/Sao_Paulo')::date - 1
			    then coalesce(ugs.streak_days, 0)
			  else 0
			end,
			coalesce(ugs.xp_current_level, 0),
			coalesce(ugs.xp_next_level, 1000),
			ugs.last_activity_at::text
		from public.users u
		join public.organization_members om
		  on om.user_id = u.id
		 and om.organization_id = $1::uuid
		join public.gamification_seasons season
		  on season.organization_id = om.organization_id
		 and season.is_active = true
		left join public.user_gamification_stats ugs
		  on ugs.user_id = u.id
		 and ugs.organization_id = om.organization_id
		 and ugs.season_id = season.id
		left join public.gamification_participants gp
		  on gp.user_id = u.id
		 and gp.organization_id = om.organization_id
		where coalesce(u.is_active, false) = true
		  and coalesce(om.is_active, false) = true
		  and coalesce(gp.participates, true) = true
	`, tenantContext.OrganizationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	ranking := []RankingEntry{}
	for rows.Next() {
		var entry RankingEntry
		var avatarURL, currentRank, lastActivityAt pgtype.Text
		if err := rows.Scan(
			&entry.UserID,
			&entry.Name,
			&avatarURL,
			&entry.Points,
			&entry.XP,
			&entry.Level,
			&currentRank,
			&entry.StreakDays,
			&entry.XPCurrentLevel,
			&entry.XPNextLevel,
			&lastActivityAt,
		); err != nil {
			return nil, err
		}

		entry.AvatarURL = textPointer(avatarURL)
		if entry.Level <= 0 {
			entry.Level = fallbackLevel(entry.XP)
		}
		entry.Rank = firstText(currentRank, "Bronze")
		if entry.XPCurrentLevel == 0 {
			entry.XPCurrentLevel = entry.XP % 1000
		}
		if entry.XPNextLevel <= 0 {
			entry.XPNextLevel = 1000
		}
		entry.LastActivityAt = textPointer(lastActivityAt)
		ranking = append(ranking, entry)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	sort.SliceStable(ranking, func(i, j int) bool {
		if ranking[i].Points != ranking[j].Points {
			return ranking[i].Points > ranking[j].Points
		}
		if ranking[i].XP != ranking[j].XP {
			return ranking[i].XP > ranking[j].XP
		}
		return ranking[i].UserID < ranking[j].UserID
	})

	return ranking, nil
}

// FilteredRanking aggregates points in PostgreSQL. It never derives ranking
// from the bounded history payload returned by Overview.
func (repo Repository) FilteredRanking(ctx context.Context, tenantContext tenant.Context, query RankingQuery) ([]RankingEntry, error) {
	if query.From != nil && query.To != nil && !query.From.Before(*query.To) {
		return nil, ErrInvalidInput
	}
	actionTypes := make([]string, 0, len(query.ActionTypes))
	seenActions := map[string]struct{}{}
	for _, candidate := range query.ActionTypes {
		actionType := normalizeActionType(candidate)
		if actionType == "" {
			return nil, ErrInvalidInput
		}
		if _, exists := seenActions[actionType]; exists {
			continue
		}
		seenActions[actionType] = struct{}{}
		actionTypes = append(actionTypes, actionType)
	}
	if len(actionTypes) > len(defaultRules()) {
		return nil, ErrInvalidInput
	}

	rows, err := repo.db.Pool().Query(ctx, `
		with active_season as (
			select id, organization_id
			from public.gamification_seasons
			where organization_id = $1::uuid
			  and is_active = true
			limit 1
		), filtered_points as (
			select event.user_id, sum(event.points_earned)::bigint as points
			from public.gamification_events event
			join active_season season
			  on season.organization_id = event.organization_id
			 and season.id = event.season_id
			where event.organization_id = $1::uuid
			  and event.user_id is not null
			  and ($2::timestamptz is null or event.occurred_at >= $2::timestamptz)
			  and ($3::timestamptz is null or event.occurred_at < $3::timestamptz)
			  and (cardinality($4::text[]) = 0 or event.event_type = any($4::text[]))
			group by event.user_id
		)
		select
			u.id::text,
			coalesce(nullif(u.name, ''), u.email, 'Usuario'),
			u.avatar_url,
			coalesce(filtered.points, 0),
			coalesce(stats.xp_total, 0),
			coalesce(stats.current_level, 1),
			coalesce(nullif(stats.current_rank, ''), nullif(stats.rank_tier, ''), 'Bronze'),
			case
			  when (stats.last_activity_at at time zone 'America/Sao_Paulo')::date
			       >= (now() at time zone 'America/Sao_Paulo')::date - 1
			    then coalesce(stats.streak_days, 0)
			  else 0
			end,
			coalesce(stats.xp_current_level, 0),
			coalesce(stats.xp_next_level, 1000),
			stats.last_activity_at::text
		from public.users u
		join public.organization_members membership
		  on membership.user_id = u.id
		 and membership.organization_id = $1::uuid
		join active_season season on season.organization_id = membership.organization_id
		left join public.user_gamification_stats stats
		  on stats.organization_id = membership.organization_id
		 and stats.season_id = season.id
		 and stats.user_id = u.id
		left join public.gamification_participants participant
		  on participant.organization_id = membership.organization_id
		 and participant.user_id = u.id
		left join filtered_points filtered on filtered.user_id = u.id
		where coalesce(u.is_active, false) = true
		  and coalesce(membership.is_active, false) = true
		  and coalesce(participant.participates, true) = true
		order by coalesce(filtered.points, 0) desc, coalesce(stats.xp_total, 0) desc, u.id
	`, tenantContext.OrganizationID, query.From, query.To, actionTypes)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	ranking := []RankingEntry{}
	for rows.Next() {
		var entry RankingEntry
		var avatarURL, currentRank, lastActivityAt pgtype.Text
		if err := rows.Scan(
			&entry.UserID,
			&entry.Name,
			&avatarURL,
			&entry.Points,
			&entry.XP,
			&entry.Level,
			&currentRank,
			&entry.StreakDays,
			&entry.XPCurrentLevel,
			&entry.XPNextLevel,
			&lastActivityAt,
		); err != nil {
			return nil, err
		}
		entry.Position = len(ranking) + 1
		entry.IsCurrentUser = entry.UserID == tenantContext.UserID
		entry.AvatarURL = textPointer(avatarURL)
		entry.Rank = firstText(currentRank, "Bronze")
		entry.LastActivityAt = textPointer(lastActivityAt)
		ranking = append(ranking, entry)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return ranking, nil
}

func (repo Repository) events(ctx context.Context, tenantContext tenant.Context, limit int) ([]Event, int, error) {
	totalEvents := 0
	if err := repo.db.Pool().QueryRow(ctx, `
		select count(*)::int
		from public.gamification_events event
		join public.gamification_seasons season
		  on season.organization_id = event.organization_id
		 and season.id = event.season_id
		 and season.is_active = true
		where event.organization_id = $1::uuid
	`, tenantContext.OrganizationID).Scan(&totalEvents); err != nil {
		return nil, 0, err
	}

	if limit <= 0 {
		limit = 12
	}
	if limit > 500 {
		limit = 500
	}

	rows, err := repo.db.Pool().Query(ctx, `
		select
			event.id::text,
			event.user_id::text,
			coalesce(nullif(u.name, ''), u.email, 'Usuario'),
			event.event_type,
			coalesce(event.points_earned, 0),
			event.occurred_at::text,
			coalesce(
				nullif(event.metadata->>'details', ''),
				nullif(event.metadata->>'notes', ''),
				nullif(event.metadata->>'description', ''),
				nullif(event.metadata->>'lead_name', ''),
				nullif(event.metadata->>'title', '')
			),
			coalesce(nullif(event.source, ''), 'gamification')
		from public.gamification_events event
		join public.gamification_seasons season
		  on season.organization_id = event.organization_id
		 and season.id = event.season_id
		 and season.is_active = true
		left join public.users u on u.id = event.user_id
		where event.organization_id = $1::uuid
		order by event.occurred_at desc, event.id desc
		limit $2
	`, tenantContext.OrganizationID, limit)
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

// EventPage returns a stable occurred_at/id cursor page. Non-managers are
// always scoped to their own ledger rows, even when a different userId is
// supplied by the client.
func (repo Repository) EventPage(ctx context.Context, tenantContext tenant.Context, query EventQuery) (EventPage, error) {
	if query.Limit == 0 {
		query.Limit = 30
	}
	if query.Limit < 1 || query.Limit > 100 || (query.From != nil && query.To != nil && !query.From.Before(*query.To)) {
		return EventPage{}, ErrInvalidInput
	}
	if (query.CursorOccurredAt == nil) != (strings.TrimSpace(query.CursorID) == "") {
		return EventPage{}, ErrInvalidInput
	}
	if query.CursorID != "" && !isUUIDText(query.CursorID) {
		return EventPage{}, ErrInvalidInput
	}

	requestedUserID := strings.TrimSpace(query.UserID)
	if !canManageGamification(tenantContext) {
		if requestedUserID != "" && requestedUserID != tenantContext.UserID {
			return EventPage{}, tenant.ErrOrganizationAccessDenied
		}
		requestedUserID = tenantContext.UserID
	} else if requestedUserID != "" {
		isMember, err := repo.isActiveOrganizationMember(ctx, tenantContext.OrganizationID, requestedUserID)
		if err != nil {
			return EventPage{}, err
		}
		if !isMember {
			return EventPage{}, ErrNotFound
		}
	}

	var userFilter any
	if requestedUserID != "" {
		userFilter = requestedUserID
	}
	var total int64
	if err := repo.db.Pool().QueryRow(ctx, `
		select count(*)::bigint
		from public.gamification_events event
		join public.gamification_seasons season
		  on season.organization_id = event.organization_id
		 and season.id = event.season_id
		where event.organization_id = $1::uuid
		  and ($2::uuid is null or event.user_id = $2::uuid)
		  and ($3::timestamptz is null or event.occurred_at >= $3::timestamptz)
		  and ($4::timestamptz is null or event.occurred_at < $4::timestamptz)
	`, tenantContext.OrganizationID, userFilter, query.From, query.To).Scan(&total); err != nil {
		return EventPage{}, err
	}

	var cursorID any
	if query.CursorOccurredAt != nil {
		cursorID = query.CursorID
	}
	rows, err := repo.db.Pool().Query(ctx, `
		select
			event.id::text,
			event.user_id::text,
			coalesce(nullif(users.name, ''), users.email, 'Usuario'),
			event.event_type,
			coalesce(event.points_earned, 0),
			event.occurred_at::text,
			coalesce(
				nullif(event.metadata->>'details', ''),
				nullif(event.metadata->>'notes', ''),
				nullif(event.metadata->>'description', ''),
				nullif(event.metadata->>'lead_name', ''),
				nullif(event.metadata->>'title', '')
			),
			coalesce(nullif(event.source, ''), 'gamification'),
			event.occurred_at
		from public.gamification_events event
		join public.gamification_seasons season
		  on season.organization_id = event.organization_id
		 and season.id = event.season_id
		left join public.users users on users.id = event.user_id
		where event.organization_id = $1::uuid
		  and ($2::uuid is null or event.user_id = $2::uuid)
		  and ($3::timestamptz is null or event.occurred_at >= $3::timestamptz)
		  and ($4::timestamptz is null or event.occurred_at < $4::timestamptz)
		  and (
		    $5::timestamptz is null
		    or (event.occurred_at, event.id) < ($5::timestamptz, $6::uuid)
		  )
		order by event.occurred_at desc, event.id desc
		limit $7
	`, tenantContext.OrganizationID, userFilter, query.From, query.To, query.CursorOccurredAt, cursorID, query.Limit+1)
	if err != nil {
		return EventPage{}, err
	}
	defer rows.Close()

	items := make([]eventPageRow, 0, query.Limit+1)
	for rows.Next() {
		var item eventPageRow
		var userID, createdAt, details, source pgtype.Text
		if err := rows.Scan(
			&item.Event.ID,
			&userID,
			&item.Event.UserName,
			&item.Event.EventType,
			&item.Event.Points,
			&createdAt,
			&details,
			&source,
			&item.OccurredAt,
		); err != nil {
			return EventPage{}, err
		}
		item.Event.UserID = textPointer(userID)
		if item.Event.UserID == nil {
			item.Event.UserName = "Sistema"
		}
		item.Event.CreatedAt = textPointer(createdAt)
		item.Event.Details = textPointer(details)
		item.Event.Source = textPointer(source)
		if normalized := normalizeActionType(item.Event.EventType); normalized != "" {
			item.Event.EventType = normalized
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return EventPage{}, err
	}

	page := EventPage{Events: []Event{}, Total: total}
	hasMore := len(items) > query.Limit
	if hasMore {
		items = items[:query.Limit]
	}
	for _, item := range items {
		page.Events = append(page.Events, item.Event)
	}
	if hasMore && len(items) > 0 {
		last := items[len(items)-1]
		cursor, err := encodeEventCursor(last.OccurredAt, last.Event.ID)
		if err != nil {
			return EventPage{}, err
		}
		page.NextCursor = &cursor
	}
	return page, nil
}

func (repo Repository) missions(ctx context.Context, tenantContext tenant.Context, activeOnly bool) ([]Mission, error) {
	where := "mission.organization_id = $1::uuid"
	limit := ""
	if activeOnly {
		where += " and mission.is_active = true and (mission.target_scope = 'organization' or mission.target_user_id = $2::uuid)"
		limit = " limit 6"
	}

	rows, err := repo.db.Pool().Query(ctx, `
		select
			mission.id::text,
			mission.title,
			mission.description,
			mission.action_type,
			mission.target_count,
			coalesce(progress.current_progress, 0),
			mission.bonus_points,
			mission.period,
			mission.is_active,
			mission.target_scope,
			mission.target_user_id::text,
			mission.created_at::text,
			mission.updated_at::text
		from public.gamification_missions mission
		join public.gamification_seasons season
		  on season.organization_id = mission.organization_id
		 and season.is_active = true
		left join lateral (
			select mission_progress.current_progress
			from public.gamification_mission_progress mission_progress
			where mission_progress.organization_id = mission.organization_id
			  and mission_progress.mission_id = mission.id
			  and mission_progress.season_id = season.id
			  and mission_progress.user_id = $2::uuid
			  and mission_progress.period_key = case coalesce(mission.period, 'season')
			    when 'daily' then to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM-DD')
			    when 'weekly' then to_char(now() at time zone 'America/Sao_Paulo', 'IYYY-"W"IW')
			    when 'monthly' then to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM')
			    else 'season:' || season.id::text
			  end
			order by mission_progress.updated_at desc, mission_progress.id desc
			limit 1
		) progress on true
		where `+where+`
		order by mission.updated_at desc, mission.id desc
		`+limit+`
	`, tenantContext.OrganizationID, tenantContext.UserID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	missions := []Mission{}
	for rows.Next() {
		mission, err := repo.scanMission(rows, true)
		if err != nil {
			return nil, err
		}
		missions = append(missions, mission)
	}
	return missions, rows.Err()
}

func (repo Repository) performance(ctx context.Context, tenantContext tenant.Context) (Performance, error) {
	now := time.Now().In(gamificationBusinessLocation)
	startCurrentMonth := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, now.Location())
	startLastMonth := startCurrentMonth.AddDate(0, -1, 0)
	weekday := int(now.Weekday())
	if weekday == 0 {
		weekday = 7
	}
	startWeek := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location()).AddDate(0, 0, -(weekday - 1))
	endWeek := startWeek.AddDate(0, 0, 7)

	rows, err := repo.db.Pool().Query(ctx, `
		select
			to_char((event.occurred_at at time zone 'America/Sao_Paulo')::date, 'YYYY-MM-DD'),
			event.event_type,
			sum(event.points_earned)::bigint,
			count(*) filter (
			  where event.event_type not in ('mission_bonus', 'migration_baseline')
			)::int
		from public.gamification_events event
		join public.gamification_seasons season
		  on season.organization_id = event.organization_id
		 and season.id = event.season_id
		 and season.is_active = true
		where event.organization_id = $1::uuid
		  and event.user_id = $2::uuid
		  and event.occurred_at >= $3
		group by
			(event.occurred_at at time zone 'America/Sao_Paulo')::date,
			event.event_type
		order by (event.occurred_at at time zone 'America/Sao_Paulo')::date
	`, tenantContext.OrganizationID, tenantContext.UserID, startLastMonth)
	if err != nil {
		return Performance{}, err
	}
	defer rows.Close()

	events := []eventPoint{}
	for rows.Next() {
		var item eventPoint
		if err := rows.Scan(&item.OccurredDate, &item.EventType, &item.Points, &item.Actions); err != nil {
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

	var thisMonthPoints int64
	var lastMonthPoints int64
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
		eventTime, parseErr := time.ParseInLocation("2006-01-02", event.OccurredDate, gamificationBusinessLocation)
		if parseErr != nil {
			return Performance{}, parseErr
		}
		if !eventTime.Before(startWeek) && eventTime.Before(endWeek) {
			index := int(eventTime.Weekday()) - 1
			if index < 0 {
				index = 6
			}
			chartData[index].Points += event.Points
			chartData[index].Actions += event.Actions
		}

		if !eventTime.Before(startCurrentMonth) {
			thisMonthPoints += event.Points
			thisMonthActions += event.Actions
			if event.Actions > 0 {
				activeDays[eventTime.Format("2006-01-02")] = true
			}
			if positiveTypes[event.EventType] {
				positiveEvents += event.Actions
			}
			if event.Actions > 0 {
				distribution[distributionBucket(event.EventType)] += event.Actions
			}
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
	rows, err := repo.db.Pool().Query(ctx, `
		select
			u.id::text,
			coalesce(nullif(u.name, ''), u.email, 'Usuario'),
			coalesce(u.email, ''),
			coalesce(om.role, 'user'),
			(coalesce(u.is_active, false) and coalesce(om.is_active, false)),
			coalesce(gp.participates, true),
			coalesce(ugs.total_points, 0)
		from public.users u
		join public.organization_members om
		  on om.user_id = u.id
		 and om.organization_id = $1::uuid
		join public.gamification_seasons season
		  on season.organization_id = om.organization_id
		 and season.is_active = true
		left join public.user_gamification_stats ugs
		  on ugs.organization_id = om.organization_id
		 and ugs.user_id = u.id
		 and ugs.season_id = season.id
		left join public.gamification_participants gp
		  on gp.organization_id = om.organization_id
		 and gp.user_id = u.id
		where coalesce(u.is_active, false) = true
		  and coalesce(om.is_active, false) = true
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

func (repo Repository) manualEntries(ctx context.Context, tenantContext tenant.Context, userID string, adminQueueOnly bool) ([]ManualEntry, error) {
	if ok, err := repo.tableExists(ctx, "gamification_manual_entries"); err != nil {
		return nil, err
	} else if !ok {
		return []ManualEntry{}, nil
	}

	args := []any{tenantContext.OrganizationID}
	where := "gme.organization_id = $1::uuid"
	orderAndLimit := "gme.created_at desc limit 20"
	if adminQueueOnly {
		where += ` and (
			gme.status = 'pending'
			or (
				gme.status = 'approved'
				and (
					gme.awarded_at is null
					or goq.status in ('pending', 'processing', 'skipped', 'dead')
				)
			)
		)`
		orderAndLimit = `
			case
				when gme.status = 'pending' then 0
				when goq.status in ('dead', 'skipped') then 1
				else 2
			end,
			gme.created_at desc
			limit 100`
	} else if strings.TrimSpace(userID) != "" {
		args = append(args, userID)
		where += " and gme.user_id = $2::uuid"
	}

	rows, err := repo.db.Pool().Query(ctx, `
		select `+manualEntrySelectFields()+`
		from public.gamification_manual_entries gme
		left join public.users u on u.id = gme.user_id
		left join public.gamification_outbox goq
		  on goq.organization_id = gme.organization_id
		 and goq.id = gme.outbox_id
		where `+where+`
		order by `+orderAndLimit+`
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
		left join public.gamification_outbox goq
		  on goq.organization_id = gme.organization_id
		 and goq.id = gme.outbox_id
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
		select users.id::text, coalesce(nullif(users.name, ''), users.email, 'Usuario')
		from public.users users
		join public.organization_members membership
		  on membership.user_id = users.id
		 and membership.organization_id = $1::uuid
		where users.is_active = true
		  and membership.is_active = true
		order by coalesce(nullif(users.name, ''), users.email, 'Usuario')
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

// RecordAction remains as a compatibility hook for the current CRM modules.
// Their canonical table triggers already enqueue the same domain events in the
// business transaction, so a second database round-trip here would add latency
// and could still lose the race after commit. New producers must use
// EnqueueActionTx in their own transaction instead.
func (repo Repository) RecordAction(ctx context.Context, tenantContext tenant.Context, actionType string, quantity int, referenceID string) error {
	_ = ctx
	actionType = normalizeActionType(actionType)
	if actionType == "" || quantity < 1 || quantity > 100 || strings.TrimSpace(referenceID) == "" || tenantContext.OrganizationID == "" || tenantContext.UserID == "" {
		return ErrInvalidInput
	}
	return nil
}

// EnqueueActionTx lets domain repositories insert the outbox row in the same
// transaction as their business mutation. Callers should prefer it over the
// compatibility RecordAction method whenever they already own a pgx.Tx.
func (repo Repository) EnqueueActionTx(ctx context.Context, tx pgx.Tx, tenantContext tenant.Context, actionType string, quantity int, referenceID string) error {
	_, err := repo.enqueueActionTx(
		ctx,
		tx,
		tenantContext.OrganizationID,
		tenantContext.UserID,
		actionType,
		quantity,
		"system_action",
		referenceID,
		nil,
	)
	return err
}

func (repo Repository) enqueueActionTx(
	ctx context.Context,
	tx pgx.Tx,
	organizationID string,
	userID string,
	actionType string,
	quantity int,
	source string,
	referenceID string,
	metadata map[string]any,
) (string, error) {
	actionType = normalizeActionType(actionType)
	organizationID = strings.TrimSpace(organizationID)
	userID = strings.TrimSpace(userID)
	referenceID = strings.TrimSpace(referenceID)
	source = strings.TrimSpace(source)
	if actionType == "" || organizationID == "" || userID == "" || referenceID == "" || quantity < 1 || quantity > 100 {
		return "", ErrInvalidInput
	}
	if source == "" {
		source = "system_action"
	}

	var seasonID string
	err := tx.QueryRow(ctx, `
		select season.id::text
		from public.organization_modules module_access
		join public.gamification_seasons season
		  on season.organization_id = module_access.organization_id
		 and season.is_active = true
		join public.organization_members membership
		  on membership.organization_id = module_access.organization_id
		 and membership.user_id = $2::uuid
		 and membership.is_active = true
		left join public.gamification_participants participant
		  on participant.organization_id = membership.organization_id
		 and participant.user_id = membership.user_id
		where module_access.organization_id = $1::uuid
		  and module_access.module_name = 'gamification'
		  and module_access.is_enabled = true
		  and coalesce(participant.participates, true) = true
		order by season.started_at desc, season.id desc
		limit 1
		for share of module_access, season, membership
	`, organizationID, userID).Scan(&seasonID)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", err
	}

	idempotencyKey := gamificationIdempotencyKey(organizationID, actionType, referenceID)
	payload := map[string]any{
		"count":         quantity,
		"source_module": source,
		"reference_id":  referenceID,
	}
	for key, value := range metadata {
		payload[key] = value
	}

	var outboxID string
	err = tx.QueryRow(ctx, `
		insert into public.gamification_outbox (
			organization_id,
			season_id,
			user_id,
			action_type,
			quantity,
			source,
			reference_id,
			idempotency_key,
			metadata
		)
		values ($1::uuid, $2::uuid, $3::uuid, $4, $5, $6, $7, $8, $9::jsonb)
		on conflict (organization_id, idempotency_key)
		do update set idempotency_key = excluded.idempotency_key
		returning id::text
	`, organizationID, seasonID, userID, actionType, quantity, source, referenceID, idempotencyKey, jsonb(payload)).Scan(&outboxID)
	return outboxID, err
}

func (repo Repository) tableExists(ctx context.Context, table string) (bool, error) {
	var exists bool
	err := repo.db.Pool().QueryRow(ctx, `select to_regclass($1) is not null`, "public."+table).Scan(&exists)
	return exists, err
}

func (repo Repository) isActiveOrganizationMember(ctx context.Context, organizationID string, userID string) (bool, error) {
	var exists bool
	err := repo.db.Pool().QueryRow(ctx, `
		select exists (
			select 1
			from public.organization_members membership
			join public.users users on users.id = membership.user_id
			where membership.organization_id = $1::uuid
			  and membership.user_id = $2::uuid
			  and membership.is_active = true
			  and users.is_active = true
		)
	`, organizationID, userID).Scan(&exists)
	return exists, err
}

func validateManualEntryTransition(currentStatus string, nextStatus string, reason string) error {
	if currentStatus != "pending" || (nextStatus != "approved" && nextStatus != "rejected") {
		return ErrInvalidInput
	}
	if nextStatus == "rejected" && strings.TrimSpace(reason) == "" {
		return ErrInvalidInput
	}
	return nil
}

func missionStructureChanged(current missionStructure, next missionStructure) bool {
	return current.ActionType != next.ActionType ||
		current.TargetCount != next.TargetCount ||
		current.BonusPoints != next.BonusPoints ||
		current.Period != next.Period ||
		current.TargetScope != next.TargetScope ||
		current.TargetUserID != next.TargetUserID
}

func pointerValue(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
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
	if normalized := normalizeActionType(event.EventType); normalized != "" {
		event.EventType = normalized
	}
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
	var notes, approvedBy, approvedAt, rejectionReason, awardedAt, awardStatus, createdAt pgtype.Text
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
		&awardedAt,
		&awardStatus,
		&createdAt,
	); err != nil {
		return ManualEntry{}, err
	}
	entry.Notes = textPointer(notes)
	entry.ApprovedBy = textPointer(approvedBy)
	entry.ApprovedAt = textPointer(approvedAt)
	entry.RejectionReason = textPointer(rejectionReason)
	entry.AwardedAt = textPointer(awardedAt)
	entry.AwardStatus = textPointer(awardStatus)
	entry.CreatedAt = textPointer(createdAt)
	if normalized := normalizeActionType(entry.ActionKey); normalized != "" {
		entry.ActionKey = normalized
	}
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
		gme.awarded_at::text,
		coalesce(goq.status, case when gme.awarded_at is not null then 'completed' end),
		gme.created_at::text`
}

func normalizeMissionRequest(request MissionRequest) (MissionRequest, error) {
	request.Title = strings.TrimSpace(request.Title)
	if request.Title == "" || len(request.Title) > 180 || request.TargetCount < 1 || request.TargetCount > 1_000_000 || request.BonusPoints < 0 || request.BonusPoints > 1_000_000 {
		return MissionRequest{}, ErrInvalidInput
	}
	if request.Description != nil {
		value := strings.TrimSpace(*request.Description)
		if len(value) > 2000 {
			return MissionRequest{}, ErrInvalidInput
		}
		if value == "" {
			request.Description = nil
		} else {
			request.Description = &value
		}
	}
	if request.ActionType == nil {
		return MissionRequest{}, ErrInvalidInput
	}
	value := normalizeActionType(*request.ActionType)
	if value == "" {
		return MissionRequest{}, ErrInvalidInput
	}
	request.ActionType = &value
	if request.Period != nil {
		period := strings.ToLower(strings.TrimSpace(*request.Period))
		if period != "daily" && period != "weekly" && period != "monthly" && period != "season" {
			return MissionRequest{}, ErrInvalidInput
		}
		request.Period = &period
	} else {
		period := "season"
		request.Period = &period
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
		if !isUUIDText(value) {
			return MissionRequest{}, ErrInvalidInput
		}
		request.TargetUserID = &value
	}
	return request, nil
}

func normalizeActionType(actionType string) string {
	key := strings.ToLower(strings.TrimSpace(actionType))
	key = strings.ReplaceAll(key, " ", "_")
	key = strings.ReplaceAll(key, "-", "_")
	switch key {
	case "call_made", "message_sent", "contact_made", "visit_scheduled", "visit_confirmed",
		"meeting_scheduled", "meeting_held", "proposal_sent", "sale_closed", "contract_signed",
		"lead_created", "lead_created_manual", "property_created", "lost_lead_recovered", "prospecting_report":
		return key
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
		return ""
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
		{ID: "10000000-0000-4000-8000-000000000001", ActionType: "call_made", Points: 5, IsActive: true, IsTemp: true},
		{ID: "10000000-0000-4000-8000-000000000002", ActionType: "message_sent", Points: 2, IsActive: true, IsTemp: true},
		{ID: "10000000-0000-4000-8000-000000000003", ActionType: "contact_made", Points: 3, IsActive: true, IsTemp: true},
		{ID: "10000000-0000-4000-8000-000000000004", ActionType: "visit_scheduled", Points: 20, IsActive: true, IsTemp: true},
		{ID: "10000000-0000-4000-8000-000000000005", ActionType: "visit_confirmed", Points: 35, IsActive: true, IsTemp: true},
		{ID: "10000000-0000-4000-8000-000000000006", ActionType: "meeting_scheduled", Points: 10, IsActive: true, IsTemp: true},
		{ID: "10000000-0000-4000-8000-000000000007", ActionType: "meeting_held", Points: 25, IsActive: true, IsTemp: true},
		{ID: "10000000-0000-4000-8000-000000000008", ActionType: "proposal_sent", Points: 30, IsActive: true, IsTemp: true},
		{ID: "10000000-0000-4000-8000-000000000009", ActionType: "sale_closed", Points: 500, IsActive: true, IsTemp: true},
		{ID: "10000000-0000-4000-8000-000000000010", ActionType: "contract_signed", Points: 250, IsActive: true, IsTemp: true},
		{ID: "10000000-0000-4000-8000-000000000011", ActionType: "lost_lead_recovered", Points: 20, IsActive: true, IsTemp: true},
		{ID: "10000000-0000-4000-8000-000000000012", ActionType: "lead_created", Points: 10, IsActive: true, IsTemp: true},
		{ID: "10000000-0000-4000-8000-000000000013", ActionType: "lead_created_manual", Points: 10, IsActive: true, IsTemp: true},
		{ID: "10000000-0000-4000-8000-000000000014", ActionType: "property_created", Points: 50, IsActive: true, IsTemp: true},
		{ID: "10000000-0000-4000-8000-000000000015", ActionType: "prospecting_report", Points: 10, IsActive: true, IsTemp: true},
	}
}

func defaultRulePoints(actionType string) int64 {
	actionType = normalizeActionType(actionType)
	for _, rule := range defaultRules() {
		if rule.ActionType == actionType && rule.IsActive {
			return rule.Points
		}
	}
	return 0
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

func fallbackLevel(xp int64) int {
	level := xp/1000 + 1
	if level < 1 {
		return 1
	}
	return int(level)
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

func gamificationIdempotencyKey(organizationID string, actionType string, referenceID string) string {
	return strings.Join([]string{
		"v1",
		strings.TrimSpace(organizationID),
		normalizeActionType(actionType),
		strings.TrimSpace(referenceID),
	}, "|")
}

func isUUIDText(value string) bool {
	value = strings.TrimSpace(value)
	if len(value) != 36 {
		return false
	}
	for index, character := range value {
		switch index {
		case 8, 13, 18, 23:
			if character != '-' {
				return false
			}
		default:
			if !((character >= '0' && character <= '9') ||
				(character >= 'a' && character <= 'f') ||
				(character >= 'A' && character <= 'F')) {
				return false
			}
		}
	}
	return true
}
