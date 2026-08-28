package cadences

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const (
	maxOperationalRuleMinutes = 5 * 365 * 24 * 60
	maxOperationalRuleTasks   = 100
)

type OperationalRules struct {
	StageID    string                   `json:"stage_id"`
	PipelineID string                   `json:"pipeline_id"`
	Revision   int64                    `json:"revision"`
	Cadence    OperationalCadenceRule   `json:"cadence"`
	Attention  OperationalAttentionRule `json:"attention"`
	Lifecycle  OperationalLifecycleRule `json:"lifecycle"`
}

type OperationalRulesRequest struct {
	StageID    string                   `json:"stage_id,omitempty"`
	PipelineID string                   `json:"pipeline_id,omitempty"`
	Revision   *int64                   `json:"revision"`
	Cadence    OperationalCadenceRule   `json:"cadence"`
	Attention  OperationalAttentionRule `json:"attention"`
	Lifecycle  OperationalLifecycleRule `json:"lifecycle"`
}

type OperationalCadenceRule struct {
	Enabled    bool                     `json:"enabled"`
	TemplateID *string                  `json:"template_id,omitempty"`
	Tasks      []OperationalCadenceTask `json:"tasks"`
}

type OperationalCadenceTask struct {
	ID                 *string `json:"id,omitempty"`
	Position           int     `json:"position"`
	Type               string  `json:"type"`
	Title              string  `json:"title"`
	Description        *string `json:"description,omitempty"`
	Observation        *string `json:"observation,omitempty"`
	RecommendedMessage *string `json:"recommended_message,omitempty"`
	DueMinutes         int     `json:"due_minutes"`
	WarningMinutes     *int    `json:"warning_minutes,omitempty"`
	IsRequired         bool    `json:"is_required"`
	OutcomeRequired    bool    `json:"outcome_required"`
}

type OperationalAttentionRule struct {
	SourceMode                   string `json:"source_mode"`
	Mode                         string `json:"mode"`
	FirstOutreachMinutes         *int   `json:"first_outreach_minutes,omitempty"`
	FirstEffectiveContactMinutes *int   `json:"first_effective_contact_minutes,omitempty"`
	StageInactivityMinutes       *int   `json:"stage_inactivity_minutes,omitempty"`
	StageMaxAgeMinutes           *int   `json:"stage_max_age_minutes,omitempty"`
	WarningMinutes               int    `json:"warning_minutes"`
	EscalationMinutes            *int   `json:"escalation_minutes,omitempty"`
	BusinessHoursOnly            bool   `json:"business_hours_only"`
}

type OperationalLifecycleRule struct {
	OnStageMove string `json:"on_stage_move"`
	OnWon       string `json:"on_won"`
	OnLost      string `json:"on_lost"`
	OnReopen    string `json:"on_reopen"`
}

type operationalStage struct {
	ID         string
	PipelineID string
	StageKey   string
	Name       string
}

func defaultOperationalLifecycleRule() OperationalLifecycleRule {
	return OperationalLifecycleRule{
		OnStageMove: "skip_pending",
		OnWon:       "cancel_pending",
		OnLost:      "cancel_pending",
		OnReopen:    "new_cycle",
	}
}

func normalizeOperationalRulesRequest(stageID string, request OperationalRulesRequest) (OperationalRulesRequest, error) {
	normalizedStageID, ok := normalizeUUID(stageID)
	if !ok {
		return OperationalRulesRequest{}, fmt.Errorf("%w: stage id is invalid", ErrInvalidInput)
	}
	if request.StageID != "" {
		bodyStageID, valid := normalizeUUID(request.StageID)
		if !valid || bodyStageID != normalizedStageID {
			return OperationalRulesRequest{}, fmt.Errorf("%w: stage_id does not match the route", ErrInvalidInput)
		}
	}
	request.StageID = normalizedStageID
	if request.PipelineID != "" {
		pipelineID, valid := normalizeUUID(request.PipelineID)
		if !valid {
			return OperationalRulesRequest{}, fmt.Errorf("%w: pipeline_id is invalid", ErrInvalidInput)
		}
		request.PipelineID = pipelineID
	}
	if request.Revision == nil || *request.Revision < 0 {
		return OperationalRulesRequest{}, fmt.Errorf("%w: revision is required", ErrInvalidInput)
	}

	if request.Cadence.Tasks == nil {
		request.Cadence.Tasks = []OperationalCadenceTask{}
	}
	if len(request.Cadence.Tasks) > maxOperationalRuleTasks {
		return OperationalRulesRequest{}, fmt.Errorf("%w: cadence supports at most %d tasks", ErrInvalidInput, maxOperationalRuleTasks)
	}
	taskIDs := map[string]struct{}{}
	taskPositions := map[int]struct{}{}
	for index := range request.Cadence.Tasks {
		task := &request.Cadence.Tasks[index]
		if task.ID != nil {
			taskID, valid := normalizeUUID(*task.ID)
			if !valid {
				return OperationalRulesRequest{}, fmt.Errorf("%w: task id is invalid", ErrInvalidInput)
			}
			if _, duplicate := taskIDs[taskID]; duplicate {
				return OperationalRulesRequest{}, fmt.Errorf("%w: cadence task ids must be unique", ErrInvalidInput)
			}
			taskIDs[taskID] = struct{}{}
			task.ID = &taskID
		}
		task.Type = strings.ToLower(strings.TrimSpace(task.Type))
		task.Title = strings.TrimSpace(task.Title)
		if !validOperationalTaskType(task.Type) {
			return OperationalRulesRequest{}, fmt.Errorf("%w: cadence task type is invalid", ErrInvalidInput)
		}
		if task.Title == "" || utf8.RuneCountInString(task.Title) > 180 {
			return OperationalRulesRequest{}, fmt.Errorf("%w: cadence task title is required and must have at most 180 characters", ErrInvalidInput)
		}
		if task.Position < 0 || task.DueMinutes < 0 || task.DueMinutes > maxOperationalRuleMinutes {
			return OperationalRulesRequest{}, fmt.Errorf("%w: cadence task position or due_minutes is invalid", ErrInvalidInput)
		}
		if _, duplicate := taskPositions[task.Position]; duplicate {
			return OperationalRulesRequest{}, fmt.Errorf("%w: cadence task positions must be unique", ErrInvalidInput)
		}
		taskPositions[task.Position] = struct{}{}
		if task.WarningMinutes != nil {
			if *task.WarningMinutes < 0 ||
				(*task.WarningMinutes > 0 && *task.WarningMinutes >= task.DueMinutes) {
				return OperationalRulesRequest{}, fmt.Errorf("%w: cadence task warning_minutes is invalid", ErrInvalidInput)
			}
		}
		var err error
		task.Description, err = cleanOperationalString(task.Description, 2_000)
		if err != nil {
			return OperationalRulesRequest{}, fmt.Errorf("%w: cadence task description is too long", ErrInvalidInput)
		}
		task.Observation, err = cleanOperationalString(task.Observation, 2_000)
		if err != nil {
			return OperationalRulesRequest{}, fmt.Errorf("%w: cadence task observation is too long", ErrInvalidInput)
		}
		task.RecommendedMessage, err = cleanOperationalString(task.RecommendedMessage, 4_000)
		if err != nil {
			return OperationalRulesRequest{}, fmt.Errorf("%w: cadence task recommended_message is too long", ErrInvalidInput)
		}
		if task.OutcomeRequired && task.Type == "note" {
			return OperationalRulesRequest{}, fmt.Errorf("%w: note tasks cannot require a contact outcome", ErrInvalidInput)
		}
	}

	request.Attention.Mode = strings.ToLower(strings.TrimSpace(request.Attention.Mode))
	request.Attention.SourceMode = strings.ToLower(strings.TrimSpace(request.Attention.SourceMode))
	if request.Attention.SourceMode == "" {
		// Backward compatibility for clients from before source_mode existed:
		// the old disabled state inherited broader policies, while an active
		// mode always represented an explicit stage override.
		if request.Attention.Mode == "disabled" {
			request.Attention.SourceMode = "inherit"
		} else {
			request.Attention.SourceMode = "local"
		}
	}
	switch request.Attention.SourceMode {
	case "inherit", "local":
	default:
		return OperationalRulesRequest{}, fmt.Errorf("%w: attention source_mode is invalid", ErrInvalidInput)
	}
	switch request.Attention.Mode {
	case "disabled", "shadow", "enabled":
	default:
		return OperationalRulesRequest{}, fmt.Errorf("%w: attention mode is invalid", ErrInvalidInput)
	}
	for name, value := range map[string]*int{
		"first_outreach_minutes":          request.Attention.FirstOutreachMinutes,
		"first_effective_contact_minutes": request.Attention.FirstEffectiveContactMinutes,
		"stage_inactivity_minutes":        request.Attention.StageInactivityMinutes,
		"stage_max_age_minutes":           request.Attention.StageMaxAgeMinutes,
	} {
		if value != nil && (*value <= 0 || *value > maxOperationalRuleMinutes) {
			return OperationalRulesRequest{}, fmt.Errorf("%w: %s is invalid", ErrInvalidInput, name)
		}
		if value != nil && request.Attention.WarningMinutes >= *value {
			return OperationalRulesRequest{}, fmt.Errorf("%w: warning_minutes must be lower than every enabled attention deadline", ErrInvalidInput)
		}
	}
	if request.Attention.WarningMinutes < 0 || request.Attention.WarningMinutes > maxOperationalRuleMinutes {
		return OperationalRulesRequest{}, fmt.Errorf("%w: warning_minutes is invalid", ErrInvalidInput)
	}
	if request.Attention.EscalationMinutes != nil &&
		(*request.Attention.EscalationMinutes <= 0 || *request.Attention.EscalationMinutes > maxOperationalRuleMinutes) {
		return OperationalRulesRequest{}, fmt.Errorf("%w: escalation_minutes is invalid", ErrInvalidInput)
	}

	expectedLifecycle := defaultOperationalLifecycleRule()
	if request.Lifecycle == (OperationalLifecycleRule{}) {
		request.Lifecycle = expectedLifecycle
	}
	if request.Lifecycle != expectedLifecycle {
		return OperationalRulesRequest{}, fmt.Errorf("%w: lifecycle behavior is fixed in this rollout", ErrInvalidInput)
	}
	return request, nil
}

func validOperationalTaskType(value string) bool {
	switch value {
	case "call", "message", "email", "note":
		return true
	default:
		return false
	}
}

func cleanOperationalString(value *string, maxRunes int) (*string, error) {
	if value == nil {
		return nil, nil
	}
	cleaned := strings.TrimSpace(*value)
	if cleaned == "" {
		return nil, nil
	}
	if utf8.RuneCountInString(cleaned) > maxRunes {
		return nil, ErrInvalidInput
	}
	return &cleaned, nil
}

func (repo Repository) GetOperationalRules(ctx context.Context, tenantContext tenant.Context, stageID string) (OperationalRules, error) {
	stageID, ok := normalizeUUID(stageID)
	if !ok {
		return OperationalRules{}, ErrInvalidInput
	}
	stage, err := repo.loadOperationalStage(ctx, repo.db.Pool(), tenantContext.OrganizationID, stageID, false)
	if err != nil {
		return OperationalRules{}, err
	}
	return repo.loadOperationalRules(ctx, repo.db.Pool(), tenantContext.OrganizationID, stage)
}

func (repo Repository) UpsertOperationalRules(ctx context.Context, tenantContext tenant.Context, stageID string, request OperationalRulesRequest) (OperationalRules, error) {
	if !canEditCadences(tenantContext) {
		return OperationalRules{}, tenant.ErrOrganizationAccessDenied
	}
	request, err := normalizeOperationalRulesRequest(stageID, request)
	if err != nil {
		return OperationalRules{}, err
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return OperationalRules{}, err
	}
	defer tx.Rollback(ctx)

	stage, err := repo.loadOperationalStage(ctx, tx, tenantContext.OrganizationID, request.StageID, true)
	if err != nil {
		return OperationalRules{}, err
	}
	if request.PipelineID != "" && request.PipelineID != stage.PipelineID {
		return OperationalRules{}, fmt.Errorf("%w: pipeline_id does not match the stage", ErrInvalidInput)
	}

	var currentRevision int64
	if err := tx.QueryRow(ctx, `
		select coalesce((
			select revision
			from public.stage_operational_configs
			where organization_id = $1::uuid and stage_id = $2::uuid
		), 0)
	`, tenantContext.OrganizationID, stage.ID).Scan(&currentRevision); err != nil {
		return OperationalRules{}, err
	}
	if *request.Revision != currentRevision {
		return OperationalRules{}, ErrOperationalRulesConflict
	}
	nextRevision := currentRevision + 1

	if _, err := tx.Exec(ctx, `
		insert into public.stage_operational_configs (
			organization_id, stage_id, operation_context,
			cadence_enabled, revision, attention_mode,
			first_outreach_minutes, first_effective_contact_minutes,
			stage_inactivity_minutes, stage_max_age_minutes,
			warning_minutes, escalation_minutes, business_hours_only,
			config, updated_at
		) values (
			$1::uuid, $2::uuid, 'comercial',
			$3, $13, $4,
			$5, $6,
			$7, $8,
			$9, $10, $11,
			jsonb_build_object(
				'operational_rules_version', 1,
				'attention_source_mode', $12,
				'lifecycle', jsonb_build_object(
					'on_stage_move', 'skip_pending',
					'on_won', 'cancel_pending',
					'on_lost', 'cancel_pending',
					'on_reopen', 'new_cycle'
				)
			),
			now()
		)
		on conflict (organization_id, stage_id) do update
		set cadence_enabled = excluded.cadence_enabled,
		    revision = excluded.revision,
		    attention_mode = excluded.attention_mode,
		    first_outreach_minutes = excluded.first_outreach_minutes,
		    first_effective_contact_minutes = excluded.first_effective_contact_minutes,
		    stage_inactivity_minutes = excluded.stage_inactivity_minutes,
		    stage_max_age_minutes = excluded.stage_max_age_minutes,
		    warning_minutes = excluded.warning_minutes,
		    escalation_minutes = excluded.escalation_minutes,
		    business_hours_only = excluded.business_hours_only,
		    config = coalesce(stage_operational_configs.config, '{}'::jsonb) || excluded.config,
		    updated_at = now()
	`, tenantContext.OrganizationID, stage.ID,
		request.Cadence.Enabled, request.Attention.Mode,
		nullableRuleInt(request.Attention.FirstOutreachMinutes),
		nullableRuleInt(request.Attention.FirstEffectiveContactMinutes),
		nullableRuleInt(request.Attention.StageInactivityMinutes),
		nullableRuleInt(request.Attention.StageMaxAgeMinutes),
		request.Attention.WarningMinutes,
		nullableRuleInt(request.Attention.EscalationMinutes),
		request.Attention.BusinessHoursOnly,
		request.Attention.SourceMode,
		nextRevision,
	); err != nil {
		return OperationalRules{}, err
	}

	templateID, err := repo.ensureOperationalTemplate(ctx, tx, tenantContext, stage, request.Cadence.Enabled)
	if err != nil {
		return OperationalRules{}, err
	}
	if _, err := tx.Exec(ctx, `
		update public.stage_operational_configs
		set config = jsonb_set(
		      coalesce(config, '{}'::jsonb),
		      '{cadence_template_id}',
		      to_jsonb($3::text),
		      true
		    ),
		    updated_at = now()
		where organization_id = $1::uuid and stage_id = $2::uuid
	`, tenantContext.OrganizationID, stage.ID, templateID); err != nil {
		return OperationalRules{}, err
	}
	if err := repo.replaceOperationalTemplateTasks(ctx, tx, tenantContext, templateID, request.Cadence.Tasks); err != nil {
		return OperationalRules{}, err
	}
	if err := repo.syncCurrentStageCadence(ctx, tx, tenantContext, stage, request); err != nil {
		return OperationalRules{}, err
	}
	if err := repo.syncOperationalAttentionPolicies(ctx, tx, tenantContext, stage, request); err != nil {
		return OperationalRules{}, err
	}

	updated, err := repo.loadOperationalRules(ctx, tx, tenantContext.OrganizationID, stage)
	if err != nil {
		return OperationalRules{}, err
	}
	if _, err := tx.Exec(ctx, `
		insert into public.audit_logs (
			organization_id, user_id, action, entity_type, entity_id, new_data
		) values (
			$1::uuid, $2::uuid, 'stage_operational_rules_updated',
			'stage', $3, $4::jsonb
		)
	`, tenantContext.OrganizationID, tenantContext.UserID, stage.ID, jsonb(updated)); err != nil {
		return OperationalRules{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return OperationalRules{}, err
	}
	return updated, nil
}

type operationalQueryer interface {
	QueryRow(context.Context, string, ...any) pgx.Row
	Query(context.Context, string, ...any) (pgx.Rows, error)
}

func (repo Repository) loadOperationalStage(ctx context.Context, queryer operationalQueryer, organizationID, stageID string, lock bool) (operationalStage, error) {
	lockClause := ""
	if lock {
		lockClause = " for update of s"
	}
	var stage operationalStage
	err := queryer.QueryRow(ctx, `
		select s.id::text, s.pipeline_id::text, s.stage_key, s.name
		from public.stages s
		where s.organization_id = $1::uuid and s.id = $2::uuid`+lockClause,
		organizationID, stageID,
	).Scan(&stage.ID, &stage.PipelineID, &stage.StageKey, &stage.Name)
	if errors.Is(err, pgx.ErrNoRows) {
		return operationalStage{}, ErrCadenceNotFound
	}
	return stage, err
}

func (repo Repository) loadOperationalRules(ctx context.Context, queryer operationalQueryer, organizationID string, stage operationalStage) (OperationalRules, error) {
	rules := OperationalRules{
		StageID:    stage.ID,
		PipelineID: stage.PipelineID,
		Cadence: OperationalCadenceRule{
			Tasks: []OperationalCadenceTask{},
		},
		Attention: OperationalAttentionRule{
			SourceMode:        "inherit",
			Mode:              "disabled",
			WarningMinutes:    0,
			BusinessHoursOnly: false,
		},
		Lifecycle: defaultOperationalLifecycleRule(),
	}

	var templateID pgtype.Text
	var inheritedTemplate bool
	var firstOutreach, firstEffectiveContact, inactivity, maxAge, escalation pgtype.Int4
	err := queryer.QueryRow(ctx, `
		select
			coalesce(soc.cadence_enabled, false),
			coalesce(soc.revision, 0),
			coalesce(soc.attention_mode, 'disabled'),
			soc.first_outreach_minutes,
			soc.first_effective_contact_minutes,
			soc.stage_inactivity_minutes,
			soc.stage_max_age_minutes,
			coalesce(soc.warning_minutes, 0),
			soc.escalation_minutes,
			coalesce(soc.business_hours_only, false),
			coalesce(
			  nullif(soc.config->>'attention_source_mode', ''),
			  case
			    when coalesce(soc.config->>'operational_rules_version', '') = '1'
			         and coalesce(soc.attention_mode, 'disabled') <> 'disabled'
			      then 'local'
			    else 'inherit'
			  end
			),
			selected_template.id::text,
			coalesce(selected_template.inherited, false)
		from public.stages s
		left join public.stage_operational_configs soc
		  on soc.organization_id = s.organization_id and soc.stage_id = s.id
		left join lateral (
			select
				ct.id,
				(
				  nullif(soc.config->>'cadence_template_id', '') is null
				  or ct.id::text <> soc.config->>'cadence_template_id'
				) as inherited
			from public.cadence_templates ct
			where ct.organization_id = s.organization_id
			  and (
				ct.stage_id = s.id
				or (
					ct.stage_id is null
					and ct.pipeline_id = s.pipeline_id
					and ct.stage_key = s.stage_key
				)
				or (
					ct.stage_id is null
					and ct.pipeline_id is null
					and ct.stage_key = s.stage_key
				)
			  )
			order by
				(ct.id::text = nullif(soc.config->>'cadence_template_id', '')) desc,
				case
					when ct.stage_id = s.id then 3
					when ct.pipeline_id = s.pipeline_id then 2
					else 1
				end desc,
				ct.updated_at desc,
				ct.id
			limit 1
		) selected_template on true
		where s.organization_id = $1::uuid and s.id = $2::uuid
	`, organizationID, stage.ID).Scan(
		&rules.Cadence.Enabled,
		&rules.Revision,
		&rules.Attention.Mode,
		&firstOutreach,
		&firstEffectiveContact,
		&inactivity,
		&maxAge,
		&rules.Attention.WarningMinutes,
		&escalation,
		&rules.Attention.BusinessHoursOnly,
		&rules.Attention.SourceMode,
		&templateID,
		&inheritedTemplate,
	)
	if err != nil {
		return OperationalRules{}, err
	}
	rules.Attention.FirstOutreachMinutes = pgIntPointer(firstOutreach)
	rules.Attention.FirstEffectiveContactMinutes = pgIntPointer(firstEffectiveContact)
	rules.Attention.StageInactivityMinutes = pgIntPointer(inactivity)
	rules.Attention.StageMaxAgeMinutes = pgIntPointer(maxAge)
	rules.Attention.EscalationMinutes = pgIntPointer(escalation)
	if !templateID.Valid {
		return rules, nil
	}
	if !inheritedTemplate {
		rules.Cadence.TemplateID = &templateID.String
	}

	rows, err := queryer.Query(ctx, `
		select
			id::text,
			position,
			coalesce(type, 'call'),
			title,
			description,
			observation,
			recommended_message,
			coalesce(due_minutes, greatest(0, delay_days) * 1440),
			warning_minutes,
			coalesce(is_required, true),
			coalesce(outcome_required, false)
		from public.cadence_tasks_template
		where organization_id = $1::uuid and cadence_template_id = $2::uuid
		order by position, due_minutes, created_at, id
	`, organizationID, templateID.String)
	if err != nil {
		return OperationalRules{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var task OperationalCadenceTask
		var taskID pgtype.Text
		var position pgtype.Int4
		var description, observation, recommendedMessage pgtype.Text
		var warning pgtype.Int4
		if err := rows.Scan(
			&taskID,
			&position,
			&task.Type,
			&task.Title,
			&description,
			&observation,
			&recommendedMessage,
			&task.DueMinutes,
			&warning,
			&task.IsRequired,
			&task.OutcomeRequired,
		); err != nil {
			return OperationalRules{}, err
		}
		if taskID.Valid && !inheritedTemplate {
			task.ID = &taskID.String
		}
		if position.Valid {
			task.Position = int(position.Int32)
		}
		task.Description = textPointer(description)
		task.Observation = textPointer(observation)
		task.RecommendedMessage = textPointer(recommendedMessage)
		task.WarningMinutes = pgIntPointer(warning)
		rules.Cadence.Tasks = append(rules.Cadence.Tasks, task)
	}
	if err := rows.Err(); err != nil {
		return OperationalRules{}, err
	}
	return rules, nil
}

func (repo Repository) ensureOperationalTemplate(ctx context.Context, tx pgx.Tx, tenantContext tenant.Context, stage operationalStage, enabled bool) (string, error) {
	var templateID string
	err := tx.QueryRow(ctx, `
		select ct.id::text
		from public.stage_operational_configs soc
		join public.cadence_templates ct
		  on ct.organization_id = soc.organization_id
		 and ct.id = case
		   when coalesce(soc.config->>'cadence_template_id', '') ~*
		     '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
		     then (soc.config->>'cadence_template_id')::uuid
		   else null
		 end
		where soc.organization_id = $1::uuid
		  and soc.stage_id = $2::uuid
		  and ct.stage_id = $2::uuid
		for update of ct
	`, tenantContext.OrganizationID, stage.ID).Scan(&templateID)
	if errors.Is(err, pgx.ErrNoRows) {
		err = tx.QueryRow(ctx, `
			insert into public.cadence_templates (
				organization_id, pipeline_id, stage_id, stage_key,
				name, description, is_active, created_by
			) values (
				$1::uuid, $2::uuid, $3::uuid, $4,
				$5, 'Template exclusivo das regras operacionais da etapa', $6, $7::uuid
			)
			returning id::text
		`, tenantContext.OrganizationID, stage.PipelineID, stage.ID, stage.StageKey,
			stage.Name, enabled, tenantContext.UserID).Scan(&templateID)
		return templateID, err
	}
	if err != nil {
		return "", err
	}
	_, err = tx.Exec(ctx, `
		update public.cadence_templates
		set pipeline_id = $3::uuid,
		    stage_id = $2::uuid,
		    stage_key = $4,
		    is_active = $5,
		    updated_at = now()
		where organization_id = $1::uuid and id = $6::uuid
	`, tenantContext.OrganizationID, stage.ID, stage.PipelineID, stage.StageKey, enabled, templateID)
	return templateID, err
}

func (repo Repository) replaceOperationalTemplateTasks(ctx context.Context, tx pgx.Tx, tenantContext tenant.Context, templateID string, tasks []OperationalCadenceTask) error {
	var revisionID string
	if err := tx.QueryRow(ctx, `select gen_random_uuid()::text`).Scan(&revisionID); err != nil {
		return err
	}
	for _, task := range tasks {
		metadata := map[string]any{
			"source":                    "stage_operational_rules",
			"operational_rule_revision": revisionID,
			"description":               pointerValue(task.Description),
			"observation":               pointerValue(task.Observation),
			"recommended_message":       pointerValue(task.RecommendedMessage),
			"due_minutes":               task.DueMinutes,
			"warning_minutes":           nullableRuleInt(task.WarningMinutes),
			"is_required":               task.IsRequired,
			"outcome_required":          task.OutcomeRequired,
		}
		if task.ID == nil {
			if _, err := tx.Exec(ctx, `
				insert into public.cadence_tasks_template (
					organization_id, cadence_template_id,
					title, description, type, position,
					day_offset, delay_days, due_minutes, warning_minutes,
					observation, recommended_message, message_template,
					is_required, outcome_required, metadata
				) values (
					$1::uuid, $2::uuid,
					$3, $4, $5, $6,
					$7, $7, $8, $9,
					$10, $11, $11,
					$12, $13, $14::jsonb
				)
			`, tenantContext.OrganizationID, templateID,
				task.Title, textOrNil(task.Description), task.Type, task.Position,
				task.DueMinutes/1440, task.DueMinutes, operationalWarningMinutes(task.WarningMinutes),
				textOrNil(task.Observation), textOrNil(task.RecommendedMessage),
				task.IsRequired, task.OutcomeRequired, jsonb(metadata),
			); err != nil {
				return err
			}
			continue
		}
		tag, err := tx.Exec(ctx, `
			update public.cadence_tasks_template
			set title = $4,
			    description = $5,
			    type = $6,
			    position = $7,
			    day_offset = $8,
			    delay_days = $8,
			    due_minutes = $9,
			    warning_minutes = $10,
			    observation = $11,
			    recommended_message = $12,
			    message_template = $12,
			    is_required = $13,
			    outcome_required = $14,
			    metadata = $15::jsonb,
			    updated_at = now()
			where organization_id = $1::uuid
			  and cadence_template_id = $2::uuid
			  and id = $3::uuid
		`, tenantContext.OrganizationID, templateID, *task.ID,
			task.Title, textOrNil(task.Description), task.Type, task.Position,
			task.DueMinutes/1440, task.DueMinutes, operationalWarningMinutes(task.WarningMinutes),
			textOrNil(task.Observation), textOrNil(task.RecommendedMessage),
			task.IsRequired, task.OutcomeRequired, jsonb(metadata),
		)
		if err != nil {
			return err
		}
		if tag.RowsAffected() == 0 {
			return fmt.Errorf("%w: cadence task does not belong to this stage", ErrInvalidInput)
		}
	}
	_, err := tx.Exec(ctx, `
		delete from public.cadence_tasks_template
		where organization_id = $1::uuid
		  and cadence_template_id = $2::uuid
		  and coalesce(metadata->>'operational_rule_revision', '') <> $3
	`, tenantContext.OrganizationID, templateID, revisionID)
	return err
}

func (repo Repository) syncCurrentStageCadence(
	ctx context.Context,
	tx pgx.Tx,
	tenantContext tenant.Context,
	stage operationalStage,
	request OperationalRulesRequest,
) error {
	cadenceActive := request.Cadence.Enabled && len(request.Cadence.Tasks) > 0

	if !cadenceActive {
		reason := "stage_cadence_disabled"
		if request.Cadence.Enabled {
			reason = "stage_cadence_empty"
		}
		if _, err := tx.Exec(ctx, `
			update public.lead_tasks task
			set status = 'cancelled',
			    updated_at = now(),
			    metadata = coalesce(task.metadata, '{}'::jsonb) || jsonb_build_object(
			      'cancel_reason', $3,
			      'lifecycle_outcome', 'stage_rule_cancelled',
			      'cancelled_at', now()
			    )
			from public.cadence_enrollments enrollment
			join public.lead_stage_cycles cycle
			  on cycle.id = enrollment.stage_cycle_id
			 and cycle.organization_id = enrollment.organization_id
			where task.organization_id = $1::uuid
			  and task.cadence_enrollment_id = enrollment.id
			  and cycle.stage_id = $2::uuid
			  and enrollment.status in ('active', 'paused')
			  and coalesce(
			    task.status,
			    case when coalesce(task.is_done, false) then 'completed' else 'pending' end
			  ) = 'pending'
			  and coalesce(task.is_done, false) = false
		`, tenantContext.OrganizationID, stage.ID, reason); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `
			update public.cadence_enrollments enrollment
			set status = 'cancelled',
			    cancelled_at = now(),
			    cancel_reason = $3,
			    updated_at = now(),
			    metadata = coalesce(enrollment.metadata, '{}'::jsonb) || jsonb_build_object(
			      'cancel_reason', $3,
			      'cancelled_at', now()
			    )
			from public.lead_stage_cycles cycle
			where enrollment.organization_id = $1::uuid
			  and enrollment.stage_cycle_id = cycle.id
			  and cycle.organization_id = enrollment.organization_id
			  and cycle.stage_id = $2::uuid
			  and enrollment.status in ('active', 'paused')
		`, tenantContext.OrganizationID, stage.ID, reason); err != nil {
			return err
		}
	}

	// Activating or editing a stage rule never scans or reconstructs existing
	// leads. That keeps the manager transaction bounded and avoids a retroactive
	// backlog. The canonical lifecycle trigger starts the saved rule only when
	// a lead enters a fresh stage/assignment cycle.
	return nil
}

func (repo Repository) syncOperationalAttentionPolicies(ctx context.Context, tx pgx.Tx, tenantContext tenant.Context, stage operationalStage, request OperationalRulesRequest) error {
	if request.Attention.SourceMode == "inherit" {
		if err := repo.releaseOperationalAttentionPolicies(ctx, tx, tenantContext, stage); err != nil {
			return err
		}
	} else {
		policies := []struct {
			policyType string
			name       string
			threshold  *int
		}{
			{policyType: "first_contact", name: "Primeira tentativa de contato", threshold: request.Attention.FirstOutreachMinutes},
			{policyType: "first_effective_contact", name: "Primeiro contato efetivo", threshold: request.Attention.FirstEffectiveContactMinutes},
			{policyType: "stage_inactivity", name: "Inatividade na etapa", threshold: request.Attention.StageInactivityMinutes},
			{policyType: "stage_age", name: "Tempo máximo na etapa", threshold: request.Attention.StageMaxAgeMinutes},
		}
		for _, policy := range policies {
			if err := repo.replaceOperationalAttentionPolicy(ctx, tx, tenantContext, stage, request.Attention, policy.policyType, policy.name, policy.threshold); err != nil {
				return err
			}
		}
	}

	// A tarefa de cadência pertence à própria cadência, não aos quatro
	// overrides opcionais de atenção da etapa. Ela continua produzindo prazo e
	// aviso mesmo quando esses overrides herdam políticas mais amplas.
	cadencePolicyRule := OperationalAttentionRule{
		SourceMode: "local",
		Mode:       "enabled",
	}
	if request.Cadence.Enabled && len(request.Cadence.Tasks) > 0 {
		threshold := 1
		return repo.replaceOperationalAttentionPolicy(
			ctx,
			tx,
			tenantContext,
			stage,
			cadencePolicyRule,
			"cadence_task",
			"Tarefa de cadência",
			&threshold,
		)
	}
	return repo.releaseOperationalCadencePolicy(ctx, tx, tenantContext, stage)
}

func (repo Repository) releaseOperationalAttentionPolicies(
	ctx context.Context,
	tx pgx.Tx,
	tenantContext tenant.Context,
	stage operationalStage,
) error {
	rows, err := tx.Query(ctx, `
		update public.lead_attention_policies
		set status = 'archived',
		    config = coalesce(config, '{}'::jsonb) || jsonb_build_object(
		      'released_to_inheritance_at', now()
		    ),
		    updated_at = now()
		where organization_id = $1::uuid
		  and pipeline_id = $2::uuid
		  and stage_id = $3::uuid
		  and policy_type <> 'cadence_task'
		  and status <> 'archived'
		  and coalesce(config->>'source', '') = 'stage_operational_rules'
		returning id::text
	`, tenantContext.OrganizationID, stage.PipelineID, stage.ID)
	if err != nil {
		return err
	}
	defer rows.Close()

	policyIDs := make([]string, 0, 5)
	for rows.Next() {
		var policyID string
		if err := rows.Scan(&policyID); err != nil {
			return err
		}
		policyIDs = append(policyIDs, policyID)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	rows.Close()

	for _, policyID := range policyIDs {
		if err := cancelOperationalPolicyInstances(
			ctx,
			tx,
			tenantContext.OrganizationID,
			policyID,
			"stage_attention_inherited",
		); err != nil {
			return err
		}
	}
	return nil
}

func (repo Repository) releaseOperationalCadencePolicy(
	ctx context.Context,
	tx pgx.Tx,
	tenantContext tenant.Context,
	stage operationalStage,
) error {
	var policyID string
	err := tx.QueryRow(ctx, `
		update public.lead_attention_policies
		set status = 'archived',
		    config = coalesce(config, '{}'::jsonb) || jsonb_build_object(
		      'cadence_disabled_at', now()
		    ),
		    updated_at = now()
		where organization_id = $1::uuid
		  and pipeline_id = $2::uuid
		  and stage_id = $3::uuid
		  and policy_type = 'cadence_task'
		  and status <> 'archived'
		  and coalesce(config->>'source', '') = 'stage_operational_rules'
		returning id::text
	`, tenantContext.OrganizationID, stage.PipelineID, stage.ID).Scan(&policyID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	return cancelOperationalPolicyInstances(
		ctx,
		tx,
		tenantContext.OrganizationID,
		policyID,
		"stage_cadence_disabled",
	)
}

func (repo Repository) replaceOperationalAttentionPolicy(
	ctx context.Context,
	tx pgx.Tx,
	tenantContext tenant.Context,
	stage operationalStage,
	rule OperationalAttentionRule,
	policyType string,
	name string,
	threshold *int,
) error {
	suppressesInherited := rule.Mode == "disabled" || threshold == nil
	status := rule.Mode
	if suppressesInherited {
		status = "paused"
	} else if status != "enabled" {
		status = "shadow"
	}
	effectiveThreshold := 1
	if threshold != nil {
		effectiveThreshold = *threshold
	}
	warningMinutes := 0
	if !suppressesInherited {
		warningMinutes = rule.WarningMinutes
		if warningMinutes >= effectiveThreshold {
			warningMinutes = effectiveThreshold - 1
		}
		if warningMinutes < 0 {
			warningMinutes = 0
		}
	}
	var effectiveEscalation *int
	businessHoursOnly := false
	notifyRecipients := false
	if !suppressesInherited {
		effectiveEscalation = rule.EscalationMinutes
		businessHoursOnly = rule.BusinessHoursOnly
		notifyRecipients = true
	}

	var currentID, policyKey pgtype.Text
	var currentStatus, currentSource string
	var version int
	var currentThreshold, currentWarning int
	var currentRepeat, currentEscalation, currentRedistribution pgtype.Int4
	var currentBusinessHoursOnly, currentRedistributeBeforeContact bool
	var currentNotifyAssignee, currentNotifyLeaders, currentNotifyAdmins bool
	var currentSuppressesInherited bool
	err := tx.QueryRow(ctx, `
		select
			id::text,
			policy_key::text,
			version,
			status,
			threshold_minutes,
			warning_minutes,
			repeat_minutes,
			escalation_minutes,
			redistribution_minutes,
			business_hours_only,
			redistribute_before_contact_only,
			notify_assignee,
			notify_leaders,
			notify_admins,
			coalesce(config->>'source', ''),
			coalesce(lower(config->>'disabled_override') = 'true', false)
		from public.lead_attention_policies
		where organization_id = $1::uuid
		  and policy_type = $2
		  and pipeline_id = $3::uuid
		  and stage_id = $4::uuid
		  and status <> 'archived'
		  and (
		    coalesce(config->>'source', '') = 'stage_operational_rules'
		    or (
		      coalesce(lower(config->>'seeded') = 'true', false)
		      and coalesce(config->>'source', '') in (
		        'stage_operational_config',
		        'stage_sla_hours',
		        'stage_automation'
		      )
		    )
		  )
		for update
	`, tenantContext.OrganizationID, policyType, stage.PipelineID, stage.ID).Scan(
		&currentID,
		&policyKey,
		&version,
		&currentStatus,
		&currentThreshold,
		&currentWarning,
		&currentRepeat,
		&currentEscalation,
		&currentRedistribution,
		&currentBusinessHoursOnly,
		&currentRedistributeBeforeContact,
		&currentNotifyAssignee,
		&currentNotifyLeaders,
		&currentNotifyAdmins,
		&currentSource,
		&currentSuppressesInherited,
	)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}
	if currentID.Valid {
		if currentStatus == status &&
			currentThreshold == effectiveThreshold &&
			currentWarning == warningMinutes &&
			!currentRepeat.Valid &&
			operationalOptionalIntMatches(currentEscalation, effectiveEscalation) &&
			!currentRedistribution.Valid &&
			currentBusinessHoursOnly == businessHoursOnly &&
			currentRedistributeBeforeContact &&
			currentNotifyAssignee == notifyRecipients &&
			currentNotifyLeaders == notifyRecipients &&
			!currentNotifyAdmins &&
			currentSource == "stage_operational_rules" &&
			currentSuppressesInherited == suppressesInherited {
			return nil
		}

		_, err = tx.Exec(ctx, `
			update public.lead_attention_policies
			set name = $3,
			    status = $4,
			    threshold_minutes = $5,
			    warning_minutes = $6,
			    repeat_minutes = null,
			    escalation_minutes = $7,
			    redistribution_minutes = null,
			    business_hours_only = $8,
			    redistribute_before_contact_only = true,
			    notify_assignee = $9,
			    notify_leaders = $9,
			    notify_admins = false,
			    config = coalesce(config, '{}'::jsonb) || jsonb_build_object(
			      'source', 'stage_operational_rules',
			      'no_automatic_move', true,
			      'disabled_override', $10::boolean,
			      'effective_from', now(),
			      'adopted_from_source', case
			        when $11 = 'stage_operational_rules' then config->>'adopted_from_source'
			        else $11
			      end
			    ),
			    updated_at = now()
			where organization_id = $1::uuid and id = $2::uuid
		`, tenantContext.OrganizationID, currentID.String,
			name, status, effectiveThreshold, warningMinutes,
			nullableRuleInt(effectiveEscalation),
			businessHoursOnly,
			notifyRecipients,
			suppressesInherited,
			currentSource,
		)
		if err != nil {
			return err
		}
		if suppressesInherited {
			return cancelOperationalPolicyInstances(
				ctx,
				tx,
				tenantContext.OrganizationID,
				currentID.String,
				"stage_policy_disabled",
			)
		}
		_, err = tx.Exec(ctx, `
			update public.lead_attention_instances
			set shadow = true,
			    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
			      'grandfathered_shadow', true,
			      'policy_reconfigured_at', now()
			    ),
			    updated_at = now()
			where organization_id = $1::uuid
			  and policy_id = $2::uuid
			  and status not in ('resolved', 'redistributed', 'cancelled')
		`, tenantContext.OrganizationID, currentID.String)
		return err
	}

	var conflictingPolicyID string
	err = tx.QueryRow(ctx, `
		select id::text
		from public.lead_attention_policies
		where organization_id = $1::uuid
		  and policy_type = $2
		  and pipeline_id = $3::uuid
		  and stage_id = $4::uuid
		  and status <> 'archived'
		  and coalesce(config->>'source', '') <> 'stage_operational_rules'
		order by updated_at desc, id
		limit 1
		for update
	`, tenantContext.OrganizationID, policyType, stage.PipelineID, stage.ID).Scan(&conflictingPolicyID)
	if err == nil {
		return ErrAttentionPolicyConflict
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return err
	}

	nextVersion := 1
	var policyKeyValue any
	if policyKey.Valid {
		policyKeyValue = policyKey.String
		nextVersion = version + 1
	}
	_, err = tx.Exec(ctx, `
		insert into public.lead_attention_policies (
			organization_id, policy_key, version,
			name, policy_type, status,
			pipeline_id, stage_id,
			threshold_minutes, warning_minutes,
			repeat_minutes, escalation_minutes, redistribution_minutes,
			business_hours_only, redistribute_before_contact_only,
			notify_assignee, notify_leaders, notify_admins,
			config, created_by
		) values (
			$1::uuid, coalesce($2::uuid, gen_random_uuid()), $3,
			$4, $5, $6,
			$7::uuid, $8::uuid,
			$9, $10,
			null, $11, null,
			$12, true,
			$13, $13, false,
			jsonb_build_object(
				'source', 'stage_operational_rules',
				'no_automatic_move', true,
				'disabled_override', $14::boolean,
				'effective_from', now()
			),
			$15::uuid
		)
	`, tenantContext.OrganizationID, policyKeyValue, nextVersion,
		name, policyType, status,
		stage.PipelineID, stage.ID,
		effectiveThreshold, warningMinutes,
		nullableRuleInt(effectiveEscalation),
		businessHoursOnly,
		notifyRecipients,
		suppressesInherited,
		tenantContext.UserID,
	)
	return err
}

func cancelOperationalPolicyInstances(
	ctx context.Context,
	tx pgx.Tx,
	organizationID string,
	policyID string,
	reason string,
) error {
	_, err := tx.Exec(ctx, `
		with cancelled as (
			update public.lead_attention_instances
			set status = 'cancelled',
			    resolved_at = now(),
			    resolved_reason = $3,
			    next_evaluation_at = now(),
			    updated_at = now()
			where organization_id = $1::uuid
			  and policy_id = $2::uuid
			  and status not in ('resolved', 'redistributed', 'cancelled')
			returning organization_id, id, lead_id
		)
		insert into public.lead_attention_events (
			organization_id,
			instance_id,
			lead_id,
			event_type,
			metadata
		)
		select
			organization_id,
			id,
			lead_id,
			'cancelled',
			jsonb_build_object('reason', $3, 'source', 'stage_operational_rules')
		from cancelled
	`, organizationID, policyID, reason)
	return err
}

func operationalOptionalIntMatches(current pgtype.Int4, desired *int) bool {
	if desired == nil {
		return !current.Valid
	}
	return current.Valid && int(current.Int32) == *desired
}

func nullableRuleInt(value *int) any {
	if value == nil {
		return nil
	}
	return *value
}

func operationalWarningMinutes(value *int) int {
	if value == nil {
		return 0
	}
	return *value
}

func pgIntPointer(value pgtype.Int4) *int {
	if !value.Valid {
		return nil
	}
	result := int(value.Int32)
	return &result
}
