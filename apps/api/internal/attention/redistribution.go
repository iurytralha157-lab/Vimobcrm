package attention

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
)

func (repo Repository) maybeEnqueueRedistribution(ctx context.Context, tx pgx.Tx, instance *workerInstance, evaluation Evaluation, now time.Time) error {
	if instance.SnoozedUntil != nil && instance.SnoozedUntil.After(now) {
		return nil
	}
	if instance.RedistributionAttempts > 0 || instance.RedistributedAt != nil || instance.RedistributionMinutes == nil {
		return nil
	}
	if instance.EngineMode != "enabled" || instance.Shadow || !instance.RedistributionEnabled {
		return nil
	}
	if instance.PolicyStatus == "shadow" || instance.PolicyStatus == "paused" {
		return nil
	}
	redistributionAt, err := AddPolicyMinutes(instance.DueAt, *instance.RedistributionMinutes, instance.BusinessHoursOnly, instance.Timezone, instance.BusinessHours)
	if err != nil {
		return err
	}
	if now.Before(redistributionAt) {
		if evaluation.NextAt.After(redistributionAt) {
			_, err := tx.Exec(ctx, `
				update public.lead_attention_instances
				set next_evaluation_at = $3, updated_at = now()
				where organization_id = $1::uuid and id = $2::uuid
			`, instance.OrganizationID, instance.ID, redistributionAt)
			return err
		}
		return nil
	}
	if instance.AssignedUserID == nil || instance.LeadAssignedUserID == nil || *instance.AssignedUserID != *instance.LeadAssignedUserID {
		return repo.recordRedistributionBlocked(ctx, tx, instance, "assignee_changed")
	}

	var firstHuman pgtype.Timestamptz
	err = tx.QueryRow(ctx, `
		select first_human_outreach_at
		from public.lead_assignment_cycles
		where organization_id = $1::uuid and lead_id = $2::uuid and ended_at is null
		order by assigned_at desc, id desc limit 1
	`, instance.OrganizationID, instance.LeadID).Scan(&firstHuman)
	if err != nil && err != pgx.ErrNoRows {
		return err
	}
	if instance.RedistributeBeforeContactOnly && firstHuman.Valid {
		return repo.recordRedistributionBlocked(ctx, tx, instance, "human_outreach_recorded")
	}

	protectAppointments := true
	if value, exists := configBoolValue(instance.PolicyConfig, "protect_future_appointments", "protectFutureAppointments"); exists {
		protectAppointments = value
	}
	if protectAppointments {
		var hasFutureCommitment bool
		if err := tx.QueryRow(ctx, `
			select exists (
				select 1 from public.leads l
				where l.organization_id = $1::uuid and l.id = $2::uuid
				  and l.next_follow_up_at > now()
				union all
				select 1 from public.schedule_events se
				where se.organization_id = $1::uuid and se.lead_id = $2::uuid
				  and se.status not in ('completed', 'cancelled', 'canceled')
				  and se.end_time > now()
			)
		`, instance.OrganizationID, instance.LeadID).Scan(&hasFutureCommitment); err != nil {
			return err
		}
		if hasFutureCommitment {
			return repo.recordRedistributionBlocked(ctx, tx, instance, "future_appointment")
		}
	}

	roundRobinID := configString(instance.PolicyConfig, "round_robin_id", "roundRobinId")
	if roundRobinID == "" && instance.PipelineID != nil {
		_ = tx.QueryRow(ctx, `
			select default_round_robin_id::text
			from public.pipelines
			where organization_id = $1::uuid and id = $2::uuid
		`, instance.OrganizationID, *instance.PipelineID).Scan(&roundRobinID)
	}
	if !validUUID(roundRobinID) {
		return repo.recordRedistributionBlocked(ctx, tx, instance, "round_robin_missing")
	}

	maxAttempts := 1
	if configured, exists := configIntValue(instance.PolicyConfig, "redistribution_max_attempts", "redistributionMaxAttempts"); exists {
		if configured >= 0 {
			maxAttempts = configured
		}
	}
	var jobID string
	err = tx.QueryRow(ctx, `
		select id::text
		from public.lead_redistribution_jobs
		where lead_id = $1::uuid and status in ('pending', 'warning_sent')
		order by created_at desc limit 1
	`, instance.LeadID).Scan(&jobID)
	if err != nil && err != pgx.ErrNoRows {
		return err
	}
	if jobID == "" {
		err = tx.QueryRow(ctx, `
			insert into public.lead_redistribution_jobs (
				organization_id, lead_id, round_robin_id,
				original_assigned_user_id, current_assigned_user_id,
				attempt_count, max_attempts, timeout_minutes, warning_minutes,
				enrolled_at, due_at, warning_due_at, warning_sent_at,
				status, metadata
			) values (
				$1::uuid, $2::uuid, $3::uuid,
				$4::uuid, $4::uuid,
				0, $5, $6, 0,
				now(), now(), null, now(),
				'pending', $7::jsonb
			)
			returning id::text
		`, instance.OrganizationID, instance.LeadID, roundRobinID, *instance.AssignedUserID,
			maxAttempts, maxInt(1, instance.ThresholdMinutes), jsonValue(map[string]any{
				"source":                "lead_attention",
				"attention_instance_id": instance.ID,
				"policy_id":             instance.PolicyID,
				"policy_version":        instance.PolicyVersion,
			})).Scan(&jobID)
		if err != nil {
			return err
		}
	}

	metadata := cloneMap(instance.Metadata)
	metadata["redistribution_job_id"] = jobID
	metadata["redistribution_enqueued_at"] = now.Format(time.RFC3339Nano)
	_, err = tx.Exec(ctx, `
		update public.lead_attention_instances
		set redistribution_attempts = redistribution_attempts + 1,
		    next_evaluation_at = now() + interval '1 minute',
		    metadata = $3::jsonb, last_error = null, updated_at = now()
		where organization_id = $1::uuid and id = $2::uuid
	`, instance.OrganizationID, instance.ID, jsonValue(metadata))
	if err != nil {
		return err
	}
	instance.RedistributionAttempts++
	instance.Metadata = metadata
	return insertAttentionEvent(ctx, tx, instance.OrganizationID, instance.ID, instance.LeadID, "redistribution_enqueued", "", map[string]any{
		"job_id":         jobID,
		"round_robin_id": roundRobinID,
	})
}

func (repo Repository) reconcileRedistribution(ctx context.Context, tx pgx.Tx, instance *workerInstance) (bool, error) {
	jobID := stringMapValue(instance.Metadata, "redistribution_job_id")
	if !validUUID(jobID) {
		return false, nil
	}
	var status string
	var lastRedistributedAt pgtype.Timestamptz
	var stoppedReason pgtype.Text
	err := tx.QueryRow(ctx, `
		select status, last_redistributed_at, stopped_reason
		from public.lead_redistribution_jobs
		where organization_id = $1::uuid and id = $2::uuid and lead_id = $3::uuid
	`, instance.OrganizationID, jobID, instance.LeadID).Scan(&status, &lastRedistributedAt, &stoppedReason)
	if err == pgx.ErrNoRows {
		return false, repo.recordRedistributionBlocked(ctx, tx, instance, "redistribution_job_missing")
	}
	if err != nil {
		return false, err
	}
	if status == "pending" || status == "warning_sent" {
		_, err := tx.Exec(ctx, `
			update public.lead_attention_instances
			set next_evaluation_at = now() + interval '1 minute', updated_at = now()
			where organization_id = $1::uuid and id = $2::uuid
		`, instance.OrganizationID, instance.ID)
		return true, err
	}
	if lastRedistributedAt.Valid || status == "redistributed" || status == "max_attempts_reached" {
		redistributedAt := time.Now().UTC()
		if lastRedistributedAt.Valid {
			redistributedAt = lastRedistributedAt.Time
		}
		_, err := tx.Exec(ctx, `
			update public.lead_attention_instances
			set status = 'redistributed', redistributed_at = $3,
			    resolved_at = $3, resolved_reason = 'auto_redistributed',
			    next_evaluation_at = $3, updated_at = now()
			where organization_id = $1::uuid and id = $2::uuid
		`, instance.OrganizationID, instance.ID, redistributedAt)
		if err != nil {
			return false, err
		}
		return true, insertAttentionEvent(ctx, tx, instance.OrganizationID, instance.ID, instance.LeadID, "redistributed", "", map[string]any{"job_id": jobID})
	}
	reason := strings.TrimSpace(stoppedReason.String)
	if reason == "" {
		reason = status
	}
	return true, repo.recordRedistributionBlocked(ctx, tx, instance, "job_"+reason)
}

func (repo Repository) recordRedistributionBlocked(ctx context.Context, tx pgx.Tx, instance *workerInstance, reason string) error {
	metadata := cloneMap(instance.Metadata)
	delete(metadata, "redistribution_job_id")
	metadata["redistribution_blocked_reason"] = reason
	metadata["redistribution_blocked_at"] = time.Now().UTC().Format(time.RFC3339Nano)
	repeatMinutes := instance.DefaultRepeatMinutes
	if instance.RepeatMinutes != nil && *instance.RepeatMinutes > 0 {
		repeatMinutes = *instance.RepeatMinutes
	}
	_, err := tx.Exec(ctx, `
		update public.lead_attention_instances
		set redistribution_attempts = redistribution_attempts + 1,
		    last_error = $3, metadata = $4::jsonb,
		    next_evaluation_at = now() + make_interval(mins => $5),
		    updated_at = now()
		where organization_id = $1::uuid and id = $2::uuid
	`, instance.OrganizationID, instance.ID, "redistribution:"+reason, jsonValue(metadata), maxInt(1, repeatMinutes))
	if err != nil {
		return err
	}
	instance.RedistributionAttempts++
	instance.Metadata = metadata
	if err := insertAttentionEvent(ctx, tx, instance.OrganizationID, instance.ID, instance.LeadID, "redistribution_blocked", "", map[string]any{"reason": reason}); err != nil {
		return err
	}
	return repo.notifyRedistributionBlocked(ctx, tx, *instance, reason)
}

func (repo Repository) notifyRedistributionBlocked(ctx context.Context, tx pgx.Tx, instance workerInstance, reason string) error {
	if !instance.NotificationsEnabled || instance.EngineMode != "enabled" || instance.Shadow || !instance.NotifyAdmins {
		return nil
	}
	rows, err := tx.Query(ctx, `
		select distinct om.user_id::text
		from public.organization_members om
		join public.users u on u.id = om.user_id
		where om.organization_id = $1::uuid
		  and coalesce(om.is_active, true) = true and coalesce(u.is_active, true) = true
		  and lower(coalesce(om.role, '')) in ('owner', 'admin', 'manager')
	`, instance.OrganizationID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var userID string
		if err := rows.Scan(&userID); err != nil {
			return err
		}
		dedupe := NotificationDedupeKey(instance.PolicyID, instance.LeadID, instance.CycleKey, userID, "redistribution_blocked", reason)
		metadata := map[string]any{
			"event_key":    "lead_attention_redistribution_blocked",
			"dedupe_key":   dedupe,
			"attention_id": instance.ID,
			"reason":       reason,
			"dispatch": map[string]any{
				"push": map[string]any{"required": true, "status": "pending"},
			},
		}
		_, err := tx.Exec(ctx, `
			insert into public.notifications (
				organization_id, user_id, title, content, body, type,
				channel, lead_id, target_url, metadata
			) values (
				$1::uuid, $2::uuid, 'Redistribuição automática bloqueada', $3, $3,
				'lead_attention', 'in_app', $4::uuid,
				'/crm/pipelines?lead=' || $4::text, $5::jsonb
			) on conflict do nothing
		`, instance.OrganizationID, userID,
			fmt.Sprintf("O lead %s não foi redistribuído: %s.", instance.LeadName, redistributionReasonText(reason)),
			instance.LeadID, jsonValue(metadata))
		if err != nil {
			return err
		}
	}
	return rows.Err()
}

func configBoolValue(config map[string]any, keys ...string) (bool, bool) {
	for _, key := range keys {
		if raw, exists := config[key]; exists {
			value, ok := raw.(bool)
			return value, ok
		}
	}
	if nested, ok := config["redistribution"].(map[string]any); ok {
		return configBoolValue(nested, keys...)
	}
	return false, false
}

func configString(config map[string]any, keys ...string) string {
	for _, key := range keys {
		if raw, exists := config[key]; exists {
			if value, ok := raw.(string); ok {
				return strings.TrimSpace(value)
			}
		}
	}
	if nested, ok := config["redistribution"].(map[string]any); ok {
		return configString(nested, keys...)
	}
	return ""
}

func configIntValue(config map[string]any, keys ...string) (int, bool) {
	for _, key := range keys {
		if raw, exists := config[key]; exists {
			switch value := raw.(type) {
			case float64:
				return int(value), true
			case int:
				return value, true
			}
		}
	}
	if nested, ok := config["redistribution"].(map[string]any); ok {
		return configIntValue(nested, keys...)
	}
	return 0, false
}

func redistributionReasonText(reason string) string {
	switch reason {
	case "human_outreach_recorded":
		return "já houve contato humano"
	case "future_appointment":
		return "existe compromisso futuro agendado"
	case "round_robin_missing":
		return "fila de distribuição não configurada"
	case "assignee_changed":
		return "o responsável mudou"
	default:
		return reason
	}
}

func maxInt(left, right int) int {
	if left > right {
		return left
	}
	return right
}
