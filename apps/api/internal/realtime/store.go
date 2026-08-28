package realtime

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

type EventStore interface {
	Append(context.Context, Event) (Event, error)
	LatestID(context.Context) (uint64, error)
	OldestID(context.Context) (uint64, error)
	ListAfter(context.Context, uint64, uint64, int) ([]Event, error)
	ListSubscriberAfter(context.Context, string, string, uint64, uint64, int) ([]Event, error)
	PruneBefore(context.Context, time.Time) (int64, error)
}

type PostgresStore struct {
	db *dbpkg.Postgres
}

func NewPostgresStore(db *dbpkg.Postgres) *PostgresStore {
	return &PostgresStore{db: db}
}

func (store *PostgresStore) Append(ctx context.Context, event Event) (Event, error) {
	if store == nil || store.db == nil || store.db.Pool() == nil {
		return Event{}, errors.New("realtime store is not initialized")
	}

	if event.Data == nil {
		event.Data = map[string]any{}
	}
	payload, err := json.Marshal(event.Data)
	if err != nil {
		return Event{}, fmt.Errorf("encode realtime event data: %w", err)
	}

	var stored Event
	var storedData []byte
	err = store.db.Pool().QueryRow(ctx, `
		insert into private.realtime_events (
			organization_id,
			user_id,
			audience_user_id,
			event_type,
			data,
			created_at
		)
		values (
			$1::uuid,
			nullif($2, '')::uuid,
			nullif($3, '')::uuid,
			$4,
			$5::jsonb,
			coalesce($6, now())
		)
		returning
			id::text,
			event_type,
			organization_id::text,
			coalesce(user_id::text, ''),
			coalesce(audience_user_id::text, ''),
			data,
			created_at
	`, event.OrganizationID, event.UserID, event.AudienceUserID, event.Type, string(payload), nullableEventTime(event.CreatedAt)).Scan(
		&stored.ID,
		&stored.Type,
		&stored.OrganizationID,
		&stored.UserID,
		&stored.AudienceUserID,
		&storedData,
		&stored.CreatedAt,
	)
	if err != nil {
		return Event{}, fmt.Errorf("append realtime event: %w", err)
	}

	if err := json.Unmarshal(storedData, &stored.Data); err != nil {
		return Event{}, fmt.Errorf("decode stored realtime event data: %w", err)
	}
	if stored.Data == nil {
		stored.Data = map[string]any{}
	}
	return stored, nil
}

func (store *PostgresStore) LatestID(ctx context.Context) (uint64, error) {
	if store == nil || store.db == nil || store.db.Pool() == nil {
		return 0, errors.New("realtime store is not initialized")
	}

	var latestID int64
	if err := store.db.Pool().QueryRow(ctx, `
		select coalesce(max(id), 0)::bigint
		from private.realtime_events
	`).Scan(&latestID); err != nil {
		return 0, fmt.Errorf("read latest realtime cursor: %w", err)
	}
	if latestID < 0 {
		return 0, errors.New("realtime cursor cannot be negative")
	}
	return uint64(latestID), nil
}

func (store *PostgresStore) OldestID(ctx context.Context) (uint64, error) {
	if store == nil || store.db == nil || store.db.Pool() == nil {
		return 0, errors.New("realtime store is not initialized")
	}

	var oldestID int64
	if err := store.db.Pool().QueryRow(ctx, `
		select coalesce(min(id), 0)::bigint
		from private.realtime_events
	`).Scan(&oldestID); err != nil {
		return 0, fmt.Errorf("read oldest realtime cursor: %w", err)
	}
	if oldestID < 0 {
		return 0, errors.New("realtime cursor cannot be negative")
	}
	return uint64(oldestID), nil
}

func (store *PostgresStore) ListAfter(
	ctx context.Context,
	afterID uint64,
	throughID uint64,
	limit int,
) ([]Event, error) {
	return store.list(ctx, "", "", afterID, throughID, limit)
}

func (store *PostgresStore) ListSubscriberAfter(
	ctx context.Context,
	organizationID string,
	userID string,
	afterID uint64,
	throughID uint64,
	limit int,
) ([]Event, error) {
	if strings.TrimSpace(organizationID) == "" {
		return nil, errors.New("organization id is required for realtime replay")
	}
	if strings.TrimSpace(userID) == "" {
		return nil, errors.New("user id is required for realtime replay")
	}
	return store.list(ctx, organizationID, userID, afterID, throughID, limit)
}

func (store *PostgresStore) list(
	ctx context.Context,
	organizationID string,
	userID string,
	afterID uint64,
	throughID uint64,
	limit int,
) ([]Event, error) {
	if store == nil || store.db == nil || store.db.Pool() == nil {
		return nil, errors.New("realtime store is not initialized")
	}
	if limit <= 0 {
		return []Event{}, nil
	}

	query := `
		select
			id::text,
			event_type,
			organization_id::text,
			coalesce(user_id::text, ''),
			coalesce(audience_user_id::text, ''),
			data,
			created_at
		from private.realtime_events
		where id > $1
		  and ($2::bigint = 0 or id <= $2)
		order by id
		limit $3
	`
	args := []any{afterID, throughID, limit}
	if organizationID != "" {
		query = `
			select
				id::text,
				event_type,
				organization_id::text,
				coalesce(user_id::text, ''),
				coalesce(audience_user_id::text, ''),
				data,
				created_at
			from private.realtime_events
			where id > $1
			  and ($2::bigint = 0 or id <= $2)
			  and organization_id = $3::uuid
			  and (audience_user_id is null or audience_user_id = $4::uuid)
			order by id
			limit $5
		`
		args = []any{afterID, throughID, organizationID, userID, limit}
	}

	rows, err := store.db.Pool().Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("list realtime events: %w", err)
	}
	defer rows.Close()

	events := make([]Event, 0, limit)
	for rows.Next() {
		var event Event
		var storedData []byte
		if err := rows.Scan(
			&event.ID,
			&event.Type,
			&event.OrganizationID,
			&event.UserID,
			&event.AudienceUserID,
			&storedData,
			&event.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan realtime event: %w", err)
		}
		if err := json.Unmarshal(storedData, &event.Data); err != nil {
			return nil, fmt.Errorf("decode realtime event data: %w", err)
		}
		if event.Data == nil {
			event.Data = map[string]any{}
		}
		events = append(events, event)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate realtime events: %w", err)
	}
	return events, nil
}

func (store *PostgresStore) PruneBefore(ctx context.Context, before time.Time) (int64, error) {
	if store == nil || store.db == nil || store.db.Pool() == nil {
		return 0, errors.New("realtime store is not initialized")
	}

	result, err := store.db.Pool().Exec(ctx, `
		delete from private.realtime_events
		where created_at < $1
	`, before.UTC())
	if err != nil {
		return 0, fmt.Errorf("prune realtime events: %w", err)
	}
	return result.RowsAffected(), nil
}

func nullableEventTime(value time.Time) any {
	if value.IsZero() {
		return nil
	}
	return value.UTC()
}

var _ EventStore = (*PostgresStore)(nil)
