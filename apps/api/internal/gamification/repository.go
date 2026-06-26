package gamification

import (
	"context"
	"sort"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

type Repository struct {
	db *dbpkg.Postgres
}

type nullableInt struct {
	Value int
	Valid bool
}

func NewRepository(db *dbpkg.Postgres) Repository {
	return Repository{db: db}
}

func (repo Repository) Overview(ctx context.Context, tenantContext tenant.Context) (Overview, error) {
	ranking, err := repo.ranking(ctx, tenantContext)
	if err != nil {
		return Overview{}, err
	}
	events, totalEvents, err := repo.recentEvents(ctx, tenantContext)
	if err != nil {
		return Overview{}, err
	}
	missions, err := repo.missions(ctx, tenantContext)
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
		Missions:     missions,
		TotalPoints:  totalPoints,
		ActiveUsers:  len(ranking),
		TotalEvents:  totalEvents,
		MyPosition:   myPosition,
	}, nil
}

func (repo Repository) ranking(ctx context.Context, tenantContext tenant.Context) ([]RankingEntry, error) {
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
			ugs.last_activity_at::text
		from public.users u
		left join public.user_gamification_stats ugs
		  on ugs.user_id = u.id
		 and ugs.organization_id = u.organization_id
		where u.organization_id = $1::uuid
		  and coalesce(u.is_active, true) = true
	`, tenantContext.OrganizationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	ranking := []RankingEntry{}
	for rows.Next() {
		var entry RankingEntry
		var avatarURL, currentRank, rankTier, lastActivityAt pgtype.Text
		var userPoints, userXP, level, streakDays, totalPoints, statXP, xpCurrent, xpNext, xpTotal pgtype.Int4
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
		); err != nil {
			return nil, err
		}

		entry.AvatarURL = textPointer(avatarURL)
		entry.Points = firstInt(totalPoints, userPoints)
		entry.XP = firstInt(xpTotal, statXP, userXP)
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
		return ranking[i].XP > ranking[j].XP
	})

	return ranking, nil
}

func (repo Repository) recentEvents(ctx context.Context, tenantContext tenant.Context) ([]Event, int, error) {
	totalEvents := 0
	if err := repo.db.Pool().QueryRow(ctx, `
		select count(*)::int
		from public.gamification_events
		where organization_id = $1::uuid
	`, tenantContext.OrganizationID).Scan(&totalEvents); err != nil {
		return nil, 0, err
	}

	rows, err := repo.db.Pool().Query(ctx, `
		select
			ge.id::text,
			ge.user_id::text,
			coalesce(nullif(u.name, ''), u.email, 'Usuario'),
			ge.event_type,
			coalesce(ge.points_earned, 0),
			ge.created_at::text
		from public.gamification_events ge
		left join public.users u on u.id = ge.user_id
		where ge.organization_id = $1::uuid
		order by ge.created_at desc
		limit 8
	`, tenantContext.OrganizationID)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	events := []Event{}
	for rows.Next() {
		var event Event
		var userID, createdAt pgtype.Text
		if err := rows.Scan(&event.ID, &userID, &event.UserName, &event.EventType, &event.Points, &createdAt); err != nil {
			return nil, 0, err
		}
		event.UserID = textPointer(userID)
		if event.UserID == nil {
			event.UserName = "Sistema"
		}
		event.CreatedAt = textPointer(createdAt)
		events = append(events, event)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	return events, totalEvents, nil
}

func (repo Repository) missions(ctx context.Context, tenantContext tenant.Context) ([]Mission, error) {
	rows, err := repo.db.Pool().Query(ctx, `
		select
			id::text,
			title,
			description,
			target_count,
			coalesce(current_progress, 0),
			bonus_points,
			period
		from public.gamification_missions
		where organization_id = $1::uuid
		  and coalesce(is_active, true) = true
		order by updated_at desc
		limit 4
	`, tenantContext.OrganizationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	missions := []Mission{}
	for rows.Next() {
		var mission Mission
		var description, period pgtype.Text
		if err := rows.Scan(
			&mission.ID,
			&mission.Title,
			&description,
			&mission.TargetCount,
			&mission.CurrentProgress,
			&mission.BonusPoints,
			&period,
		); err != nil {
			return nil, err
		}
		mission.Description = textPointer(description)
		mission.Period = textPointer(period)
		missions = append(missions, mission)
	}
	return missions, rows.Err()
}

func firstInt(values ...pgtype.Int4) int {
	for _, value := range values {
		if value.Valid {
			return int(value.Int32)
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

func fallbackLevel(xp int) int {
	level := xp/1000 + 1
	if level < 1 {
		return 1
	}
	return level
}

func textPointer(value pgtype.Text) *string {
	if !value.Valid {
		return nil
	}
	return &value.String
}
