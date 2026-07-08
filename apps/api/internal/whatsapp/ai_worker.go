package whatsapp

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/ai"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const (
	aiWorkerInterval          = 5 * time.Second
	aiFollowUpWorkerInterval  = time.Minute
	aiWorkerBatchLimit        = 10
	aiFollowUpBatchLimit      = 5
	aiJobMaxAttempts          = 3
	aiHumanPauseDuration      = 30 * time.Minute
	autoReplyJobType          = "whatsapp_ai_autoreply"
	autoFollowUpEventType     = "ai_followup_sent"
	autoFollowUpMessagePrefix = "ai-followup-"
)

type aiJob struct {
	ID             string
	OrganizationID string
	JobType        string
	Payload        map[string]any
	Attempts       int
}

type aiFollowUpCandidate struct {
	OrganizationID string
	LeadID         string
	LeadName       string
	ConversationID string
	SessionID      string
	OwnerUserID    string
	AgentID        string
	Template       string
	IntervalDays   int
}

func (handler Handler) StartAIWorker(ctx context.Context, logger *slog.Logger) {
	if handler.aiRunner == nil {
		return
	}
	if logger == nil {
		logger = slog.Default()
	}

	go func() {
		timer := time.NewTimer(3 * time.Second)
		defer timer.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-timer.C:
				if err := handler.ProcessAIJobs(ctx); err != nil && !errors.Is(err, context.Canceled) {
					logger.Error("whatsapp ai worker failed", "error", err)
				}
				timer.Reset(aiWorkerInterval)
			}
		}
	}()

	go func() {
		timer := time.NewTimer(15 * time.Second)
		defer timer.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-timer.C:
				if err := handler.ProcessAIFollowUps(ctx); err != nil && !errors.Is(err, context.Canceled) {
					logger.Error("whatsapp ai follow-up worker failed", "error", err)
				}
				timer.Reset(aiFollowUpWorkerInterval)
			}
		}
	}()
}

func (handler Handler) ProcessAIJobs(ctx context.Context) error {
	jobs, err := handler.repo.lockAIJobs(ctx, autoReplyJobType, aiWorkerBatchLimit)
	if err != nil {
		return err
	}

	for _, job := range jobs {
		jobErr := handler.processAIJob(ctx, job)
		if jobErr == nil {
			if err := handler.repo.completeAIJob(ctx, job.ID); err != nil {
				return err
			}
			continue
		}
		if err := handler.repo.retryOrFailAIJob(ctx, job, jobErr); err != nil {
			return err
		}
	}

	return nil
}

func (handler Handler) processAIJob(ctx context.Context, job aiJob) error {
	switch job.JobType {
	case autoReplyJobType:
		input, err := autoReplyInputFromPayload(job.Payload)
		if err != nil {
			return err
		}
		response, err := handler.runAutoReplyNow(ctx, input)
		if err != nil {
			return err
		}
		if response.Skipped {
			handler.repo.saveAIJobEvent(ctx, job.OrganizationID, "ai_autoreply_skipped", map[string]any{
				"jobId":          job.ID,
				"conversationId": input.ConversationID,
				"messageId":      input.MessageID,
				"reason":         response.Reason,
			}, "completed")
		}
		return nil
	default:
		return fmt.Errorf("%w: unsupported ai job type", ErrInvalidInput)
	}
}

func (handler Handler) ProcessAIFollowUps(ctx context.Context) error {
	candidates, err := handler.repo.lockDueAIFollowUps(ctx, aiFollowUpBatchLimit)
	if err != nil {
		return err
	}

	for _, candidate := range candidates {
		if err := handler.processAIFollowUp(ctx, candidate); err != nil {
			handler.repo.saveAIJobEvent(ctx, candidate.OrganizationID, "ai_followup_failed", map[string]any{
				"leadId":         candidate.LeadID,
				"conversationId": candidate.ConversationID,
				"sessionId":      candidate.SessionID,
				"error":          err.Error(),
			}, "failed")
			if scheduleErr := handler.repo.rescheduleAIFollowUp(ctx, candidate.OrganizationID, candidate.LeadID, 15*time.Minute); scheduleErr != nil {
				return scheduleErr
			}
		}
	}

	return nil
}

func (handler Handler) processAIFollowUp(ctx context.Context, candidate aiFollowUpCandidate) error {
	if enabled, err := handler.repo.isOrganizationAIModuleEnabled(ctx, candidate.OrganizationID); err != nil || !enabled {
		if err != nil {
			return err
		}
		return handler.repo.clearAIFollowUp(ctx, candidate.OrganizationID, candidate.LeadID)
	}
	if paused, err := handler.repo.isConversationAIPaused(ctx, candidate.OrganizationID, candidate.ConversationID); err != nil || paused {
		if err != nil {
			return err
		}
		return handler.repo.rescheduleAIFollowUp(ctx, candidate.OrganizationID, candidate.LeadID, aiHumanPauseDuration)
	}

	tenantContext, err := handler.repo.systemTenantForSession(ctx, candidate.OrganizationID, candidate.OwnerUserID)
	if err != nil {
		return err
	}

	response, err := handler.aiRunner.Run(ctx, tenantContext, ai.RunRequest{
		Message:        followUpPrompt(candidate),
		AgentID:        candidate.AgentID,
		LeadID:         candidate.LeadID,
		ConversationID: candidate.ConversationID,
		SessionID:      candidate.SessionID,
		Source:         "whatsapp_followup",
	})
	if err != nil {
		return err
	}

	output := strings.TrimSpace(response.Output)
	if output == "" {
		return handler.repo.scheduleNextAIFollowUp(ctx, candidate.OrganizationID, candidate.LeadID, candidate.IntervalDays)
	}

	clientMessageID := fmt.Sprintf("%s%s-%d", autoFollowUpMessagePrefix, candidate.LeadID, time.Now().UTC().Unix())
	sendResponse, err := handler.repo.SendMessage(ctx, tenantContext, candidate.ConversationID, sendMessageInput{
		Text:            output,
		SendSessionID:   candidate.SessionID,
		ClientMessageID: clientMessageID,
	})
	if err != nil {
		return err
	}
	if err := handler.repo.markAIFollowUpMessage(ctx, candidate, clientMessageID, response); err != nil {
		return err
	}
	if err := handler.repo.scheduleNextAIFollowUp(ctx, candidate.OrganizationID, candidate.LeadID, candidate.IntervalDays); err != nil {
		return err
	}

	handler.publishWhatsAppEvent(tenantContext, "whatsapp.ai_followup.sent", sendResponse.ConversationID, &candidate.LeadID, map[string]any{
		"conversationId":  sendResponse.ConversationID,
		"clientMessageId": sendResponse.ClientMessageID,
		"leadId":          candidate.LeadID,
		"agentId":         response.Agent.ID,
		"template":        candidate.Template,
	})
	handler.repo.saveAIJobEvent(ctx, candidate.OrganizationID, autoFollowUpEventType, map[string]any{
		"leadId":          candidate.LeadID,
		"conversationId":  candidate.ConversationID,
		"sessionId":       candidate.SessionID,
		"clientMessageId": sendResponse.ClientMessageID,
		"agentId":         response.Agent.ID,
		"agentName":       response.Agent.Name,
		"template":        candidate.Template,
	}, "completed")

	return nil
}

func (repo Repository) enqueueAutoReplyJob(ctx context.Context, input autoReplyInput) (bool, error) {
	payload := map[string]any{
		"organizationId": input.OrganizationID,
		"sessionId":      input.SessionID,
		"conversationId": input.ConversationID,
		"messageId":      input.MessageID,
		"text":           input.Text,
	}

	var queued bool
	err := repo.db.Pool().QueryRow(ctx, `
		with inserted as (
			insert into public.jobs (organization_id, job_type, payload, status, run_at)
			select $1::uuid, $2, $3::jsonb, 'queued', now()
			where not exists (
				select 1
				from public.jobs
				where organization_id = $1::uuid
				  and job_type = $2
				  and payload->>'messageId' = $4
				  and status in ('queued', 'processing', 'completed')
			)
			on conflict do nothing
			returning true
		)
		select coalesce((select true from inserted), false)
	`, input.OrganizationID, autoReplyJobType, jsonb(payload), input.MessageID).Scan(&queued)
	return queued, err
}

func (repo Repository) lockAIJobs(ctx context.Context, jobType string, limit int) ([]aiJob, error) {
	rows, err := repo.db.Pool().Query(ctx, `
		with next_jobs as (
			select id
			from public.jobs
			where job_type = $1
			  and (
			    status = 'queued'
			    or (status = 'processing' and locked_at < now() - interval '2 minutes')
			  )
			  and run_at <= now()
			order by run_at asc, created_at asc
			limit $2::integer
			for update skip locked
		)
		update public.jobs j
		set status = 'processing',
		    attempts = attempts + 1,
		    locked_at = now(),
		    updated_at = now()
		from next_jobs
		where j.id = next_jobs.id
		returning j.id::text, j.organization_id::text, j.job_type, coalesce(j.payload, '{}'::jsonb)::text, j.attempts
	`, jobType, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	jobs := []aiJob{}
	for rows.Next() {
		var job aiJob
		var payloadJSON string
		if err := rows.Scan(&job.ID, &job.OrganizationID, &job.JobType, &payloadJSON, &job.Attempts); err != nil {
			return nil, err
		}
		job.Payload = decodeObjectJSON(payloadJSON)
		jobs = append(jobs, job)
	}

	return jobs, rows.Err()
}

func (repo Repository) completeAIJob(ctx context.Context, jobID string) error {
	_, err := repo.db.Pool().Exec(ctx, `
		update public.jobs
		set status = 'completed',
		    last_error = null,
		    locked_at = null,
		    updated_at = now()
		where id = $1::uuid
	`, jobID)
	return err
}

func (repo Repository) retryOrFailAIJob(ctx context.Context, job aiJob, cause error) error {
	status := "queued"
	nextRun := time.Now().UTC().Add(time.Duration(maxInt(1, job.Attempts)*20) * time.Second)
	if job.Attempts >= aiJobMaxAttempts {
		status = "failed"
		nextRun = time.Now().UTC()
	}

	_, err := repo.db.Pool().Exec(ctx, `
		update public.jobs
		set status = $2,
		    run_at = $3::timestamptz,
		    last_error = $4,
		    locked_at = null,
		    updated_at = now()
		where id = $1::uuid
	`, job.ID, status, nextRun, truncateForJobError(cause.Error()))
	return err
}

func (repo Repository) lockDueAIFollowUps(ctx context.Context, limit int) ([]aiFollowUpCandidate, error) {
	rows, err := repo.db.Pool().Query(ctx, `
		with due as (
			select
				l.id as lead_id,
				l.organization_id,
				coalesce(nullif(l.name, ''), 'Lead') as lead_name,
				wc.id as conversation_id,
				ws.id as session_id,
				coalesce(ws.owner_user_id::text, '') as owner_user_id,
				coalesce(ws.advanced_settings->>'ai_auto_reply_agent_id', '') as agent_id,
				coalesce(nullif(ws.advanced_settings->>'ai_follow_up_template', ''), 'soft') as template,
				greatest(coalesce(
					case
						when coalesce(ws.advanced_settings->>'ai_follow_up_interval_days', '') ~ '^[0-9]+$'
						then (ws.advanced_settings->>'ai_follow_up_interval_days')::int
						else null
					end,
					3
				), 1) as interval_days
			from public.leads l
			join public.whatsapp_conversations wc
			  on wc.organization_id = l.organization_id
			 and wc.lead_id = l.id
			 and wc.deleted_at is null
			 and coalesce(wc.is_group, false) = false
			join public.whatsapp_sessions ws
			  on ws.organization_id = wc.organization_id
			 and ws.id = wc.session_id
			 and coalesce(ws.is_active, true) = true
			 and ws.status = 'connected'
			 and ws.provider = 'evolution_go'
			join public.organization_ai_settings settings
			  on settings.organization_id = l.organization_id
			 and settings.is_enabled = true
			where coalesce(l.deal_status, 'open') = 'open'
			  and l.next_follow_up_at is not null
			  and l.next_follow_up_at <= now()
			  and lower(coalesce(ws.advanced_settings->>'ai_auto_reply_enabled', 'false')) in ('true', '1', 'yes', 'sim')
			  and lower(coalesce(ws.advanced_settings->>'ai_follow_up_enabled', 'false')) in ('true', '1', 'yes', 'sim')
			  and not exists (
			    select 1
			    from public.whatsapp_messages wm
			    where wm.organization_id = l.organization_id
			      and wm.lead_id = l.id
			      and wm.from_me = true
			      and coalesce(wm.sent_at, wm.created_at) > l.next_follow_up_at - interval '15 minutes'
			      and coalesce(wm.metadata->>'ai_generated', 'false') <> 'true'
			  )
			order by l.next_follow_up_at asc
			limit $1::integer
			for update of l skip locked
		)
		update public.leads l
		set next_follow_up_at = now() + interval '15 minutes',
		    updated_at = now()
		from due
		where l.organization_id = due.organization_id
		  and l.id = due.lead_id
		returning
			due.organization_id::text,
			due.lead_id::text,
			due.lead_name,
			due.conversation_id::text,
			due.session_id::text,
			due.owner_user_id::text,
			due.agent_id,
			due.template,
			due.interval_days
	`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	candidates := []aiFollowUpCandidate{}
	for rows.Next() {
		var candidate aiFollowUpCandidate
		if err := rows.Scan(
			&candidate.OrganizationID,
			&candidate.LeadID,
			&candidate.LeadName,
			&candidate.ConversationID,
			&candidate.SessionID,
			&candidate.OwnerUserID,
			&candidate.AgentID,
			&candidate.Template,
			&candidate.IntervalDays,
		); err != nil {
			return nil, err
		}
		if candidate.IntervalDays <= 0 {
			candidate.IntervalDays = 3
		}
		candidates = append(candidates, candidate)
	}
	return candidates, rows.Err()
}

func (repo Repository) systemTenantForSession(ctx context.Context, organizationID string, ownerUserID string) (tenant.Context, error) {
	userID := strings.TrimSpace(ownerUserID)
	role := ""
	if userID != "" {
		role = repo.memberRole(ctx, organizationID, userID)
	}
	if userID == "" || role == "" {
		userID, role = repo.firstActiveOrganizationMember(ctx, organizationID)
	}
	if userID == "" {
		return tenant.Context{}, ErrInvalidReference
	}

	return tenant.Context{
		UserID:         userID,
		UserRole:       role,
		OrganizationID: organizationID,
		MemberRole:     role,
		Permissions:    []string{"*"},
	}, nil
}

func (repo Repository) isConversationAIPaused(ctx context.Context, organizationID string, conversationID string) (bool, error) {
	var paused bool
	err := repo.db.Pool().QueryRow(ctx, `
		select coalesce((
			select coalesce(human_override, false)
			       or (paused_until is not null and paused_until > now())
			from public.conversation_ai_state
			where organization_id = $1::uuid
			  and conversation_id = $2::uuid
			limit 1
		), false)
	`, organizationID, conversationID).Scan(&paused)
	return paused, err
}

func (repo Repository) pauseConversationAI(ctx context.Context, organizationID string, conversationID string, duration time.Duration, reason string) error {
	if duration <= 0 {
		duration = aiHumanPauseDuration
	}
	pausedUntil := time.Now().UTC().Add(duration)
	_, err := repo.db.Pool().Exec(ctx, `
		insert into public.conversation_ai_state (
			organization_id,
			conversation_id,
			memory,
			human_override,
			paused_until,
			updated_at
		)
		values ($1::uuid, $2::uuid, $3::jsonb, false, $4::timestamptz, now())
		on conflict (organization_id, conversation_id)
		do update set
			memory = coalesce(public.conversation_ai_state.memory, '{}'::jsonb) || excluded.memory,
			paused_until = greatest(coalesce(public.conversation_ai_state.paused_until, now()), excluded.paused_until),
			updated_at = now()
	`, organizationID, conversationID, jsonb(map[string]any{
		"last_human_takeover_reason": reason,
		"last_human_takeover_at":     time.Now().UTC().Format(time.RFC3339),
	}), pausedUntil)
	return err
}

func (repo Repository) markAIFollowUpMessage(ctx context.Context, candidate aiFollowUpCandidate, clientMessageID string, response ai.RunResponse) error {
	metadata := map[string]any{
		"ai_generated":       true,
		"ai_follow_up":       true,
		"ai_agent_id":        response.Agent.ID,
		"ai_agent_name":      response.Agent.Name,
		"ai_agent_type":      response.Agent.Type,
		"ai_mode":            response.Mode,
		"ai_follow_up_model": candidate.Template,
	}
	_, err := repo.db.Pool().Exec(ctx, `
		update public.whatsapp_messages
		set metadata = coalesce(metadata, '{}'::jsonb) || $4::jsonb,
		    updated_at = now()
		where organization_id = $1::uuid
		  and conversation_id = $2::uuid
		  and client_message_id = $3
	`, candidate.OrganizationID, candidate.ConversationID, clientMessageID, jsonb(metadata))
	return err
}

func (repo Repository) scheduleNextAIFollowUp(ctx context.Context, organizationID string, leadID string, intervalDays int) error {
	if intervalDays <= 0 {
		intervalDays = 3
	}
	_, err := repo.db.Pool().Exec(ctx, `
		update public.leads
		set next_follow_up_at = now() + ($3::integer * interval '1 day'),
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, organizationID, leadID, intervalDays)
	return err
}

func (repo Repository) rescheduleAIFollowUp(ctx context.Context, organizationID string, leadID string, delay time.Duration) error {
	if delay <= 0 {
		delay = 15 * time.Minute
	}
	_, err := repo.db.Pool().Exec(ctx, `
		update public.leads
		set next_follow_up_at = $3::timestamptz,
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, organizationID, leadID, time.Now().UTC().Add(delay))
	return err
}

func (repo Repository) clearAIFollowUp(ctx context.Context, organizationID string, leadID string) error {
	_, err := repo.db.Pool().Exec(ctx, `
		update public.leads
		set next_follow_up_at = null,
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, organizationID, leadID)
	return err
}

func (repo Repository) saveAIJobEvent(ctx context.Context, organizationID string, eventType string, payload map[string]any, status string) {
	if status == "" {
		status = "completed"
	}
	_, _ = repo.db.Pool().Exec(ctx, `
		insert into public.events (organization_id, event_type, entity_type, entity_id, payload, status, processed_at)
		values ($1::uuid, $2, 'ai', null, $3::jsonb, $4, now())
	`, organizationID, eventType, jsonb(payload), status)
}

func autoReplyInputFromPayload(payload map[string]any) (autoReplyInput, error) {
	input := autoReplyInput{
		OrganizationID: strings.TrimSpace(firstString(payload, "organizationId")),
		SessionID:      strings.TrimSpace(firstString(payload, "sessionId")),
		ConversationID: strings.TrimSpace(firstString(payload, "conversationId")),
		MessageID:      strings.TrimSpace(firstString(payload, "messageId")),
		Text:           strings.TrimSpace(firstString(payload, "text")),
	}
	if input.OrganizationID == "" || input.SessionID == "" || input.ConversationID == "" || input.MessageID == "" {
		return autoReplyInput{}, ErrInvalidInput
	}
	return input, nil
}

func followUpPrompt(candidate aiFollowUpCandidate) string {
	template := strings.ToLower(strings.TrimSpace(candidate.Template))
	style := "retome a conversa de forma curta, humana e sem pressao."
	switch template {
	case "property":
		style = "retome usando o interesse imobiliario do lead e convide para ver opcoes ou detalhes relevantes."
	case "visit":
		style = "retome conduzindo para uma visita ou proximo passo objetivo, sem parecer insistente."
	}
	return fmt.Sprintf("Gere uma mensagem curta de follow-up via WhatsApp para o lead %q. %s Nao diga que e IA, nao invente informacoes e use no maximo duas frases.", candidate.LeadName, style)
}

func truncateForJobError(value string) string {
	value = strings.TrimSpace(value)
	if len(value) > 600 {
		return value[:600]
	}
	return value
}

func isAIClientMessageID(value string) bool {
	value = strings.TrimSpace(value)
	return strings.HasPrefix(value, autoReplyClientMessagePrefix) || strings.HasPrefix(value, autoFollowUpMessagePrefix)
}

func maxInt(a int, b int) int {
	if a > b {
		return a
	}
	return b
}
