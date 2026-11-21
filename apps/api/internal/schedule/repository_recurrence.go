package schedule

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
)

func (repo Repository) insertRecurringEvents(ctx context.Context, tx pgx.Tx, organizationID string, parentID string, input createInput) ([]string, error) {
	if input.RecurrenceRule == nil {
		return nil, nil
	}

	maxOccurrences := recurrenceMax(*input.RecurrenceRule)
	recurrenceUntil := addRecurrence(input.StartTime, *input.RecurrenceRule, maxOccurrences-1)
	ids := make([]string, 0, maxOccurrences-1)
	batch := &pgx.Batch{}
	previousStart := input.StartTime
	for index := 1; index < maxOccurrences; index++ {
		nextStart, nextEnd := recurringEventInterval(input, index)
		if !nextStart.After(previousStart) || !nextEnd.After(nextStart) {
			return nil, fmt.Errorf("%w: recurrence civil clock produced overlapping occurrence instants", ErrRecurrenceCreate)
		}
		previousStart = nextStart

		batch.Queue(`
			insert into public.schedule_events (
				organization_id,
				user_id,
				lead_id,
				property_id,
				created_by,
				team_id,
				lead_source_snapshot,
				title,
				description,
				event_type,
				start_time,
				end_time,
				is_all_day,
				location,
				visibility,
				reminder_minutes,
				recurrence_parent_id,
				recurrence_rule,
				recurrence_until,
				recurrence_count
			)
			values (
				$1::uuid,
				$2::uuid,
				$3::uuid,
				$4::uuid,
				$5::uuid,
				$6::uuid,
				(
					select coalesce(left(nullif(btrim(l.source), ''), 160), '__none__')
					from public.leads l
					where l.organization_id = $1::uuid
					  and l.id = $3::uuid
				),
				$7,
				$8,
				$9,
				$10::timestamptz,
				$11::timestamptz,
				$12::boolean,
				$13,
				$14,
				$15::integer,
				$16::uuid,
				$17,
				$18::timestamptz,
				$19::integer
			)
			returning id::text
		`, organizationID, input.UserID, nullable(input.LeadID), nullable(input.PropertyID), input.CreatedBy, nullable(input.TeamID), input.Title, nullable(input.Description), input.EventType, nextStart, nextEnd, input.IsAllDay, nullable(input.Location), input.Visibility, input.ReminderMinutes, parentID, *input.RecurrenceRule, recurrenceUntil, maxOccurrences)
	}

	results := tx.SendBatch(ctx, batch)
	defer func() { _ = results.Close() }()
	for index := 1; index < maxOccurrences; index++ {
		var id string
		err := results.QueryRow().Scan(&id)
		if err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	if err := results.Close(); err != nil {
		return nil, err
	}

	return ids, nil
}

func recurrenceMax(frequency string) int {
	switch frequency {
	case "daily":
		return 90
	case "weekly":
		return 52
	case "monthly":
		return 24
	case "yearly":
		return 5
	default:
		return 0
	}
}
