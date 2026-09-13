package leads

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"path"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type LeadTask struct {
	ID           string     `json:"id"`
	LeadID       string     `json:"lead_id"`
	DayOffset    int        `json:"day_offset"`
	Type         *string    `json:"type"`
	Title        string     `json:"title"`
	Description  *string    `json:"description"`
	DueDate      *time.Time `json:"due_date"`
	IsDone       *bool      `json:"is_done"`
	DoneAt       *time.Time `json:"done_at"`
	DoneBy       *string    `json:"done_by"`
	Outcome      *string    `json:"outcome"`
	OutcomeNotes *string    `json:"outcome_notes"`
	CreatedAt    time.Time  `json:"created_at"`
}

type LeadAttachment struct {
	ID            string    `json:"id"`
	LeadID        string    `json:"lead_id"`
	FileName      string    `json:"file_name"`
	FileURL       string    `json:"file_url"`
	FileType      *string   `json:"file_type"`
	FileSize      *int64    `json:"file_size"`
	CreatedAt     time.Time `json:"created_at"`
	CreatedBy     *string   `json:"created_by"`
	MessageID     *string   `json:"message_id"`
	StorageBucket string    `json:"-"`
	StoragePath   string    `json:"-"`
}

type LeadAttachmentCreateRequest struct {
	LeadID    string  `json:"lead_id"`
	FileName  string  `json:"file_name"`
	FileURL   string  `json:"file_url"`
	FileType  *string `json:"file_type"`
	FileSize  *int64  `json:"file_size"`
	MessageID *string `json:"message_id"`
}

const leadAttachmentSignedURLTTLSeconds = 60 * 60

type leadAttachmentCreateInput struct {
	LeadID    string
	FileName  string
	FileURL   string
	FileType  *string
	FileSize  *int64
	MessageID *string
}

type leadAttachmentColumns struct {
	OrganizationID bool
	CreatedBy      bool
	UploadedBy     bool
	FileType       bool
	FileURL        bool
	PublicURL      bool
	FileSize       bool
	MessageID      bool
	StorageBucket  bool
	StoragePath    bool
	Metadata       bool
}

type LeadTaskCreateRequest struct {
	LeadID      string  `json:"lead_id"`
	DayOffset   int     `json:"day_offset"`
	Type        string  `json:"type"`
	Title       string  `json:"title"`
	Description *string `json:"description"`
	DueDate     *string `json:"due_date"`
}

type leadTaskCreateInput struct {
	LeadID      string
	DayOffset   int
	Type        string
	Title       string
	Description *string
	DueDate     *time.Time
}

type LeadTaskPatchRequest struct {
	IsDone       *bool   `json:"is_done"`
	Outcome      *string `json:"outcome"`
	OutcomeNotes *string `json:"outcome_notes"`
	LeadID       string  `json:"leadId"`
}

type CompleteCadenceTaskRequest struct {
	LeadID         string  `json:"leadId"`
	TaskID         string  `json:"taskId,omitempty"`
	TemplateTaskID string  `json:"templateTaskId,omitempty"`
	DayOffset      int     `json:"dayOffset"`
	Type           string  `json:"type"`
	Title          string  `json:"title"`
	Description    *string `json:"description"`
	Outcome        *string `json:"outcome"`
	OutcomeNotes   *string `json:"outcomeNotes"`
}

func (request LeadAttachmentCreateRequest) Validate() (leadAttachmentCreateInput, error) {
	leadID, ok := normalizeUUID(request.LeadID)
	if !ok {
		return leadAttachmentCreateInput{}, fmt.Errorf("%w: lead_id is invalid", ErrInvalidInput)
	}

	fileName := trimMax(request.FileName, 240)
	if fileName == "" {
		return leadAttachmentCreateInput{}, fmt.Errorf("%w: file_name is required", ErrInvalidInput)
	}

	fileURL := trimMax(request.FileURL, 2_000)
	if fileURL == "" {
		return leadAttachmentCreateInput{}, fmt.Errorf("%w: file_url is required", ErrInvalidInput)
	}

	var messageID *string
	if request.MessageID != nil && strings.TrimSpace(*request.MessageID) != "" {
		value, ok := normalizeUUID(*request.MessageID)
		if !ok {
			return leadAttachmentCreateInput{}, fmt.Errorf("%w: message_id is invalid", ErrInvalidInput)
		}
		messageID = &value
	}

	return leadAttachmentCreateInput{
		LeadID:    leadID,
		FileName:  fileName,
		FileURL:   fileURL,
		FileType:  optionalStringFromPointer(request.FileType, 120),
		FileSize:  request.FileSize,
		MessageID: messageID,
	}, nil
}

func (request LeadTaskCreateRequest) Validate() (leadTaskCreateInput, error) {
	leadID, ok := normalizeUUID(request.LeadID)
	if !ok {
		return leadTaskCreateInput{}, fmt.Errorf("%w: lead_id is invalid", ErrInvalidInput)
	}
	input := leadTaskCreateInput{
		LeadID:      leadID,
		DayOffset:   request.DayOffset,
		Type:        trimMax(request.Type, 40),
		Title:       trimMax(request.Title, 180),
		Description: optionalStringFromPointer(request.Description, 1_000),
	}
	if input.Title == "" {
		return leadTaskCreateInput{}, fmt.Errorf("%w: title is required", ErrInvalidInput)
	}
	if input.Type == "" {
		input.Type = "note"
	}
	if request.DueDate != nil && strings.TrimSpace(*request.DueDate) != "" {
		parsed, err := time.Parse(time.RFC3339, strings.TrimSpace(*request.DueDate))
		if err != nil {
			return leadTaskCreateInput{}, fmt.Errorf("%w: due_date is invalid", ErrInvalidInput)
		}
		input.DueDate = &parsed
	}
	return input, nil
}

func (request CompleteCadenceTaskRequest) Validate() (CompleteCadenceTaskRequest, error) {
	leadID, ok := normalizeUUID(request.LeadID)
	if !ok {
		return CompleteCadenceTaskRequest{}, fmt.Errorf("%w: leadId is invalid", ErrInvalidInput)
	}
	request.LeadID = leadID
	request.TaskID = strings.TrimSpace(request.TaskID)
	request.TemplateTaskID = strings.TrimSpace(request.TemplateTaskID)
	if request.TaskID != "" {
		taskID, valid := normalizeUUID(request.TaskID)
		if !valid {
			return CompleteCadenceTaskRequest{}, fmt.Errorf("%w: taskId is invalid", ErrInvalidInput)
		}
		request.TaskID = taskID
	}
	if request.TemplateTaskID != "" {
		templateTaskID, valid := normalizeUUID(request.TemplateTaskID)
		if !valid {
			return CompleteCadenceTaskRequest{}, fmt.Errorf("%w: templateTaskId is invalid", ErrInvalidInput)
		}
		request.TemplateTaskID = templateTaskID
	}
	if request.TaskID == "" && request.TemplateTaskID == "" {
		return CompleteCadenceTaskRequest{}, fmt.Errorf("%w: taskId or templateTaskId is required", ErrInvalidInput)
	}
	request.Type = trimMax(request.Type, 40)
	request.Title = trimMax(request.Title, 180)
	request.Description = optionalStringFromPointer(request.Description, 1_000)
	request.Outcome = optionalStringFromPointer(request.Outcome, 120)
	request.OutcomeNotes = optionalStringFromPointer(request.OutcomeNotes, 1_000)
	if request.Type != "" && !validEnum(request.Type, "call", "message", "email", "note") {
		return CompleteCadenceTaskRequest{}, fmt.Errorf("%w: type is invalid", ErrInvalidInput)
	}
	return request, nil
}

func (repo Repository) ListLeadAttachments(ctx context.Context, tenantContext tenant.Context, leadID string) ([]LeadAttachment, error) {
	leadID, ok := normalizeUUID(leadID)
	if !ok {
		return nil, ErrInvalidInput
	}

	columns, err := repo.getLeadAttachmentColumns(ctx)
	if err != nil {
		return nil, err
	}

	where := []string{
		"l.organization_id = $1::uuid",
		"la.lead_id = $5::uuid",
		leadVisibilitySQL("$2", "$3", "$4", tenantContext.HasPermission(permissions.LeadViewOwn)),
	}
	if columns.OrganizationID {
		where = append(where, "la.organization_id = $1::uuid")
	}

	rows, err := repo.db.Pool().Query(ctx, `
		select `+leadAttachmentSelectFields(columns)+`
		from public.lead_attachments la
		join public.leads l on l.id = la.lead_id
		where `+strings.Join(where, " and ")+`
		order by la.created_at desc, la.id desc
	`, tenantContext.OrganizationID, canViewAllLeads(tenantContext), tenantContext.UserID, tenantContext.HasPermission("lead_view_team"), leadID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	attachments := []LeadAttachment{}
	for rows.Next() {
		attachment, err := scanLeadAttachment(rows)
		if err != nil {
			return nil, err
		}
		repo.signLeadAttachmentURL(ctx, tenantContext.OrganizationID, &attachment)
		attachments = append(attachments, attachment)
	}
	return attachments, rows.Err()
}

func (repo Repository) CreateLeadAttachment(ctx context.Context, tenantContext tenant.Context, input leadAttachmentCreateInput) (LeadAttachment, error) {
	storagePath := storagePathFromPublicURL(input.FileURL, repo.storage.projectURL)
	if storagePath != "" && !leadAttachmentStoragePathBelongsToOrganization(storagePath, tenantContext.OrganizationID) {
		return LeadAttachment{}, fmt.Errorf("%w: attachment storage path does not belong to the organization", ErrInvalidInput)
	}

	if err := repo.ensureLeadEditable(ctx, tenantContext, input.LeadID); err != nil {
		return LeadAttachment{}, err
	}

	columns, err := repo.getLeadAttachmentColumns(ctx)
	if err != nil {
		return LeadAttachment{}, err
	}

	if input.MessageID != nil && columns.MessageID {
		existingArgs := []any{input.LeadID}
		existingWhere := []string{"la.lead_id = $1::uuid"}
		if columns.OrganizationID {
			existingArgs = append(existingArgs, tenantContext.OrganizationID)
			existingWhere = append(existingWhere, fmt.Sprintf("la.organization_id = $%d::uuid", len(existingArgs)))
		}
		existingArgs = append(existingArgs, *input.MessageID)
		existingWhere = append(existingWhere, fmt.Sprintf("la.message_id = $%d::uuid", len(existingArgs)))

		existing, err := scanLeadAttachment(repo.db.Pool().QueryRow(ctx, `
			select `+leadAttachmentSelectFields(columns)+`
			from public.lead_attachments la
			join public.leads l on l.id = la.lead_id
			where `+strings.Join(existingWhere, " and ")+`
			limit 1
		`, existingArgs...))
		if err == nil {
			repo.signLeadAttachmentURL(ctx, tenantContext.OrganizationID, &existing)
			return existing, nil
		}
		if err != pgx.ErrNoRows {
			return LeadAttachment{}, err
		}
	}

	insertColumns := []string{}
	values := []string{}
	args := []any{}
	add := func(column string, value any, cast string) {
		args = append(args, value)
		insertColumns = append(insertColumns, column)
		placeholder := fmt.Sprintf("$%d", len(args))
		if cast != "" {
			placeholder += cast
		}
		values = append(values, placeholder)
	}

	if columns.OrganizationID {
		add("organization_id", tenantContext.OrganizationID, "::uuid")
	}
	add("lead_id", input.LeadID, "::uuid")
	if columns.CreatedBy {
		add("created_by", tenantContext.UserID, "::uuid")
	}
	if columns.UploadedBy {
		add("uploaded_by", tenantContext.UserID, "::uuid")
	}
	add("file_name", input.FileName, "")
	if columns.FileType {
		add("file_type", input.FileType, "")
	}
	if columns.FileURL {
		add("file_url", input.FileURL, "")
	}
	if columns.PublicURL {
		add("public_url", input.FileURL, "")
	}
	if columns.FileSize {
		add("file_size", input.FileSize, "")
	}
	if columns.MessageID {
		add("message_id", input.MessageID, "::uuid")
	}
	if columns.StorageBucket {
		add("storage_bucket", "whatsapp-media", "")
	}
	if columns.StoragePath {
		add("storage_path", storagePath, "")
	}
	if columns.Metadata {
		metadata := map[string]any{
			"file_url": input.FileURL,
		}
		if input.FileSize != nil {
			metadata["file_size"] = *input.FileSize
		}
		if input.MessageID != nil {
			metadata["message_id"] = *input.MessageID
		}
		add("metadata", jsonb(metadata), "::jsonb")
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return LeadAttachment{}, err
	}
	defer tx.Rollback(ctx)

	attachment, err := scanLeadAttachment(tx.QueryRow(ctx, `
		with inserted as (
			insert into public.lead_attachments (`+strings.Join(insertColumns, ", ")+`)
			values (`+strings.Join(values, ", ")+`)
			returning *
		)
		select `+leadAttachmentSelectFields(columns)+`
		from inserted la
		join public.leads l on l.id = la.lead_id
	`, args...))
	if err != nil {
		return LeadAttachment{}, err
	}

	_, err = tx.Exec(ctx, `
		insert into public.activities (
			organization_id,
			lead_id,
			user_id,
			type,
			content,
			metadata
		)
		values ($1::uuid, $2::uuid, $3::uuid, 'note', $4, $5::jsonb)
	`, tenantContext.OrganizationID, input.LeadID, tenantContext.UserID, "Documento anexado: "+input.FileName, jsonb(map[string]any{
		"file_url":   input.FileURL,
		"file_type":  input.FileType,
		"file_size":  input.FileSize,
		"message_id": input.MessageID,
	}))
	if err != nil {
		return LeadAttachment{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return LeadAttachment{}, err
	}

	repo.signLeadAttachmentURL(ctx, tenantContext.OrganizationID, &attachment)
	return attachment, nil
}

func (repo Repository) ListLeadTasks(ctx context.Context, tenantContext tenant.Context, leadID string) ([]LeadTask, error) {
	leadID, ok := normalizeUUID(leadID)
	if !ok {
		return nil, ErrInvalidInput
	}
	if err := repo.ensureLeadVisible(ctx, tenantContext, leadID); err != nil {
		return nil, err
	}
	rows, err := repo.db.Pool().Query(ctx, `
		select id::text, lead_id::text, day_offset, type, title, description, due_date,
			is_done, done_at, done_by::text, outcome, outcome_notes, created_at
		from public.lead_tasks
		where lead_id = $1::uuid
		  and coalesce(status, case when coalesce(is_done, false) then 'completed' else 'pending' end) in ('pending', 'completed')
		  and not exists (
		    select 1 from public.cadence_enrollments ce
		    where ce.id = lead_tasks.cadence_enrollment_id and ce.status = 'cancelled'
		  )
		order by day_offset asc, created_at asc
	`, leadID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	tasks := []LeadTask{}
	for rows.Next() {
		task, err := scanLeadTask(rows)
		if err != nil {
			return nil, err
		}
		tasks = append(tasks, task)
	}
	return tasks, rows.Err()
}

func (repo Repository) CreateLeadTask(ctx context.Context, tenantContext tenant.Context, input leadTaskCreateInput) (LeadTask, error) {
	if err := repo.ensureLeadEditable(ctx, tenantContext, input.LeadID); err != nil {
		return LeadTask{}, err
	}
	return scanLeadTask(repo.db.Pool().QueryRow(ctx, `
		insert into public.lead_tasks (lead_id, day_offset, type, title, description, due_date)
		values ($1::uuid, $2, $3, $4, $5, $6)
		returning id::text, lead_id::text, day_offset, type, title, description, due_date,
			is_done, done_at, done_by::text, outcome, outcome_notes, created_at
	`, input.LeadID, input.DayOffset, input.Type, input.Title, input.Description, input.DueDate))
}

func (repo Repository) PatchLeadTask(ctx context.Context, tenantContext tenant.Context, taskID string, request LeadTaskPatchRequest) (LeadTask, error) {
	taskID, ok := normalizeUUID(taskID)
	if !ok {
		return LeadTask{}, ErrInvalidInput
	}
	current, err := repo.getTaskLeadID(ctx, tenantContext.OrganizationID, taskID)
	if err != nil {
		return LeadTask{}, err
	}
	if current.IsCadence {
		return LeadTask{}, fmt.Errorf(
			"%w: cadence tasks must be completed through the cadence endpoint",
			ErrInvalidInput,
		)
	}
	if err := repo.ensureLeadEditable(ctx, tenantContext, current.LeadID); err != nil {
		return LeadTask{}, err
	}

	var doneAt any
	var doneBy any
	if request.IsDone != nil && *request.IsDone {
		doneAt = time.Now().UTC()
		doneBy = tenantContext.UserID
	} else if request.IsDone != nil {
		doneAt = nil
		doneBy = nil
	}

	task, err := scanLeadTask(repo.db.Pool().QueryRow(ctx, `
		update public.lead_tasks
		set
			is_done = coalesce($2, is_done),
			done_at = case when $2::boolean is null then done_at else $3::timestamptz end,
			done_by = case when $2::boolean is null then done_by else $4::uuid end,
			outcome = coalesce($5, outcome),
			outcome_notes = coalesce($6, outcome_notes)
		where id = $1::uuid
		returning id::text, lead_id::text, day_offset, type, title, description, due_date,
			is_done, done_at, done_by::text, outcome, outcome_notes, created_at
	`, taskID, request.IsDone, doneAt, doneBy, optionalStringFromPointer(request.Outcome, 120), optionalStringFromPointer(request.OutcomeNotes, 1_000)))
	if err != nil {
		return LeadTask{}, err
	}
	if request.IsDone != nil && *request.IsDone {
		if err := repo.insertTaskCompletedActivity(ctx, tenantContext.OrganizationID, current.LeadID, task.ID, task.Type, task.DayOffset, task.Title, tenantContext.UserID, nil, request.Outcome, request.OutcomeNotes); err != nil {
			return LeadTask{}, err
		}
	}
	return task, nil
}

func (repo Repository) CompleteCadenceTask(ctx context.Context, tenantContext tenant.Context, request CompleteCadenceTaskRequest) (LeadTask, error) {
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return LeadTask{}, err
	}
	defer tx.Rollback(ctx)

	// Cadence lifecycle paths lock lead -> tasks -> enrollment. Keep completion
	// in the same order so a simultaneous stage move, reassignment or cadence
	// switch cannot deadlock or invalidate this task between authorization and
	// completion.
	if err := ensureLeadEditableForUpdate(ctx, tx, tenantContext, request.LeadID); err != nil {
		return LeadTask{}, err
	}

	var existingID, status string
	var outcomeRequired bool
	var templateTaskID pgtype.Text
	err = tx.QueryRow(ctx, `
		select
			lt.id::text,
			coalesce(lt.status, case when coalesce(lt.is_done, false) then 'completed' else 'pending' end),
			case
			  when lower(coalesce(lt.metadata->>'outcome_required', '')) in ('true', '1', 'yes') then true
			  when lower(coalesce(lt.metadata->>'outcome_required', '')) in ('false', '0', 'no') then false
			  else coalesce(ctt.outcome_required, false)
			end,
			lt.cadence_template_task_id::text
		from public.lead_tasks lt
		join public.cadence_enrollments ce
		  on ce.organization_id = lt.organization_id
		 and ce.id = lt.cadence_enrollment_id
		 and ce.status in ('active', 'completed')
		join public.lead_stage_cycles sc
		  on sc.organization_id = ce.organization_id
		 and sc.id = ce.stage_cycle_id
		 and sc.exited_at is null
		join public.leads l
		  on l.organization_id = lt.organization_id
		 and l.id = lt.lead_id
		 and l.deal_status = 'open'
		 and l.stage_id = sc.stage_id
		left join public.cadence_tasks_template ctt
		  on ctt.organization_id = lt.organization_id
		 and ctt.id = lt.cadence_template_task_id
		where lt.organization_id = $1::uuid
		  and lt.lead_id = $2::uuid
		  and coalesce(lt.status, case when coalesce(lt.is_done, false) then 'completed' else 'pending' end) in ('pending', 'completed')
		  and (
			(nullif($3, '') is not null and lt.id = nullif($3, '')::uuid)
			or (
			  nullif($3, '') is null
			  and lt.cadence_template_task_id = nullif($4, '')::uuid
			)
		  )
		order by
		  case coalesce(lt.status, case when coalesce(lt.is_done, false) then 'completed' else 'pending' end)
		    when 'pending' then 0 else 1
		  end,
		  lt.created_at desc,
		  lt.id desc
		limit 1
		for update of lt
	`, tenantContext.OrganizationID, request.LeadID, request.TaskID, request.TemplateTaskID).Scan(
		&existingID,
		&status,
		&outcomeRequired,
		&templateTaskID,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return LeadTask{}, ErrInvalidReference
	}
	if err != nil {
		return LeadTask{}, err
	}
	if outcomeRequired && (request.Outcome == nil || strings.TrimSpace(*request.Outcome) == "") {
		return LeadTask{}, fmt.Errorf("%w: outcome is required for this cadence task", ErrInvalidInput)
	}

	if status == "completed" {
		task, err := scanLeadTask(tx.QueryRow(ctx, `
			select id::text, lead_id::text, day_offset, type, title, description, due_date,
				is_done, done_at, done_by::text, outcome, outcome_notes, created_at
			from public.lead_tasks
			where organization_id = $1::uuid and id = $2::uuid
		`, tenantContext.OrganizationID, existingID))
		if err != nil {
			return LeadTask{}, err
		}
		if err := tx.Commit(ctx); err != nil {
			return LeadTask{}, err
		}
		return task, nil
	}

	task, err := scanLeadTask(tx.QueryRow(ctx, `
		update public.lead_tasks
		set is_done = true,
			status = 'completed',
			done_at = now(),
			completed_at = now(),
			done_by = $3::uuid,
			outcome = coalesce($4, outcome),
			outcome_notes = coalesce($5, outcome_notes)
		where organization_id = $1::uuid
		  and id = $2::uuid
		  and coalesce(
		    status,
		    case when coalesce(is_done, false) then 'completed' else 'pending' end
		  ) = 'pending'
		  and coalesce(is_done, false) = false
		returning id::text, lead_id::text, day_offset, type, title, description, due_date,
			is_done, done_at, done_by::text, outcome, outcome_notes, created_at
	`, tenantContext.OrganizationID, existingID, tenantContext.UserID, request.Outcome, request.OutcomeNotes))
	if err != nil {
		return LeadTask{}, err
	}

	activityMetadata := map[string]any{
		"task_id":    task.ID,
		"task_type":  task.Type,
		"day_offset": task.DayOffset,
	}
	if templateTaskID.Valid {
		activityMetadata["template_task_id"] = templateTaskID.String
	}
	if request.Outcome != nil {
		activityMetadata["outcome"] = *request.Outcome
	}
	if request.OutcomeNotes != nil {
		activityMetadata["outcome_notes"] = *request.OutcomeNotes
	}
	if _, err := tx.Exec(ctx, `
		insert into public.activities (
			organization_id, lead_id, type, content, user_id, metadata
		) values (
			$1::uuid, $2::uuid, 'task_completed', $3, $4::uuid, $5::jsonb
		)
	`, tenantContext.OrganizationID, request.LeadID, "Cadencia concluida: "+task.Title, tenantContext.UserID, jsonb(activityMetadata)); err != nil {
		return LeadTask{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return LeadTask{}, err
	}
	repo.recordTaskGamification(tenantContext.OrganizationID, tenantContext.UserID, task.ID, task.Type, request.Outcome)
	return task, nil
}

func leadAttachmentSelectFields(columns leadAttachmentColumns) string {
	fileTypeExpression := "null::text"
	if columns.FileType {
		fileTypeExpression = "la.file_type"
	}

	fileURLExpression := "null::text"
	if columns.FileURL {
		fileURLExpression = "la.file_url"
	} else if columns.PublicURL {
		fileURLExpression = "la.public_url"
	}

	fileSizeExpression := "null::bigint"
	if columns.FileSize {
		fileSizeExpression = "la.file_size::bigint"
	} else if columns.Metadata {
		fileSizeExpression = "case when (la.metadata->>'file_size') ~ '^[0-9]+$' then (la.metadata->>'file_size')::bigint else null::bigint end"
	}

	createdByExpression := "null::text"
	if columns.CreatedBy {
		createdByExpression = "la.created_by::text"
	} else if columns.UploadedBy {
		createdByExpression = "la.uploaded_by::text"
	}

	messageIDExpression := "null::text"
	if columns.MessageID {
		messageIDExpression = "la.message_id::text"
	} else if columns.Metadata {
		messageIDExpression = "la.metadata->>'message_id'"
	}

	storageBucketExpression := "null::text"
	if columns.StorageBucket {
		storageBucketExpression = "la.storage_bucket"
	}

	storagePathExpression := "null::text"
	if columns.StoragePath {
		storagePathExpression = "la.storage_path"
	}

	return `
		la.id::text,
		la.lead_id::text,
		la.file_name,
		coalesce(` + fileURLExpression + `, ''),
		` + fileTypeExpression + `,
		` + fileSizeExpression + `,
		` + createdByExpression + `,
		` + messageIDExpression + `,
		` + storageBucketExpression + `,
		` + storagePathExpression + `,
		la.created_at`
}

func scanLeadAttachment(row scanner) (LeadAttachment, error) {
	var attachment LeadAttachment
	var fileType, createdBy, messageID, storageBucket, storagePath pgtype.Text
	var fileSize pgtype.Int8

	if err := row.Scan(
		&attachment.ID,
		&attachment.LeadID,
		&attachment.FileName,
		&attachment.FileURL,
		&fileType,
		&fileSize,
		&createdBy,
		&messageID,
		&storageBucket,
		&storagePath,
		&attachment.CreatedAt,
	); err != nil {
		if err == pgx.ErrNoRows {
			return LeadAttachment{}, ErrInvalidReference
		}
		return LeadAttachment{}, err
	}

	attachment.FileType = textPtr(fileType)
	attachment.CreatedBy = textPtr(createdBy)
	attachment.MessageID = textPtr(messageID)
	attachment.StorageBucket = textValue(storageBucket)
	attachment.StoragePath = textValue(storagePath)
	if fileSize.Valid {
		attachment.FileSize = &fileSize.Int64
	}

	return attachment, nil
}

func scanLeadTask(row scanner) (LeadTask, error) {
	var task LeadTask
	var taskType, description, doneBy, outcome, outcomeNotes pgtype.Text
	var dueDate, doneAt pgtype.Timestamptz
	var isDone pgtype.Bool
	if err := row.Scan(
		&task.ID,
		&task.LeadID,
		&task.DayOffset,
		&taskType,
		&task.Title,
		&description,
		&dueDate,
		&isDone,
		&doneAt,
		&doneBy,
		&outcome,
		&outcomeNotes,
		&task.CreatedAt,
	); err != nil {
		if err == pgx.ErrNoRows {
			return LeadTask{}, ErrInvalidReference
		}
		return LeadTask{}, err
	}
	task.Type = textPtr(taskType)
	task.Description = textPtr(description)
	task.DueDate = timePtr(dueDate)
	task.IsDone = boolPtr(isDone)
	task.DoneAt = timePtr(doneAt)
	task.DoneBy = textPtr(doneBy)
	task.Outcome = textPtr(outcome)
	task.OutcomeNotes = textPtr(outcomeNotes)
	return task, nil
}

type taskLead struct {
	LeadID    string
	IsCadence bool
}

func (repo Repository) getTaskLeadID(
	ctx context.Context,
	organizationID string,
	taskID string,
) (taskLead, error) {
	var current taskLead
	err := repo.db.Pool().QueryRow(ctx, `
		select
			task.lead_id::text,
			task.cadence_enrollment_id is not null
		from public.lead_tasks task
		join public.leads lead
		  on lead.id = task.lead_id
		 and lead.organization_id = $1::uuid
		where task.id = $2::uuid
	`, organizationID, taskID).Scan(&current.LeadID, &current.IsCadence)
	if err == pgx.ErrNoRows {
		return taskLead{}, ErrInvalidReference
	}
	return current, err
}

func (repo Repository) getLeadAttachmentColumns(ctx context.Context) (leadAttachmentColumns, error) {
	rows, err := repo.db.Pool().Query(ctx, `
		select column_name
		from information_schema.columns
		where table_schema = 'public'
		  and table_name = 'lead_attachments'
	`)
	if err != nil {
		return leadAttachmentColumns{}, err
	}
	defer rows.Close()

	columns := leadAttachmentColumns{}
	for rows.Next() {
		var column string
		if err := rows.Scan(&column); err != nil {
			return leadAttachmentColumns{}, err
		}
		switch column {
		case "organization_id":
			columns.OrganizationID = true
		case "created_by":
			columns.CreatedBy = true
		case "uploaded_by":
			columns.UploadedBy = true
		case "file_type":
			columns.FileType = true
		case "file_url":
			columns.FileURL = true
		case "public_url":
			columns.PublicURL = true
		case "file_size":
			columns.FileSize = true
		case "message_id":
			columns.MessageID = true
		case "storage_bucket":
			columns.StorageBucket = true
		case "storage_path":
			columns.StoragePath = true
		case "metadata":
			columns.Metadata = true
		}
	}
	if err := rows.Err(); err != nil {
		return leadAttachmentColumns{}, err
	}

	return columns, nil
}

func (repo Repository) insertTaskCompletedActivity(
	ctx context.Context,
	organizationID string,
	leadID string,
	taskID string,
	taskType *string,
	dayOffset int,
	title string,
	userID string,
	templateTaskID *string,
	outcome *string,
	outcomeNotes *string,
) error {
	metadata := map[string]any{
		"task_id":    taskID,
		"task_type":  taskType,
		"day_offset": dayOffset,
	}
	if templateTaskID != nil {
		metadata["template_task_id"] = *templateTaskID
	}
	if outcome != nil {
		metadata["outcome"] = *outcome
	}
	if outcomeNotes != nil {
		metadata["outcome_notes"] = *outcomeNotes
	}
	_, err := repo.db.Pool().Exec(ctx, `
		insert into public.activities (organization_id, lead_id, type, content, user_id, metadata)
		values ($1::uuid, $2::uuid, 'task_completed', $3, $4::uuid, $5::jsonb)
	`, organizationID, leadID, "Cadencia concluida: "+title, userID, jsonb(metadata))

	if err != nil {
		return err
	}
	repo.recordTaskGamification(organizationID, userID, taskID, taskType, outcome)
	return nil
}

func (repo Repository) recordTaskGamification(organizationID string, userID string, taskID string, taskType *string, outcome *string) {
	if repo.gamificationRecorder == nil || taskType == nil || *taskType != "call" {
		return
	}

	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()

		tenantCtx := tenant.Context{OrganizationID: organizationID, UserID: userID}
		_ = repo.gamificationRecorder.RecordAction(ctx, tenantCtx, "call_made", 1, taskID)
		if outcome != nil && (strings.EqualFold(*outcome, "efetivo") || strings.EqualFold(*outcome, "contato efetivo")) {
			_ = repo.gamificationRecorder.RecordAction(ctx, tenantCtx, "contact_made", 1, taskID)
		}
	}()
}

func storagePathFromPublicURL(fileURL string, projectURL string) string {
	return storagePathFromPublicStorageURL(fileURL, projectURL)
}

func storagePathFromPublicStorageURL(fileURL string, projectURL string) string {
	rawURL := strings.TrimSpace(fileURL)
	rawProjectURL := strings.TrimSpace(projectURL)
	if rawURL == "" || rawProjectURL == "" {
		return ""
	}

	parsed, err := url.Parse(rawURL)
	if err != nil {
		return ""
	}
	project, err := url.Parse(rawProjectURL)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" || project.Scheme == "" || project.Host == "" {
		return ""
	}
	if !strings.EqualFold(parsed.Scheme, project.Scheme) || !strings.EqualFold(parsed.Host, project.Host) {
		return ""
	}

	for _, prefix := range []string{"/storage/v1/object/public/", "/storage/v1/object/sign/"} {
		path := parsed.Path
		index := strings.Index(path, prefix)
		if index < 0 {
			continue
		}

		remainder := strings.Trim(path[index+len(prefix):], "/")
		bucket, objectPath, ok := strings.Cut(remainder, "/")
		if !ok || bucket != leadAttachmentBucket {
			continue
		}

		objectPath, err = url.PathUnescape(strings.Trim(objectPath, "/"))
		if err != nil {
			return ""
		}
		return objectPath
	}

	return ""
}

func leadAttachmentStoragePathBelongsToOrganization(objectPath string, organizationID string) bool {
	objectPath = strings.TrimSpace(objectPath)
	organizationID = strings.TrimSpace(organizationID)
	if objectPath == "" || organizationID == "" || strings.Contains(objectPath, `\`) || strings.Contains(objectPath, "%") {
		return false
	}

	cleaned := strings.TrimPrefix(path.Clean("/"+objectPath), "/")
	if cleaned != objectPath {
		return false
	}

	return strings.HasPrefix(cleaned, "orgs/"+organizationID+"/") ||
		strings.HasPrefix(cleaned, organizationID+"/")
}

func (repo Repository) signLeadAttachmentURL(ctx context.Context, organizationID string, attachment *LeadAttachment) {
	if attachment == nil || strings.TrimSpace(organizationID) == "" {
		return
	}

	fileURLPath := storagePathFromPublicStorageURL(attachment.FileURL, repo.storage.projectURL)
	path := fileURLPath
	if path == "" {
		storedPath := strings.TrimSpace(attachment.StoragePath)
		if storedPath != "" && !strings.HasPrefix(storedPath, "lead-attachments/") {
			path = storedPath
		}
	}
	if path == "" {
		return
	}
	if !leadAttachmentStoragePathBelongsToOrganization(path, organizationID) {
		return
	}

	bucket := strings.TrimSpace(attachment.StorageBucket)
	if bucket == "" {
		bucket = leadAttachmentBucket
	}
	if bucket != leadAttachmentBucket {
		return
	}

	signedURL, err := repo.storage.signedURL(ctx, bucket, path, leadAttachmentSignedURLTTLSeconds)
	if err == nil && signedURL != "" {
		attachment.FileURL = signedURL
	}
}
