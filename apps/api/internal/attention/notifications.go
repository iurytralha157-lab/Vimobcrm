package attention

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type attentionRecipient struct {
	UserID string
	Kind   string
}

func (repo Repository) notifyInstance(ctx context.Context, tx pgx.Tx, instance workerInstance, evaluation Evaluation, repeatMinutes int, now time.Time) error {
	recipients, err := repo.attentionRecipients(ctx, tx, instance)
	if err != nil {
		return err
	}
	location, err := time.LoadLocation(strings.TrimSpace(instance.Timezone))
	if err != nil {
		location, _ = time.LoadLocation("America/Sao_Paulo")
	}
	bucket := ReminderBucket(now, repeatMinutes, location)
	title, content := attentionNotificationText(instance, evaluation, now)
	for _, recipient := range recipients {
		dedupeKey := NotificationDedupeKey(instance.PolicyID, instance.LeadID, instance.CycleKey, recipient.UserID, evaluation.Level, bucket)
		metadata := map[string]any{
			"event_key":      "lead_attention_" + evaluation.Level,
			"dedupe_key":     dedupeKey,
			"attention_id":   instance.ID,
			"policy_id":      instance.PolicyID,
			"policy_version": instance.PolicyVersion,
			"policy_type":    instance.PolicyType,
			"cycle_key":      instance.CycleKey,
			"lead_name":      instance.LeadName,
			"level":          evaluation.Level,
			"recipient_kind": recipient.Kind,
			"reminder":       evaluation.Reminder,
			"due_at":         instance.DueAt.Format(time.RFC3339Nano),
			"dispatch": map[string]any{
				"push": map[string]any{"required": true, "status": "pending"},
			},
		}
		_, err := tx.Exec(ctx, `
			insert into public.notifications (
				organization_id, user_id, title, content, body, type,
				channel, lead_id, target_url, metadata
			) values (
				$1::uuid, $2::uuid, $3, $4, $4, 'lead_attention',
				'in_app', $5::uuid, '/crm/pipelines?lead=' || $5::text, $6::jsonb
			)
			on conflict do nothing
		`, instance.OrganizationID, recipient.UserID, title, content, instance.LeadID, jsonValue(metadata))
		if err != nil {
			return err
		}
	}
	return nil
}

func (repo Repository) attentionRecipients(ctx context.Context, tx pgx.Tx, instance workerInstance) ([]attentionRecipient, error) {
	byUserID := map[string]attentionRecipient{}
	if instance.NotifyAssignee && instance.AssignedUserID != nil && validUUID(*instance.AssignedUserID) {
		byUserID[*instance.AssignedUserID] = attentionRecipient{UserID: *instance.AssignedUserID, Kind: "assignee"}
	}
	if instance.NotifyLeaders && instance.AssignedUserID != nil && validUUID(*instance.AssignedUserID) {
		rows, err := tx.Query(ctx, `
			select distinct leader.user_id::text
			from public.team_members member
			join public.team_members leader
			  on leader.organization_id = member.organization_id
			 and leader.team_id = member.team_id
			where member.organization_id = $1::uuid
			  and member.user_id = $2::uuid
			  and coalesce(member.is_active, true) = true
			  and coalesce(leader.is_active, true) = true
			  and coalesce(leader.is_leader, false) = true
		`, instance.OrganizationID, *instance.AssignedUserID)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var userID string
			if err := rows.Scan(&userID); err != nil {
				rows.Close()
				return nil, err
			}
			if _, exists := byUserID[userID]; !exists {
				byUserID[userID] = attentionRecipient{UserID: userID, Kind: "leader"}
			}
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, err
		}
		rows.Close()
	}
	if instance.NotifyLeaders && instance.AssignedUserID == nil && instance.PipelineID != nil && validUUID(*instance.PipelineID) {
		rows, err := tx.Query(ctx, `
			select distinct leader.user_id::text
			from public.team_pipelines tp
			join public.team_members leader
			  on leader.organization_id = tp.organization_id
			 and leader.team_id = tp.team_id
			where tp.organization_id = $1::uuid
			  and tp.pipeline_id = $2::uuid
			  and coalesce(leader.is_active, true) = true
			  and coalesce(leader.is_leader, false) = true
		`, instance.OrganizationID, *instance.PipelineID)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var userID string
			if err := rows.Scan(&userID); err != nil {
				rows.Close()
				return nil, err
			}
			if _, exists := byUserID[userID]; !exists {
				byUserID[userID] = attentionRecipient{UserID: userID, Kind: "leader"}
			}
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, err
		}
		rows.Close()
	}
	if instance.NotifyAdmins {
		rows, err := tx.Query(ctx, `
			select distinct om.user_id::text
			from public.organization_members om
			join public.users u on u.id = om.user_id
			where om.organization_id = $1::uuid
			  and coalesce(om.is_active, true) = true
			  and coalesce(u.is_active, true) = true
			  and lower(coalesce(om.role, '')) in ('owner', 'admin', 'manager')
		`, instance.OrganizationID)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var userID string
			if err := rows.Scan(&userID); err != nil {
				rows.Close()
				return nil, err
			}
			if _, exists := byUserID[userID]; !exists {
				byUserID[userID] = attentionRecipient{UserID: userID, Kind: "admin"}
			}
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return nil, err
		}
		rows.Close()
	}
	recipients := make([]attentionRecipient, 0, len(byUserID))
	for _, recipient := range byUserID {
		recipients = append(recipients, recipient)
	}
	return recipients, nil
}

func attentionNotificationText(instance workerInstance, evaluation Evaluation, now time.Time) (string, string) {
	leadName := strings.TrimSpace(instance.LeadName)
	if leadName == "" {
		leadName = "Lead"
	}
	policyName := strings.TrimSpace(instance.PolicyName)
	if policyName == "" {
		policyName = "cadência de atendimento"
	}
	remaining := instance.DueAt.Sub(now).Round(time.Minute)
	overdue := now.Sub(instance.DueAt).Round(time.Minute)
	if instance.PolicyType == "cadence_task" {
		taskTitle := strings.TrimSpace(stringMapValue(instance.Metadata, "task_title"))
		if taskTitle == "" {
			taskTitle = "Tarefa da cadencia"
		}
		switch evaluation.Level {
		case "warning":
			return "Cadencia prestes a vencer", fmt.Sprintf("%s: %s precisa ser feita em ate %s.", leadName, taskTitle, humanDuration(remaining))
		case "escalated":
			return "Cadencia exige atencao da gestao", fmt.Sprintf("%s: %s esta atrasada ha %s.", leadName, taskTitle, humanDuration(overdue))
		default:
			return "Tarefa de cadencia pendente", fmt.Sprintf("%s: %s venceu ha %s. Conclua ou reprograme o atendimento.", leadName, taskTitle, humanDuration(overdue))
		}
	}
	switch evaluation.Level {
	case "warning":
		return "Prazo do lead se aproximando", fmt.Sprintf("%s precisa de ação em até %s (%s).", leadName, humanDuration(remaining), policyName)
	case "escalated":
		return "Lead exige escalação", fmt.Sprintf("%s excedeu o prazo em %s e exige atenção da gestão (%s).", leadName, humanDuration(overdue), policyName)
	default:
		return "Lead excedeu o prazo", fmt.Sprintf("%s está parado há %s além do prazo configurado (%s).", leadName, humanDuration(overdue), policyName)
	}
}

func humanDuration(value time.Duration) string {
	if value < 0 {
		value = -value
	}
	minutes := int(value.Round(time.Minute).Minutes())
	if minutes < 1 {
		return "menos de 1 minuto"
	}
	if minutes < 60 {
		return fmt.Sprintf("%d min", minutes)
	}
	hours := minutes / 60
	remaining := minutes % 60
	if remaining == 0 {
		return fmt.Sprintf("%dh", hours)
	}
	return fmt.Sprintf("%dh%02d", hours, remaining)
}
