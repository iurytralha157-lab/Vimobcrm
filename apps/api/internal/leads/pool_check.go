package leads

import (
	"context"
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

type PoolCheckResult struct {
	Success       bool               `json:"success"`
	Redistributed int                `json:"redistributed"`
	Skipped       int                `json:"skipped"`
	Failed        int                `json:"failed"`
	Warnings      []PoolCheckAttempt `json:"warnings"`
	Results       []PoolCheckAttempt `json:"results"`
}

type PoolCheckAttempt struct {
	LeadID  string `json:"leadId"`
	Success bool   `json:"success"`
	Skipped bool   `json:"skipped,omitempty"`
	Error   string `json:"error,omitempty"`
}

type poolCheckPipeline struct {
	ID                 string
	OrganizationID     string
	ActivationAt       *time.Time
	TimeoutMinutes     int
	WarningMinutes     int
	MaxRedistributions int
}

type poolCheckCandidate struct {
	LeadID              string
	AssignedUserID      string
	AssignedAt          time.Time
	RoundRobinID        string
	DistributionAt      time.Time
	DistributionKeyAt   string
	RedistributionCount *int
}

type poolCheckRPCResult struct {
	Success        bool    `json:"success"`
	Skipped        bool    `json:"skipped"`
	AssignedUserID *string `json:"assigned_user_id"`
	PoolFinalized  bool    `json:"pool_finalized"`
	Reason         string  `json:"reason"`
}

const poolCheckPipelinesSQL = `
	select id::text, organization_id::text, pool_enabled_at,
		coalesce(nullif(pool_timeout_minutes, 0), 10),
		coalesce(pool_warning_minutes, 2),
		coalesce(pool_max_redistributions, 3)
	from public.pipelines
	where pool_enabled = true
	order by organization_id, id
`

// Discovery only selects a snapshot. The existing RPCs lock and revalidate
// the lead, assignment, and activity before writing warnings or distributing.
const poolCheckCandidatesSQL = `
	select l.id::text, l.assigned_user_id::text, l.assigned_at, a.round_robin_id::text,
		a.effective_at,
		(to_json(a.effective_at at time zone 'UTC') #>> '{}') || '+00:00',
		l.redistribution_count
	from public.leads as l
	join lateral (
		select x.round_robin_id, coalesce(x.assigned_at, x.created_at, l.assigned_at, l.created_at) as effective_at
		from public.assignments_log as x
		where x.organization_id = l.organization_id
			and x.lead_id = l.id
			and x.assigned_user_id = l.assigned_user_id
			and x.round_robin_id is not null
			and x.reason in ('round_robin_auto', 'round_robin', 'canonical_round_robin')
		order by x.created_at desc, x.id desc
		limit 1
	) as a on true
	where l.organization_id = $1::uuid and l.pipeline_id = $2::uuid
		and l.deal_status = 'open'
		and l.operational_effects_suppressed = false
		and l.assigned_user_id is not null and l.assigned_at is not null
		and l.first_response_at is null and l.first_touch_at is null
		and l.owner_last_activity_at is null and l.last_contact_at is null
		and l.assigned_at > $3::timestamptz
		and date_trunc('milliseconds', a.effective_at) >= date_trunc('milliseconds', $3::timestamptz)
		and l.assigned_at < $4::timestamptz
		and ($5::timestamptz is null or (
			l.assigned_at >= $5::timestamptz and l.redistribution_warning_sent_at is null
		))
		and ($6::integer <= 0 or coalesce(l.redistribution_count, 0) < $6::integer)
		and (l.stage_entered_at is null or
			date_trunc('milliseconds', l.stage_entered_at) <= date_trunc('milliseconds', l.assigned_at) + interval '10 seconds')
		and not exists (
			select 1 from public.stages as s
			where s.id = l.stage_id and s.pipeline_id = l.pipeline_id and s.organization_id = l.organization_id
				and (s.is_won or s.is_lost)
		)
		and not exists (
			select 1 from public.lead_timeline_events as e
			where e.lead_id = l.id and e.organization_id = l.organization_id
				and e.created_at >= date_trunc('milliseconds', a.effective_at) - interval '5 seconds'
				and e.event_type in ('whatsapp_message_sent', 'first_response', 'call_initiated', 'call_completed',
					'note_created', 'stage_changed', 'agenda_created', 'agenda_rescheduled', 'agenda_completed',
					'agenda_cancelled', 'schedule_comment')
		)
		and not exists (
			select 1 from public.whatsapp_messages as m
			where m.lead_id = l.id and m.organization_id = l.organization_id
				and m.created_at >= date_trunc('milliseconds', a.effective_at) - interval '5 seconds'
				and m.capture_state is distinct from 'suppressed'
				and (m.from_me or m.sender_user_id is not null)
		)
	order by l.assigned_at, l.id
	limit 1000
`

const sendPoolCheckWarningSQL = `select public.send_pool_redistribution_warning_from_backend(
	$1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::timestamptz, $6::timestamptz, $7::integer, $8::timestamptz
)`

const redistributePoolCheckLeadSQL = `select public.redistribute_lead_from_pool_backend(
	$1::uuid, $2::uuid, $3::text, $4::uuid, $5::uuid, $6::timestamptz, $7::integer, $8::timestamptz
)`

func (repo Repository) RunPoolCheck(ctx context.Context) (PoolCheckResult, error) {
	return runPoolCheck(ctx, repo.db.Pool(), time.Now)
}

func runPoolCheck(ctx context.Context, db notificationRowsQueryer, clock func() time.Time) (PoolCheckResult, error) {
	result := PoolCheckResult{Warnings: []PoolCheckAttempt{}, Results: []PoolCheckAttempt{}}
	pipelines, err := listPoolCheckPipelines(ctx, db)
	if err != nil {
		return result, fmt.Errorf("pool pipeline discovery: %w", err)
	}
	for _, pipeline := range pipelines {
		now := clock().UTC().Truncate(time.Millisecond)
		activation := now
		if pipeline.ActivationAt != nil {
			activation = *pipeline.ActivationAt
		}
		timeout := now.Add(-time.Duration(pipeline.TimeoutMinutes) * time.Minute)
		warningMinutes := max(0, min(pipeline.WarningMinutes, pipeline.TimeoutMinutes-1))
		for _, warning := range []bool{true, false} {
			var from *time.Time
			until := timeout
			if warning {
				if warningMinutes == 0 {
					continue
				}
				from = &timeout
				until = now.Add(-time.Duration(max(1, pipeline.TimeoutMinutes-warningMinutes)) * time.Minute)
			}
			candidates, err := listPoolCheckCandidates(ctx, db, pipeline, activation, until, from)
			if err != nil {
				return result, fmt.Errorf("pool candidate discovery (warning=%t): %w", warning, err)
			}
			for _, candidate := range candidates {
				if err := ctx.Err(); err != nil {
					return result, err
				}
				attempt := runPoolCheckAttempt(ctx, db, pipeline.OrganizationID, candidate, warning, clock().UTC().Truncate(time.Millisecond))
				if err := ctx.Err(); err != nil {
					return result, err
				}
				if warning {
					result.Warnings = append(result.Warnings, attempt)
				} else {
					result.Results = append(result.Results, attempt)
					if attempt.Success {
						result.Redistributed++
					}
				}
				if attempt.Skipped {
					result.Skipped++
				} else if !attempt.Success {
					result.Failed++
				}
			}
		}
	}
	result.Success = result.Failed == 0
	return result, nil
}

func listPoolCheckPipelines(ctx context.Context, db notificationRowsQueryer) ([]poolCheckPipeline, error) {
	rows, err := db.Query(ctx, poolCheckPipelinesSQL)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var pipelines []poolCheckPipeline
	for rows.Next() {
		var p poolCheckPipeline
		if err := rows.Scan(&p.ID, &p.OrganizationID, &p.ActivationAt, &p.TimeoutMinutes, &p.WarningMinutes, &p.MaxRedistributions); err != nil {
			return nil, err
		}
		pipelines = append(pipelines, p)
	}
	return pipelines, rows.Err()
}

func listPoolCheckCandidates(ctx context.Context, db notificationRowsQueryer, pipeline poolCheckPipeline, activation, until time.Time, from *time.Time) ([]poolCheckCandidate, error) {
	rows, err := db.Query(ctx, poolCheckCandidatesSQL, pipeline.OrganizationID, pipeline.ID, activation, until, from, pipeline.MaxRedistributions)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var candidates []poolCheckCandidate
	for rows.Next() {
		var c poolCheckCandidate
		if err := rows.Scan(&c.LeadID, &c.AssignedUserID, &c.AssignedAt, &c.RoundRobinID, &c.DistributionAt, &c.DistributionKeyAt, &c.RedistributionCount); err != nil {
			return nil, err
		}
		candidates = append(candidates, c)
	}
	return candidates, rows.Err()
}

func runPoolCheckAttempt(ctx context.Context, db notificationQueryer, organizationID string, candidate poolCheckCandidate, warning bool, now time.Time) PoolCheckAttempt {
	attempt := PoolCheckAttempt{LeadID: candidate.LeadID}
	var raw poolCheckRPCResult
	var count int
	if candidate.RedistributionCount != nil {
		count = *candidate.RedistributionCount
	}
	var err error
	if warning {
		err = db.QueryRow(ctx, sendPoolCheckWarningSQL, organizationID, candidate.LeadID,
			candidate.RoundRobinID, candidate.AssignedUserID, candidate.AssignedAt, candidate.DistributionAt, count, now).Scan(&raw)
	} else {
		var key string
		key, err = poolCheckIdempotencyKey(candidate)
		if err == nil {
			err = db.QueryRow(ctx, redistributePoolCheckLeadSQL, organizationID, candidate.LeadID,
				key, candidate.RoundRobinID, candidate.AssignedUserID, candidate.AssignedAt, count, now).Scan(&raw)
		}
	}
	if err != nil {
		attempt.Error = "pool_redistribution_rpc_failed"
		if warning {
			attempt.Error = "pool_warning_rpc_failed"
		}
		return attempt
	}
	attempt.Success = raw.Success
	if warning {
		attempt.Skipped = raw.Success && raw.Skipped
	} else {
		attempt.Skipped = !raw.Success && raw.Skipped
	}
	if !raw.Success || attempt.Skipped {
		attempt.Error = raw.Reason
		if attempt.Error == "" {
			attempt.Error = "skipped"
			if warning && !raw.Skipped {
				attempt.Error = "warning_failed"
			}
		}
	}
	if !warning && raw.Success {
		switch {
		case raw.AssignedUserID == nil || strings.TrimSpace(*raw.AssignedUserID) == "":
			attempt.Success = false
			attempt.Error = "canonical_distribution_missing_assignee"
		case !raw.PoolFinalized:
			attempt.Success = false
			attempt.Error = "pool_distribution_not_finalized"
		}
	}
	return attempt
}

func poolCheckIdempotencyKey(candidate poolCheckCandidate) (string, error) {
	// JSON field order and null count match the Edge stable serializer.
	identity := struct {
		AssignedUserID      string `json:"assignedUserId"`
		AssignmentAt        string `json:"assignmentAt"`
		LeadID              string `json:"leadId"`
		RedistributionCount *int   `json:"redistributionCount"`
		RoundRobinID        string `json:"roundRobinId"`
	}{candidate.AssignedUserID, candidate.DistributionKeyAt, candidate.LeadID,
		candidate.RedistributionCount, candidate.RoundRobinID}
	wire, err := json.Marshal(identity)
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("pool-timeout:%x", sha256.Sum256(wire)), nil
}
