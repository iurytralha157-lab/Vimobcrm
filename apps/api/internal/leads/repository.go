package leads

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/authorization"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/distribution"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/leadscope"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/propertyscope"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/realtime"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

type GamificationRecorder interface {
	RecordAction(ctx context.Context, tenantContext tenant.Context, actionType string, quantity int, referenceID string) error
}

type Repository struct {
	redistributionCursors *redistributionBatchCursors
	queueRuntimePublisher realtime.Publisher
	db                    *dbpkg.Postgres
	storage               storageClient
	evolutionGoAPIURL     string
	evolutionGoAPIKey     string
	notificationEmail     notificationEmailClient
	notificationPush      *notificationPushClient
	notificationStats     *notificationDispatchCounters
	gamificationRecorder  GamificationRecorder
	whatsAppAvatarURLs    *boundedWhatsAppAvatarSignedURLCache
	whatsAppAvatarSlots   chan struct{}
}

type scanner interface {
	Scan(dest ...any) error
}

type leadTeamQueryer interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

type notificationQueryer interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

type notificationRowsQueryer interface {
	notificationQueryer
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

type destination struct {
	PipelineID *string
	StageID    *string
	StageName  *string
}

type moveStageDestination struct {
	destination
	IsWon  bool
	IsLost bool
}

type CreateResult struct {
	Lead                Lead
	ReceiptOnly         bool
	Replayed            bool
	Reentry             bool
	AssignedUserName    string
	DistributionOutcome CreateDistributionOutcome
}

type roundRobinSelection struct {
	RoundRobinID string
	MemberID     string
	UserID       string
}

type existingLeadMatch struct {
	ID                  string
	TeamID              string
	Phone               string
	AssignedUserID      string
	AssignedUserName    string
	QueuePoolReadAccess *bool
}

const leadIntakeMaxAttempts = 3

var errLeadIntakeRetry = errors.New("lead intake identity changed while processing")

type leadSnapshot struct {
	ID                 string
	TeamID             string
	Name               string
	Phone              string
	AssignedUserID     string
	PipelineID         string
	StageID            string
	StageName          string
	DealStatus         string
	LostReason         string
	InterestValue      string
	PropertyID         string
	InterestPropertyID string
	PropertyCode       string
	Data               map[string]any
}

func NewRepository(db *dbpkg.Postgres, gamificationRecorder GamificationRecorder, storageConfigs ...StorageConfig) Repository {
	repository := Repository{
		db:                   db,
		gamificationRecorder: gamificationRecorder,
		notificationStats:    &notificationDispatchCounters{},
		whatsAppAvatarURLs:   newBoundedWhatsAppAvatarSignedURLCache(whatsAppAvatarSignedURLCacheMaxEntries),
		whatsAppAvatarSlots:  make(chan struct{}, whatsAppAvatarSigningConcurrency),
	}
	if len(storageConfigs) > 0 {
		repository.storage = newStorageClient(storageConfigs[0])
		repository.evolutionGoAPIURL = strings.TrimRight(strings.TrimSpace(storageConfigs[0].EvolutionGo.APIURL), "/")
		repository.evolutionGoAPIKey = strings.TrimSpace(storageConfigs[0].EvolutionGo.APIKey)
		repository.notificationEmail = newNotificationEmailClient(storageConfigs[0].Email)
		repository.notificationPush = newNotificationPushClient(storageConfigs[0].Push)
	}
	return repository
}

func (repo Repository) dispatchDealStatusSideEffects(tenantContext tenant.Context, current leadSnapshot, input updateInput) {
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()

		repo.recordDealStatusGamification(ctx, tenantContext, current, input)
	}()
}

func (repo Repository) RedistributeRoundRobin(ctx context.Context, tenantContext tenant.Context, leadID string, expectedUnassigned bool) (RoundRobinResult, error) {
	leadID, ok := normalizeUUID(leadID)
	if !ok {
		return RoundRobinResult{}, ErrLeadNotFound
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return RoundRobinResult{}, err
	}
	defer tx.Rollback(ctx)

	current, err := repo.getLeadSnapshotForUpdate(ctx, tx, tenantContext.OrganizationID, leadID)
	if err != nil {
		return RoundRobinResult{}, err
	}
	if isQueuePoolSnapshot(current) {
		return RoundRobinResult{}, ErrQueuePoolConflict
	}

	if !canOperateLeadSnapshot(tenantContext, current) {
		return RoundRobinResult{}, tenant.ErrOrganizationAccessDenied
	}
	if isManagedWhatsAppMessageDistributionLead(current.Data) {
		return RoundRobinResult{}, fmt.Errorf("%w: managed WhatsApp message distribution does not support generic round-robin redistribution", ErrInvalidInput)
	}
	result := RoundRobinResult{
		Success:    true,
		LeadID:     current.ID,
		PipelineID: current.PipelineID,
		StageID:    current.StageID,
	}
	if expectedUnassigned && current.AssignedUserID != "" {
		result.Success = false
		result.AssignedUserID = current.AssignedUserID
		result.Error = "already_assigned"
		return result, nil
	}
	managedResult, managed, err := managedQueueManualRedistribution(ctx, tx, tenantContext, current)
	if err != nil {
		return RoundRobinResult{}, err
	}
	if managed {
		return managedResult, tx.Commit(ctx)
	}
	if current.AssignedUserID == "" {
		queueID, err := repo.pendingLeadDistributionQueue(ctx, tx, tenantContext.OrganizationID, current)
		if err != nil {
			return RoundRobinResult{}, err
		}
		var nonce [16]byte
		if _, err := rand.Read(nonce[:]); err != nil {
			return RoundRobinResult{}, err
		}
		distributionResult, err := distribution.Distribute(ctx, tx, distribution.Request{
			OrganizationID:     tenantContext.OrganizationID,
			LeadID:             current.ID,
			IdempotencyKey:     distribution.StableKey("pipeline-unassigned-retry", current.ID, fmt.Sprintf("%x", nonce)),
			RoundRobinID:       queueID,
			RoundRobinResolved: true,
			PreserveAssignee:   false,
			OccurredAt:         time.Now().UTC(),
		})
		if err != nil {
			return RoundRobinResult{}, err
		}
		// The canonical queue can contain members from several teams. A leader
		// operating an unassigned team lead must not move it outside that team.
		// Rolling back also discards the canonical log and assignment together.
		if !retryPreservesLeadTeam(tenantContext, current, distributionResult) {
			return RoundRobinResult{}, tenant.ErrOrganizationAccessDenied
		}
		result.Success = distributionResult.Success
		result.RoundRobinUsed = distributionResult.RoundRobinID != nil
		if distributionResult.RoundRobinID != nil {
			result.RoundRobinID = *distributionResult.RoundRobinID
		}
		if distributionResult.AssignedUserID != nil {
			result.AssignedUserID = *distributionResult.AssignedUserID
		}
		if distributionResult.PipelineID != nil {
			result.PipelineID = *distributionResult.PipelineID
		}
		if distributionResult.StageID != nil {
			result.StageID = *distributionResult.StageID
		}
		if !distributionResult.Success {
			result.Error = distributionResult.Reason
		}
		return result, tx.Commit(ctx)
	}

	selection, reason, err := repo.selectRoundRobinMember(ctx, tx, tenantContext.OrganizationID, current)
	if err != nil {
		return RoundRobinResult{}, err
	}
	if reason != "" {
		result.Success = false
		result.Error = reason
		return result, tx.Commit(ctx)
	}

	assignedUserID := selection.UserID
	if err := repo.validateRoundRobinAssigneeTeam(ctx, tx, tenantContext.OrganizationID, current.TeamID, &assignedUserID); err != nil {
		return RoundRobinResult{}, err
	}
	if err := repo.transferLeadAssignee(ctx, tx, tenantContext, current, &assignedUserID, "round_robin"); err != nil {
		return RoundRobinResult{}, err
	}

	if _, err := tx.Exec(ctx, `
		insert into public.round_robin_logs (
			organization_id,
			round_robin_id,
			lead_id,
			assigned_user_id,
			reason,
			metadata
		)
		values (
			$1::uuid,
			$2::uuid,
			$3::uuid,
			$4::uuid,
			'round_robin',
			$5::jsonb
		)
	`, tenantContext.OrganizationID, selection.RoundRobinID, current.ID, selection.UserID, jsonb(map[string]any{
		"member_id":        selection.MemberID,
		"source":           "vimob_api",
		"previous_user_id": current.AssignedUserID,
	})); err != nil {
		return RoundRobinResult{}, err
	}

	if _, err := tx.Exec(ctx, `
		update public.round_robins
		set current_position = coalesce((
		      select rrm.position
		      from public.round_robin_members rrm
		      where rrm.id = $2::uuid
		      limit 1
		    ), current_position),
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $3::uuid
	`, tenantContext.OrganizationID, selection.MemberID, selection.RoundRobinID); err != nil {
		return RoundRobinResult{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return RoundRobinResult{}, err
	}

	result.AssignedUserID = selection.UserID
	result.RoundRobinID = selection.RoundRobinID
	result.RoundRobinUsed = true
	return result, nil
}

func retryPreservesLeadTeam(tenantContext tenant.Context, current leadSnapshot, result distribution.Result) bool {
	if !result.Success || leadscope.CanViewAll(tenantContext) {
		return true
	}
	return result.TeamID != nil && current.TeamID != "" && strings.EqualFold(*result.TeamID, current.TeamID)
}

// pendingLeadDistributionQueue keeps a card retry on the queue that most
// recently failed. The immutable intake queue is a fallback for older leads;
// an unknown queue is deliberately left unresolved so the canonical distributor
// records no_matching_queue instead of picking an unrelated active queue.
func (repo Repository) pendingLeadDistributionQueue(ctx context.Context, queryer leadTeamQueryer, organizationID string, current leadSnapshot) (*string, error) {
	var eventType, reason, queueID string
	err := queryer.QueryRow(ctx, `
		select event_type,
		       coalesce(metadata->>'reason', ''),
		       coalesce(nullif(metadata->>'queue_id', ''), nullif(metadata->>'distribution_queue_id', ''), '')
		from public.lead_timeline_events
		where organization_id = $1::uuid
		  and lead_id = $2::uuid
		  and event_type in ('lead_distribution_pending', 'lead_assigned')
		order by created_at desc, id desc
		limit 1
	`, organizationID, current.ID).Scan(&eventType, &reason, &queueID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, err
	}
	if err == nil && eventType == "lead_distribution_pending" {
		if reason != "no_available_members" {
			return nil, nil
		}
		if normalized, ok := normalizeUUID(queueID); ok {
			return &normalized, nil
		}
		return nil, nil
	}
	if errors.Is(err, pgx.ErrNoRows) {
		// Older distribution paths recorded only a round-robin log.
		err = queryer.QueryRow(ctx, `
			select coalesce(reason, ''), coalesce(round_robin_id::text, '')
			from public.round_robin_logs
			where organization_id = $1::uuid
			  and lead_id = $2::uuid
			order by created_at desc, id desc
			limit 1
		`, organizationID, current.ID).Scan(&reason, &queueID)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return nil, err
		}
		if err == nil {
			if reason == "no_matching_queue" {
				return nil, nil
			}
			if reason == "no_available_members" {
				if normalized, ok := normalizeUUID(queueID); ok {
					return &normalized, nil
				}
				return nil, nil
			}
		}
	}
	if normalized, ok := normalizeUUID(stringFromMap(current.Data, "origin_round_robin_id")); ok {
		return &normalized, nil
	}
	return nil, nil
}

func isManagedWhatsAppMessageDistributionLead(data map[string]any) bool {
	metadata := mapFromAny(data["metadata"])
	return truthyValue(metadata["managed_whatsapp_message_distribution"])
}

func (repo Repository) Delete(ctx context.Context, tenantContext tenant.Context, leadID string) error {
	leadID, ok := normalizeUUID(leadID)
	if !ok {
		return ErrLeadNotFound
	}
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	initialResource, err := repo.getLeadDeleteAuthorizationResource(ctx, tx, tenantContext.OrganizationID, leadID)
	if err != nil {
		return err
	}
	if !authorization.CanDeleteLead(tenantContext, initialResource) {
		return tenant.ErrOrganizationAccessDenied
	}

	// WhatsApp binding, automation and outbox paths lock a conversation before
	// touching rows that reference the lead. Keep deletion in the same order so
	// a lead lock can never wait on a conversation whose owner is waiting on the
	// lead's foreign-key row lock.
	lockedConversations, err := lockLeadWhatsAppConversations(ctx, tx, tenantContext.OrganizationID, leadID)
	if err != nil {
		return err
	}
	// Recovery owns outbox rows before inserting notification FK references to
	// the lead. Acquire/cancel those rows before the exclusive lead lock, so
	// recovery can finish its KEY SHARE without a lead -> outbox cycle.
	if err := prepareLeadWhatsAppDeletion(ctx, tx, tenantContext.OrganizationID, leadID, lockedConversations); err != nil {
		return err
	}

	current, err := repo.getLeadSnapshotForDelete(ctx, tx, tenantContext.OrganizationID, leadID)
	if err != nil {
		return err
	}
	if isQueuePoolSnapshot(current) {
		return ErrQueuePoolConflict
	}
	if !authorization.CanDeleteLead(tenantContext, authorization.LeadResource{AssignedUserID: current.AssignedUserID, TeamID: current.TeamID}) {
		return tenant.ErrOrganizationAccessDenied
	}

	// FOR UPDATE now prevents new FK references. If a new route committed in the
	// visibility window, roll back and ask the caller to refresh; never wait for
	// its conversation/work locks while owning the exclusive lead lock.
	if _, err := lockLeadWhatsAppConversations(ctx, tx, tenantContext.OrganizationID, leadID, lockedConversations); err != nil {
		return err
	}

	if _, err := tx.Exec(ctx, `
		delete from public.notifications
		where organization_id = $1::uuid
		  and lead_id = $2::uuid
	`, tenantContext.OrganizationID, leadID); err != nil {
		return err
	}

	if _, err := tx.Exec(ctx, `
		update public.whatsapp_conversations
		set lead_id = null,
		    updated_at = now()
		where organization_id = $1::uuid
		  and lead_id = $2::uuid
	`, tenantContext.OrganizationID, leadID); err != nil {
		return err
	}

	tag, err := tx.Exec(ctx, `
		delete from public.leads
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, tenantContext.OrganizationID, leadID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrLeadNotFound
	}

	if _, err := tx.Exec(ctx, `
		insert into public.audit_logs (
			organization_id,
			user_id,
			action,
			entity_type,
			entity_id,
			old_data
		)
		values (
			$1::uuid,
			$2::uuid,
			'delete',
			'lead',
			$3::uuid,
			$4::jsonb
		)
	`, tenantContext.OrganizationID, tenantContext.UserID, leadID, jsonb(map[string]any{
		"name":             current.Name,
		"phone":            nullableString(current.Phone),
		"assigned_user_id": nullableString(current.AssignedUserID),
		"deal_status":      current.DealStatus,
	})); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

func (repo Repository) getLeadDeleteAuthorizationResource(ctx context.Context, tx pgx.Tx, organizationID string, leadID string) (authorization.LeadResource, error) {
	var assignedUserID, teamID pgtype.Text
	err := tx.QueryRow(ctx, `
		select
		  l.assigned_user_id::text,
		  nullif(to_jsonb(l)->>'team_id', '')
		from public.leads l
		where l.organization_id = $1::uuid
		  and l.id = $2::uuid
		  and private.queue_pool_read_access(l.organization_id,l.id,null) is null
		limit 1
	`, organizationID, leadID).Scan(&assignedUserID, &teamID)
	if errors.Is(err, pgx.ErrNoRows) {
		return authorization.LeadResource{}, ErrLeadNotFound
	}
	if err != nil {
		return authorization.LeadResource{}, err
	}
	return authorization.LeadResource{
		AssignedUserID: textValue(assignedUserID),
		TeamID:         textValue(teamID),
	}, nil
}

func lockLeadWhatsAppConversations(ctx context.Context, tx pgx.Tx, organizationID string, leadID string, previouslyLocked ...[]string) ([]string, error) {
	lockClause := "for no key update of wc"
	allowed := map[string]bool{}
	if len(previouslyLocked) > 0 {
		lockClause = ""
		for _, id := range previouslyLocked[0] {
			allowed[id] = true
		}
	}
	rows, err := tx.Query(ctx, `
		select wc.id::text
		from public.whatsapp_conversations wc
		where wc.organization_id = $1::uuid
		  and (wc.lead_id = $2::uuid or exists (
		    select 1 from public.whatsapp_messages message join public.whatsapp_outbox queued
		    on queued.message_id=message.id and queued.organization_id=message.organization_id and queued.conversation_id=message.conversation_id
		    where message.organization_id=wc.organization_id and message.conversation_id=wc.id and message.lead_id=$2::uuid
		      and (queued.status in ('pending','retry','processing') or queued.last_error in ('provider_delivery_started','provider_accepted_finalization_pending','provider_delivery_outcome_unknown'))
		  ))
		order by wc.id
		`+lockClause, organizationID, leadID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	ids := []string{}
	for rows.Next() {
		var conversationID string
		if err := rows.Scan(&conversationID); err != nil {
			return nil, err
		}
		if len(previouslyLocked) > 0 && !allowed[conversationID] {
			return nil, ErrConversationBindingChanged
		}
		ids = append(ids, conversationID)
	}
	return ids, rows.Err()
}

func (repo Repository) AddTag(ctx context.Context, tenantContext tenant.Context, leadID string, input tagInput) error {
	leadID, ok := normalizeUUID(leadID)
	if !ok {
		return ErrLeadNotFound
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	current, err := repo.getLeadSnapshotForUpdate(ctx, tx, tenantContext.OrganizationID, leadID)
	if err != nil {
		return err
	}

	canEdit, err := repo.canEditLead(ctx, tx, tenantContext, current.AssignedUserID, current.TeamID)
	if err != nil {
		return err
	}
	if !canEdit || isQueuePoolSnapshot(current) {
		return tenant.ErrOrganizationAccessDenied
	}

	tagName, err := repo.getTagName(ctx, tx, tenantContext.OrganizationID, input.TagID)
	if err != nil {
		return err
	}

	var alreadyExists bool
	if err := tx.QueryRow(ctx, `
		select exists (
			select 1
			from public.lead_tags
			where organization_id = $1::uuid
			  and lead_id = $2::uuid
			  and tag_id = $3::uuid
		)
	`, tenantContext.OrganizationID, leadID, input.TagID).Scan(&alreadyExists); err != nil {
		return err
	}
	if alreadyExists {
		return ErrTagAlreadyExists
	}

	if _, err := tx.Exec(ctx, `
		insert into public.lead_tags (
			organization_id,
			lead_id,
			tag_id
		)
		values (
			$1::uuid,
			$2::uuid,
			$3::uuid
		)
	`, tenantContext.OrganizationID, leadID, input.TagID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		update public.leads
		set board_order_at = now(),
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, tenantContext.OrganizationID, leadID); err != nil {
		return err
	}

	if err := repo.insertActivity(ctx, tx, tenantContext.OrganizationID, leadID, tenantContext.UserID, "tag_added", fmt.Sprintf(`Tag "%s" adicionada`, tagName), map[string]any{
		"tag_id":   input.TagID,
		"tag_name": tagName,
	}); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

func (repo Repository) RemoveTag(ctx context.Context, tenantContext tenant.Context, leadID string, input tagInput) error {
	leadID, ok := normalizeUUID(leadID)
	if !ok {
		return ErrLeadNotFound
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	current, err := repo.getLeadSnapshotForUpdate(ctx, tx, tenantContext.OrganizationID, leadID)
	if err != nil {
		return err
	}

	canEdit, err := repo.canEditLead(ctx, tx, tenantContext, current.AssignedUserID, current.TeamID)
	if err != nil {
		return err
	}
	if !canEdit || isQueuePoolSnapshot(current) {
		return tenant.ErrOrganizationAccessDenied
	}

	tagName, err := repo.getTagName(ctx, tx, tenantContext.OrganizationID, input.TagID)
	if err != nil {
		return err
	}

	tag, err := tx.Exec(ctx, `
		delete from public.lead_tags
		where organization_id = $1::uuid
		  and lead_id = $2::uuid
		  and tag_id = $3::uuid
	`, tenantContext.OrganizationID, leadID, input.TagID)
	if err != nil {
		return err
	}

	if tag.RowsAffected() > 0 {
		if _, err := tx.Exec(ctx, `
			update public.leads
			set board_order_at = now(),
			    updated_at = now()
			where organization_id = $1::uuid
			  and id = $2::uuid
		`, tenantContext.OrganizationID, leadID); err != nil {
			return err
		}
		if err := repo.insertActivity(ctx, tx, tenantContext.OrganizationID, leadID, tenantContext.UserID, "tag_removed", fmt.Sprintf(`Tag "%s" removida`, tagName), map[string]any{
			"tag_id":   input.TagID,
			"tag_name": tagName,
		}); err != nil {
			return err
		}
	}

	return tx.Commit(ctx)
}

func (repo Repository) resolveDestination(ctx context.Context, queryer leadTeamQueryer, organizationID string, pipelineID *string, stageID *string) (destination, error) {
	if stageID != nil {
		var resolvedStageID string
		var resolvedPipelineID string
		var resolvedStageName string

		err := queryer.QueryRow(ctx, `
			select s.id::text, s.pipeline_id::text, s.name
			from public.stages s
			join public.pipelines p on p.id = s.pipeline_id
			where s.id = $1::uuid
			  and s.organization_id = $2::uuid
			  and p.organization_id = $2::uuid
			  and s.is_active = true
			  and p.is_active = true
			limit 1
			for share of s, p
		`, *stageID, organizationID).Scan(&resolvedStageID, &resolvedPipelineID, &resolvedStageName)
		if errors.Is(err, pgx.ErrNoRows) {
			return destination{}, ErrInvalidReference
		}
		if err != nil {
			return destination{}, err
		}

		if pipelineID != nil && *pipelineID != resolvedPipelineID {
			return destination{}, ErrInvalidReference
		}

		return destination{PipelineID: &resolvedPipelineID, StageID: &resolvedStageID, StageName: &resolvedStageName}, nil
	}

	if pipelineID != nil {
		var resolvedPipelineID string
		var resolvedStageID pgtype.Text
		var resolvedStageName pgtype.Text

		err := queryer.QueryRow(ctx, `
			select p.id::text, (
				select s.id::text
				from public.stages s
				where s.pipeline_id = p.id
				  and s.organization_id = p.organization_id
				  and s.is_active = true
				order by s.position asc, s.created_at asc
				limit 1
			), (
				select s.name
				from public.stages s
				where s.pipeline_id = p.id
				  and s.organization_id = p.organization_id
				  and s.is_active = true
				order by s.position asc, s.created_at asc
				limit 1
			)
			from public.pipelines p
			where p.id = $1::uuid
			  and p.organization_id = $2::uuid
			  and p.is_active = true
			limit 1
			for share of p
		`, *pipelineID, organizationID).Scan(&resolvedPipelineID, &resolvedStageID, &resolvedStageName)
		if errors.Is(err, pgx.ErrNoRows) {
			return destination{}, ErrInvalidReference
		}
		if err != nil {
			return destination{}, err
		}

		if resolvedStageID.Valid {
			return destination{PipelineID: &resolvedPipelineID, StageID: &resolvedStageID.String, StageName: textPointer(resolvedStageName)}, nil
		}

		return destination{}, distribution.ErrIntakeDestinationUnavailable
	}

	var resolvedPipelineID pgtype.Text
	var resolvedStageID pgtype.Text
	var resolvedStageName pgtype.Text

	err := queryer.QueryRow(ctx, `
		select p.id::text, (
			select s.id::text
			from public.stages s
			where s.pipeline_id = p.id
			  and s.organization_id = p.organization_id
			  and s.is_active = true
			order by s.position asc, s.created_at asc
			limit 1
		), (
			select s.name
			from public.stages s
			where s.pipeline_id = p.id
			  and s.organization_id = p.organization_id
			  and s.is_active = true
			order by s.position asc, s.created_at asc
			limit 1
		)
		from public.pipelines p
		where p.organization_id = $1::uuid
		  and p.is_active = true
		order by p.is_default desc, p.position asc, p.created_at asc
		limit 1
		for share of p
	`, organizationID).Scan(&resolvedPipelineID, &resolvedStageID, &resolvedStageName)
	if errors.Is(err, pgx.ErrNoRows) {
		return destination{}, nil
	}
	if err != nil {
		return destination{}, err
	}

	out := destination{}
	if resolvedPipelineID.Valid {
		out.PipelineID = &resolvedPipelineID.String
	}
	if resolvedStageID.Valid {
		out.StageID = &resolvedStageID.String
	}
	if resolvedStageName.Valid && strings.TrimSpace(resolvedStageName.String) != "" {
		out.StageName = &resolvedStageName.String
	}
	if out.PipelineID != nil && out.StageID == nil {
		return destination{}, distribution.ErrIntakeDestinationUnavailable
	}

	return out, nil
}

func (repo Repository) resolveMoveStageDestination(ctx context.Context, tx pgx.Tx, organizationID string, stageID string) (moveStageDestination, error) {
	var resolved moveStageDestination
	var resolvedStageID, resolvedPipelineID, resolvedStageName string
	err := tx.QueryRow(ctx, `
		select
			s.id::text,
			s.pipeline_id::text,
			s.name,
			coalesce(s.is_won, false),
			coalesce(s.is_lost, false)
		from public.stages s
		join public.pipelines p
		  on p.id = s.pipeline_id
		 and p.organization_id = s.organization_id
		where s.id = $1::uuid
		  and s.organization_id = $2::uuid
		  and s.is_active = true
		  and p.is_active = true
		limit 1
		for share of s, p
	`, stageID, organizationID).Scan(
		&resolvedStageID,
		&resolvedPipelineID,
		&resolvedStageName,
		&resolved.IsWon,
		&resolved.IsLost,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return moveStageDestination{}, ErrMoveStageDestinationUnavailable
	}
	if err != nil {
		return moveStageDestination{}, err
	}
	resolved.PipelineID = &resolvedPipelineID
	resolved.StageID = &resolvedStageID
	resolved.StageName = &resolvedStageName
	return resolved, nil
}

func (repo Repository) resolveMoveStageDealStatus(ctx context.Context, tx pgx.Tx, organizationID string, stageID string, isWon bool, isLost bool) (string, error) {
	stageStatus, err := terminalStageDealStatus(isWon, isLost)
	if err != nil {
		return "", err
	}

	rows, err := tx.Query(ctx, `
		select lower(btrim(automation.action_config->>'deal_status'))
		from public.stage_automations automation
		where automation.organization_id = $1::uuid
		  and automation.stage_id = $2::uuid
		  and automation.is_active = true
		  and automation.trigger_type = 'on_enter'
		  and automation.automation_type = 'change_deal_status_on_enter'
		  and lower(btrim(automation.action_config->>'deal_status')) in ('open', 'won', 'lost')
		for share of automation
	`, organizationID, stageID)
	if err != nil {
		return "", err
	}
	defer rows.Close()

	automationStatus := ""
	for rows.Next() {
		var status string
		if err := rows.Scan(&status); err != nil {
			return "", err
		}
		if automationStatus != "" && automationStatus != status {
			return "", ErrMoveStageConfigurationConflict
		}
		automationStatus = status
	}
	if err := rows.Err(); err != nil {
		return "", err
	}

	if stageStatus != "" && automationStatus != "" && stageStatus != automationStatus {
		return "", ErrMoveStageConfigurationConflict
	}
	if automationStatus != "" {
		return automationStatus, nil
	}
	return stageStatus, nil
}

func terminalStageDealStatus(isWon bool, isLost bool) (string, error) {
	if isWon && isLost {
		return "", ErrMoveStageConfigurationConflict
	}
	if isWon {
		return "won", nil
	}
	if isLost {
		return "lost", nil
	}
	return "", nil
}

func (repo Repository) resolveStageTransitionDealStatus(ctx context.Context, tx pgx.Tx, organizationID string, current leadSnapshot, destinationStatus string) (string, error) {
	if destinationStatus != "" || current.StageID == "" || (current.DealStatus != "won" && current.DealStatus != "lost") {
		return destinationStatus, nil
	}

	var isWon, isLost bool
	err := tx.QueryRow(ctx, `
		select coalesce(s.is_won, false), coalesce(s.is_lost, false)
		from public.stages s
		where s.organization_id = $1::uuid and s.id = $2::uuid
		for share of s
	`, organizationID, current.StageID).Scan(&isWon, &isLost)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", err
	}

	sourceStatus, err := repo.resolveMoveStageDealStatus(ctx, tx, organizationID, current.StageID, isWon, isLost)
	if errors.Is(err, ErrMoveStageConfigurationConflict) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	// An ordinary stage move preserves manually recorded outcomes.
	if sourceStatus == current.DealStatus {
		return "open", nil
	}
	return "", nil
}

func moveStagePredictedStatusInput(status string, lostReason *string) updateInput {
	input := updateInput{}
	if status == "" {
		return input
	}
	statusCopy := status
	input.DealStatus = patchString{Set: true, Value: &statusCopy}
	if status == "lost" && lostReason != nil {
		reasonCopy := *lostReason
		input.LostReason = patchString{Set: true, Value: &reasonCopy}
	}
	return input
}

func moveStageActualStatusInput(current leadSnapshot, updated Lead) updateInput {
	input := updateInput{}
	if updated.DealStatus != current.DealStatus {
		status := updated.DealStatus
		input.DealStatus = patchString{Set: true, Value: &status}
	}
	if updated.LostReason != current.LostReason {
		input.LostReason.Set = true
		if strings.TrimSpace(updated.LostReason) != "" {
			reason := updated.LostReason
			input.LostReason.Value = &reason
		}
	}
	if updated.AssignedUserID != current.AssignedUserID {
		input.AssignedUserID.Set = true
		if updated.AssignedUserID != "" {
			assignedUserID := updated.AssignedUserID
			input.AssignedUserID.Value = &assignedUserID
		}
	}
	return input
}

func (repo Repository) validateAssignedUser(ctx context.Context, queryer leadTeamQueryer, organizationID string, assignedUserID *string) error {
	if assignedUserID == nil {
		return nil
	}

	var exists bool
	err := queryer.QueryRow(ctx, `
		select exists (
			select 1
			from public.organization_members om
			join public.users u on u.id = om.user_id
			where om.organization_id = $1::uuid
			  and om.user_id = $2::uuid
			  and om.is_active = true
			  and u.is_active = true
		)
	`, organizationID, *assignedUserID).Scan(&exists)
	if err != nil {
		return err
	}
	if !exists {
		return ErrInvalidReference
	}

	return nil
}

func (repo Repository) validateLeadTeam(ctx context.Context, queryer leadTeamQueryer, tenantContext tenant.Context, teamID *string) error {
	if teamID == nil {
		return nil
	}
	if !canViewAllLeads(tenantContext) && !tenantContext.LeadsTeam(*teamID) {
		return tenant.ErrOrganizationAccessDenied
	}

	var teamExists bool
	err := queryer.QueryRow(ctx, `
		select exists (
			select 1
			from public.teams t
			where t.organization_id = $1::uuid
			  and t.id = $2::uuid
			  and coalesce(t.is_active, true) = true
		)
	`, tenantContext.OrganizationID, *teamID).Scan(&teamExists)
	if err != nil {
		return err
	}
	if !teamExists {
		return ErrInvalidReference
	}
	return nil
}

func (repo Repository) validateRequestedRoundRobin(ctx context.Context, queryer leadTeamQueryer, organizationID string, roundRobinID *string) error {
	if roundRobinID == nil {
		return nil
	}

	var exists bool
	err := queryer.QueryRow(ctx, `
		select exists (
			select 1
			from public.round_robins rr
			where rr.organization_id = $1::uuid
			  and rr.id = $2::uuid
			  and coalesce(rr.is_active, true) = true
		)
	`, organizationID, *roundRobinID).Scan(&exists)
	if err != nil {
		return err
	}
	if !exists {
		return ErrInvalidReference
	}

	return nil
}

func (repo Repository) roundRobinReentryBehavior(ctx context.Context, queryer leadTeamQueryer, organizationID string, roundRobinID string) (string, error) {
	var behavior string
	err := queryer.QueryRow(ctx, `
		select case
		  when lower(btrim(coalesce(
		    nullif(rr.reentry_behavior, ''),
		    nullif(rr.rules->>'reentry_behavior', ''),
		    'redistribute'
		  ))) = 'keep_assignee' then 'keep_assignee'
		  else 'redistribute'
		end
		from public.round_robins rr
		where rr.organization_id = $1::uuid
		  and rr.id = $2::uuid
		  and coalesce(rr.is_active, true) = true
		limit 1
		for share of rr
	`, organizationID, roundRobinID).Scan(&behavior)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrInvalidReference
	}
	return behavior, err
}

func (repo Repository) resolveLeadIntakeDestination(
	ctx context.Context,
	queryer leadTeamQueryer,
	organizationID string,
	input createInput,
	resolvedDestination destination,
) (distribution.IntakeDestination, error) {
	if input.RoundRobinID != nil {
		roundRobinID := strings.ToLower(strings.TrimSpace(*input.RoundRobinID))
		behavior, err := repo.roundRobinReentryBehavior(ctx, queryer, organizationID, roundRobinID)
		if err != nil {
			return distribution.IntakeDestination{}, err
		}
		return distribution.IntakeDestination{
			RoundRobinID:    &roundRobinID,
			ReentryBehavior: behavior,
			Resolved:        true,
		}, nil
	}
	if !shouldAutoDistribute(input) {
		return distribution.IntakeDestination{}, nil
	}

	return distribution.ResolveIntakeDestination(ctx, queryer, distribution.IntakeContext{
		OrganizationID:     organizationID,
		PipelineID:         resolvedDestination.PipelineID,
		Source:             input.Source,
		PropertyID:         input.PropertyID,
		InterestPropertyID: input.PropertyID,
		TagIDs:             input.TagIDs,
		City:               input.Cidade,
	})
}

func sameLeadIntakeDestination(left distribution.IntakeDestination, right distribution.IntakeDestination) bool {
	if left.Resolved != right.Resolved ||
		distribution.IntakeScopeKey(left.RoundRobinID) != distribution.IntakeScopeKey(right.RoundRobinID) ||
		!slices.Equal(left.TagIDs, right.TagIDs) {
		return false
	}
	if left.RoundRobinID == nil {
		return true
	}
	return left.ReentryBehavior == right.ReentryBehavior
}

func (repo Repository) validateRoundRobinAssigneeTeam(ctx context.Context, queryer leadTeamQueryer, organizationID string, teamID string, assignedUserID *string) error {
	if strings.TrimSpace(teamID) == "" || assignedUserID == nil {
		return nil
	}

	var isActiveMember bool
	err := queryer.QueryRow(ctx, `
		select exists (
			select 1
			from public.team_members tm
			join public.organization_members om
			  on om.organization_id = tm.organization_id
			 and om.user_id = tm.user_id
			 and om.is_active = true
			 and om.deleted_at is null
			 and om.membership_generation = tm.membership_generation
			where tm.organization_id = $1::uuid
			  and tm.team_id = $2::uuid
			  and tm.user_id = $3::uuid
			  and coalesce(tm.is_active, true) = true
		)
	`, organizationID, teamID, *assignedUserID).Scan(&isActiveMember)
	if err != nil {
		return err
	}
	if !isActiveMember {
		return ErrLeadAssigneeTeamMismatch
	}

	return nil
}

func updateChangesLeadTeamAssignment(input updateInput) bool {
	return input.TeamID.Set || input.AssignedUserID.Set
}

func (repo Repository) insertTransferNotification(ctx context.Context, tx pgx.Tx, tenantContext tenant.Context, current leadSnapshot, assignedUserID *string, reason string) error {
	if assignedUserID == nil || strings.TrimSpace(*assignedUserID) == "" || current.AssignedUserID == *assignedUserID || !shouldInsertTransferNotification(reason) {
		return nil
	}

	oldUserName := ""
	if current.AssignedUserID != "" {
		oldUserName, _ = repo.getUserDisplayName(ctx, tx, current.AssignedUserID)
	}
	eventAt := time.Now().UTC()
	return repo.insertNotification(ctx, tx, tenantContext.OrganizationID, *assignedUserID, current.ID, "Lead transferido para voce", fmt.Sprintf("%s foi transferido para voce", current.Name), "lead_transferred", map[string]any{
		"lead_name":         current.Name,
		"from_user_id":      nullableString(current.AssignedUserID),
		"from_user_name":    oldUserName,
		"transfer_reason":   reason,
		"transferred_by":    nullableString(tenantContext.UserID),
		"transfer_event_at": eventAt.Format(time.RFC3339Nano),
		"pipeline_id":       nullableString(current.PipelineID),
		"stage_id":          nullableString(current.StageID),
		"dedupe_key":        notificationDedupeKey("lead_transferred", current.ID, *assignedUserID, current.AssignedUserID, reason, eventAt.Format(time.RFC3339Nano)),
	})
}

func shouldInsertTransferNotification(reason string) bool {
	// The redistribution worker emits richer received/away notifications after
	// the assignment succeeds. Emitting the generic transfer notice here would
	// duplicate WhatsApp and push deliveries for the new assignee.
	return !strings.EqualFold(strings.TrimSpace(reason), "auto_redistribution")
}

func (repo Repository) assignmentLogUsesCanonicalSchema(ctx context.Context, tx pgx.Tx) (bool, error) {
	var hasOldUser bool
	var hasNewUser bool
	var hasCreatedBy bool
	err := tx.QueryRow(ctx, `
		select
			exists (
				select 1
				from information_schema.columns
				where table_schema = 'public'
				  and table_name = 'assignments_log'
				  and column_name = 'old_user_id'
			),
			exists (
				select 1
				from information_schema.columns
				where table_schema = 'public'
				  and table_name = 'assignments_log'
				  and column_name = 'new_user_id'
			),
			exists (
				select 1
				from information_schema.columns
				where table_schema = 'public'
				  and table_name = 'assignments_log'
				  and column_name = 'created_by'
			)
	`).Scan(&hasOldUser, &hasNewUser, &hasCreatedBy)
	if err != nil {
		return false, err
	}
	return hasOldUser && hasNewUser && hasCreatedBy, nil
}

func (repo Repository) validateProperty(ctx context.Context, tx pgx.Tx, tenantContext tenant.Context, propertyID *string) error {
	if propertyID == nil {
		return nil
	}
	if !propertyscope.CanRead(tenantContext) {
		return ErrInvalidReference
	}

	var exists bool
	err := tx.QueryRow(ctx, `
		select exists (
			select 1
			from public.properties property
			where property.organization_id = $1::uuid
			  and property.id = $2::uuid
			  and `+propertyscope.VisibilitySQL("property", "$3", "$4", "$5")+`
		)
	`,
		tenantContext.OrganizationID,
		*propertyID,
		propertyscope.CanViewAll(tenantContext),
		nullableString(tenantContext.UserID),
		propertyscope.CanViewTeam(tenantContext),
	).Scan(&exists)
	if err != nil {
		return err
	}
	if !exists {
		return ErrInvalidReference
	}

	return nil
}

func (repo Repository) validateCreatePropertyReferences(ctx context.Context, tx pgx.Tx, tenantContext tenant.Context, input createInput) error {
	if err := repo.validateProperty(ctx, tx, tenantContext, input.PropertyID); err != nil {
		return err
	}
	for _, value := range input.InterestPropertyIDs {
		propertyID := value
		if err := repo.validateProperty(ctx, tx, tenantContext, &propertyID); err != nil {
			return err
		}
	}
	return nil
}

func (repo Repository) validateUpdatePropertyReferences(ctx context.Context, tx pgx.Tx, tenantContext tenant.Context, current leadSnapshot, input updateInput) error {
	validate := func(currentID string, requestedID *string) error {
		if requestedID == nil || *requestedID != currentID {
			return repo.validateProperty(ctx, tx, tenantContext, requestedID)
		}
		// An unchanged lead link is already part of this lead. Check its tenant,
		// but do not require new property access for an unrelated lead edit.
		var exists bool
		if err := tx.QueryRow(ctx, `
			select exists (
				select 1 from public.properties
				where organization_id = $1::uuid and id = $2::uuid
			)
		`, tenantContext.OrganizationID, *requestedID).Scan(&exists); err != nil {
			return err
		}
		if !exists {
			return ErrInvalidReference
		}
		return nil
	}
	if input.PropertyID.Set {
		if err := validate(current.PropertyID, input.PropertyID.Value); err != nil {
			return err
		}
	}
	if input.InterestPropertyID.Set {
		if err := validate(current.InterestPropertyID, input.InterestPropertyID.Value); err != nil {
			return err
		}
	}
	if input.InterestPropertyIDs.Set {
		currentInterests := leadInterestPropertyIDs(current)
		for _, value := range input.InterestPropertyIDs.Value {
			propertyID := value
			currentID := ""
			if containsLeadPropertyID(currentInterests, propertyID) {
				currentID = propertyID
			}
			if err := validate(currentID, &propertyID); err != nil {
				return err
			}
		}
	}
	return nil
}

func (repo Repository) getLeadSnapshotForUpdate(ctx context.Context, tx pgx.Tx, organizationID string, leadID string) (leadSnapshot, error) {
	return repo.getLeadSnapshotWithLock(ctx, tx, organizationID, leadID, "for no key update of l")
}

func (repo Repository) getLeadSnapshotForDelete(ctx context.Context, tx pgx.Tx, organizationID string, leadID string) (leadSnapshot, error) {
	return repo.getLeadSnapshotWithLock(ctx, tx, organizationID, leadID, "for update of l")
}

func (repo Repository) getLeadSnapshotWithLock(ctx context.Context, tx pgx.Tx, organizationID string, leadID string, lockClause string) (leadSnapshot, error) {
	var snapshot leadSnapshot
	var teamID, phone, assignedUserID, pipelineID, stageID, stageName, lostReason, interestValue, propertyID, interestPropertyID, propertyCode pgtype.Text
	var rawData []byte

	query := `
		select
			l.id::text,
			nullif(to_jsonb(l)->>'team_id', ''),
			l.name,
			l.phone,
			l.assigned_user_id::text,
			l.pipeline_id::text,
			l.stage_id::text,
			s.name,
			l.deal_status,
			l.lost_reason,
			l.valor_interesse::text,
			l.property_id::text,
			l.interest_property_id::text,
			l.property_code,
			to_jsonb(l)
		from public.leads l
		left join public.stages s
		  on s.id = l.stage_id
		 and s.organization_id = l.organization_id
		where l.organization_id = $1::uuid
		  and l.id = $2::uuid
		limit 1
		` + lockClause
	err := tx.QueryRow(ctx, query, organizationID, leadID).Scan(&snapshot.ID, &teamID, &snapshot.Name, &phone, &assignedUserID, &pipelineID, &stageID, &stageName, &snapshot.DealStatus, &lostReason, &interestValue, &propertyID, &interestPropertyID, &propertyCode, &rawData)
	if errors.Is(err, pgx.ErrNoRows) {
		return leadSnapshot{}, ErrLeadNotFound
	}
	if err != nil {
		return leadSnapshot{}, err
	}

	snapshot.TeamID = textValue(teamID)
	snapshot.Phone = textValue(phone)
	snapshot.AssignedUserID = textValue(assignedUserID)
	snapshot.PipelineID = textValue(pipelineID)
	snapshot.StageID = textValue(stageID)
	snapshot.StageName = textValue(stageName)
	snapshot.LostReason = textValue(lostReason)
	snapshot.InterestValue = textValue(interestValue)
	snapshot.PropertyID = textValue(propertyID)
	snapshot.InterestPropertyID = textValue(interestPropertyID)
	snapshot.PropertyCode = textValue(propertyCode)
	if err := json.Unmarshal(rawData, &snapshot.Data); err != nil {
		return leadSnapshot{}, err
	}
	poolAccess, err := queuePoolAccessAfterLeadLock(ctx, tx, organizationID, leadID, nil)
	if err != nil {
		return leadSnapshot{}, err
	}
	snapshot.Data["__queue_pool_private"] = poolAccess != nil

	return snapshot, nil
}

func changedLeadAuditData(current map[string]any, requested map[string]any) (map[string]any, map[string]any) {
	oldData := make(map[string]any)
	newData := make(map[string]any)
	for key, newValue := range requested {
		oldValue := currentLeadAuditValue(current, key)
		if leadAuditValuesEqual(key, oldValue, newValue) {
			continue
		}
		if key == "cpf" || key == "rg" {
			oldData[key] = protectedAuditValue(oldValue)
			newData[key] = protectedAuditValue(newValue)
			continue
		}
		oldData[key] = oldValue
		newData[key] = newValue
	}
	return oldData, newData
}

func currentLeadAuditValue(current map[string]any, key string) any {
	if key == "interest_property_ids" {
		propertyID, _ := current["property_id"].(string)
		interestPropertyID, _ := current["interest_property_id"].(string)
		return leadInterestPropertyIDs(leadSnapshot{Data: current, PropertyID: propertyID, InterestPropertyID: interestPropertyID})
	}
	profileKey := ""
	switch key {
	case "person_type":
		profileKey = "personType"
	case "social_name":
		profileKey = "socialName"
	case "birth_date":
		profileKey = "birthDate"
	case "corporate_name":
		profileKey = "corporateName"
	case "trade_name":
		profileKey = "tradeName"
	case "state_registration":
		profileKey = "stateRegistration"
	case "gender", "cpf", "rg", "cnpj":
		profileKey = key
	}
	if profileKey == "" {
		return current[key]
	}
	metadata, ok := current["metadata"].(map[string]any)
	if !ok {
		return nil
	}
	profile, ok := metadata["profile"].(map[string]any)
	if !ok {
		return nil
	}
	return profile[profileKey]
}

func protectedAuditValue(value any) any {
	if strings.TrimSpace(fmt.Sprint(value)) == "" || value == nil {
		return nil
	}
	return "Protegido"
}

func leadAuditValuesEqual(key string, left any, right any) bool {
	if key == "interest_property_ids" {
		return sameLeadPropertyIDs(leadPropertyIDsFromValue(left), leadPropertyIDsFromValue(right))
	}
	if key == "trabalha" || key == "procura_financiamento" || key == "is_own_resource" {
		return leadAuditBoolValue(left) == leadAuditBoolValue(right)
	}
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	if key == "valor_interesse" || key == "commission_percentage" {
		leftNumber, leftErr := strconv.ParseFloat(fmt.Sprint(left), 64)
		rightNumber, rightErr := strconv.ParseFloat(fmt.Sprint(right), 64)
		return leftErr == nil && rightErr == nil && leftNumber == rightNumber
	}
	return fmt.Sprint(left) == fmt.Sprint(right)
}

func leadAuditBoolValue(value any) bool {
	if value == nil {
		return false
	}
	parsed, err := strconv.ParseBool(fmt.Sprint(value))
	return err == nil && parsed
}

func (repo Repository) getLeadForMutation(ctx context.Context, tx pgx.Tx, tenantContext tenant.Context, leadID string) (Lead, error) {
	args, propertyVisibility := appendCanonicalPropertyVisibility([]any{tenantContext.OrganizationID, leadID}, tenantContext, "visible_property")
	lead, err := scanLead(tx.QueryRow(ctx, `
		select `+leadSelectFields(propertyVisibility)+`
		from public.leads l
		left join public.stages s
		  on s.id = l.stage_id
		 and s.organization_id = l.organization_id
		left join public.users u on u.id = l.assigned_user_id
		where l.organization_id = $1::uuid
		  and l.id = $2::uuid
		limit 1
	`, args...))
	if errors.Is(err, pgx.ErrNoRows) {
		return Lead{}, ErrLeadNotFound
	}
	if err == nil {
		err = hydrateQueuePoolLead(ctx, tx, tenantContext, &lead)
	}
	return lead, err
}

func (repo Repository) canEditLead(ctx context.Context, tx pgx.Tx, tenantContext tenant.Context, assignedUserID string, teamID string) (bool, error) {
	_ = ctx
	_ = tx
	return authorization.CanOperateLead(tenantContext, authorization.LeadResource{AssignedUserID: assignedUserID, TeamID: teamID}), nil
}

func (repo Repository) applyDestinationAssignments(ctx context.Context, tx pgx.Tx, organizationID string, current leadSnapshot, input updateInput, addUUIDAssignment func(string, patchString), addRawAssignment func(string)) error {
	if !input.PipelineID.Set && !input.StageID.Set {
		return nil
	}

	if input.StageID.Set {
		if input.StageID.Value == nil {
			addUUIDAssignment("stage_id", input.StageID)
			if current.StageID != "" {
				addRawAssignment("stage_entered_at = null")
				addRawAssignment("board_order_at = null")
			}
			if input.PipelineID.Set {
				addUUIDAssignment("pipeline_id", input.PipelineID)
			}
			return nil
		}

		var pipelineID *string
		if input.PipelineID.Set {
			pipelineID = input.PipelineID.Value
		}

		resolvedDestination, err := repo.resolveDestination(ctx, tx, organizationID, pipelineID, input.StageID.Value)
		if err != nil {
			return err
		}

		addUUIDAssignment("pipeline_id", patchString{Set: true, Value: resolvedDestination.PipelineID})
		addUUIDAssignment("stage_id", patchString{Set: true, Value: resolvedDestination.StageID})
		if resolvedDestination.StageID != nil && current.StageID != *resolvedDestination.StageID {
			addRawAssignment("stage_entered_at = now()")
			addRawAssignment("board_order_at = now()")
		}
		return nil
	}

	if input.PipelineID.Value == nil {
		addUUIDAssignment("pipeline_id", input.PipelineID)
		addUUIDAssignment("stage_id", patchString{Set: true})
		if current.StageID != "" {
			addRawAssignment("stage_entered_at = null")
			addRawAssignment("board_order_at = null")
		}
		return nil
	}

	resolvedDestination, err := repo.resolveDestination(ctx, tx, organizationID, input.PipelineID.Value, nil)
	if err != nil {
		return err
	}

	addUUIDAssignment("pipeline_id", patchString{Set: true, Value: resolvedDestination.PipelineID})
	addUUIDAssignment("stage_id", patchString{Set: true, Value: resolvedDestination.StageID})
	if resolvedDestination.StageID != nil && current.StageID != *resolvedDestination.StageID {
		addRawAssignment("stage_entered_at = now()")
		addRawAssignment("board_order_at = now()")
	}

	return nil
}

func (repo Repository) applyDestinationDealStatus(ctx context.Context, tx pgx.Tx, organizationID string, current leadSnapshot, input *updateInput) error {
	if input == nil || (!input.PipelineID.Set && !input.StageID.Set) {
		return nil
	}

	var destinationStageID string
	if input.StageID.Set {
		if input.StageID.Value != nil {
			destinationStageID = *input.StageID.Value
		}
	} else if input.PipelineID.Value != nil {
		resolved, err := repo.resolveDestination(ctx, tx, organizationID, input.PipelineID.Value, nil)
		if err != nil {
			return err
		}
		if resolved.StageID != nil {
			destinationStageID = *resolved.StageID
		}
	}

	if destinationStageID == current.StageID {
		return nil
	}

	destinationStatus := ""
	if destinationStageID != "" {
		resolved, err := repo.resolveMoveStageDestination(ctx, tx, organizationID, destinationStageID)
		if err != nil {
			return err
		}
		if input.PipelineID.Set && input.PipelineID.Value != nil && (resolved.PipelineID == nil || *resolved.PipelineID != *input.PipelineID.Value) {
			return ErrInvalidReference
		}
		destinationStatus, err = repo.resolveMoveStageDealStatus(ctx, tx, organizationID, destinationStageID, resolved.IsWon, resolved.IsLost)
		if err != nil {
			return err
		}
	}

	destinationStatus, err := repo.resolveStageTransitionDealStatus(ctx, tx, organizationID, current, destinationStatus)
	if err != nil {
		return err
	}
	return mergeStageDrivenDealStatus(input, destinationStatus)
}

func mergeStageDrivenDealStatus(input *updateInput, destinationStatus string) error {
	if input == nil || destinationStatus == "" {
		return nil
	}
	if input.DealStatus.Set {
		if input.DealStatus.Value == nil || *input.DealStatus.Value != destinationStatus {
			return fmt.Errorf("%w: dealStatus conflicts with the destination stage", ErrInvalidInput)
		}
		return nil
	}
	status := destinationStatus
	input.DealStatus = patchString{Set: true, Value: &status}
	return nil
}

func (repo Repository) findExistingLeadByPhone(ctx context.Context, organizationID string, phone *string, intakeScopeKey string, readQueryers ...leadTeamQueryer) (*existingLeadMatch, error) {
	if phone == nil {
		return nil, nil
	}

	if normalizePhone(*phone) == "" {
		return nil, nil
	}

	var match existingLeadMatch
	var teamID, phoneValue, assignedUserID, assignedUserName pgtype.Text
	queryer := repo.leadPhoneLookupQueryer(readQueryers)
	err := queryer.QueryRow(ctx, `
		select
			l.id::text,
			nullif(to_jsonb(l)->>'team_id', ''),
			l.phone,
			l.assigned_user_id::text,
			u.name
		from public.leads l
		left join public.users u on u.id = l.assigned_user_id
		where l.organization_id = $1::uuid
		  and l.intake_scope_key = $3
		  and l.phone is not null
		  and btrim(l.phone) <> ''
		  and normalize_phone(l.phone) is not null
		  and normalize_phone(l.phone) <> ''
		  and normalize_phone(l.phone) = normalize_phone($2)
		order by l.created_at asc
		limit 1
	`, organizationID, *phone, intakeScopeKey).Scan(&match.ID, &teamID, &phoneValue, &assignedUserID, &assignedUserName)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	match.TeamID = textValue(teamID)
	match.Phone = textValue(phoneValue)
	match.AssignedUserID = textValue(assignedUserID)
	match.AssignedUserName = textValue(assignedUserName)

	return &match, nil
}

func (repo Repository) findExistingLeadByPhoneLegacy(ctx context.Context, organizationID string, phone *string, readQueryers ...leadTeamQueryer) (*existingLeadMatch, error) {
	if phone == nil || normalizePhone(*phone) == "" {
		return nil, nil
	}

	var match existingLeadMatch
	var teamID, phoneValue, assignedUserID, assignedUserName pgtype.Text
	queryer := repo.leadPhoneLookupQueryer(readQueryers)
	err := queryer.QueryRow(ctx, `
		select
			l.id::text,
			nullif(to_jsonb(l)->>'team_id', ''),
			l.phone,
			l.assigned_user_id::text,
			u.name
		from public.leads l
		left join public.users u on u.id = l.assigned_user_id
		where l.organization_id = $1::uuid
		  and l.phone is not null
		  and btrim(l.phone) <> ''
		  and normalize_phone(l.phone) is not null
		  and normalize_phone(l.phone) <> ''
		  and normalize_phone(l.phone) = normalize_phone($2)
		order by l.created_at asc
		limit 1
	`, organizationID, *phone).Scan(&match.ID, &teamID, &phoneValue, &assignedUserID, &assignedUserName)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	match.TeamID = textValue(teamID)
	match.Phone = textValue(phoneValue)
	match.AssignedUserID = textValue(assignedUserID)
	match.AssignedUserName = textValue(assignedUserName)
	return &match, nil
}

func (repo Repository) findExistingLeadByPhoneForUpdate(
	ctx context.Context,
	tx pgx.Tx,
	organizationID string,
	phone *string,
	intakeScopeKey string,
	legacyIdentity bool,
) (*existingLeadMatch, error) {
	if phone == nil || normalizePhone(*phone) == "" {
		return nil, nil
	}

	scopePredicate := ""
	args := []any{organizationID, *phone}
	if !legacyIdentity {
		scopePredicate = "and l.intake_scope_key = $3"
		args = append(args, intakeScopeKey)
	}

	rows, err := tx.Query(ctx, fmt.Sprintf(`
		select
			l.id::text,
			nullif(to_jsonb(l)->>'team_id', ''),
			l.phone,
			l.assigned_user_id::text,
			u.name
		from public.leads l
		left join public.users u on u.id = l.assigned_user_id
		where l.organization_id = $1::uuid
		  %s
		  and l.phone is not null
		  and btrim(l.phone) <> ''
		  and normalize_phone(l.phone) is not null
		  and normalize_phone(l.phone) <> ''
		  and normalize_phone(l.phone) = normalize_phone($2)
		order by l.created_at asc, l.id asc
		limit 2
		for update of l
	`, scopePredicate), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var match *existingLeadMatch
	for rows.Next() {
		if match != nil {
			return nil, ErrLeadPhoneConflict
		}
		current := existingLeadMatch{}
		var teamID, phoneValue, assignedUserID, assignedUserName pgtype.Text
		if err := rows.Scan(&current.ID, &teamID, &phoneValue, &assignedUserID, &assignedUserName); err != nil {
			return nil, err
		}
		current.TeamID = textValue(teamID)
		current.Phone = textValue(phoneValue)
		current.AssignedUserID = textValue(assignedUserID)
		current.AssignedUserName = textValue(assignedUserName)
		match = &current
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return match, nil
}

func (repo Repository) insertLeadTags(ctx context.Context, tx pgx.Tx, organizationID string, leadID string, tagIDs []string) error {
	for _, tagID := range tagIDs {
		if _, err := repo.getTagName(ctx, tx, organizationID, tagID); err != nil {
			return err
		}

		if _, err := tx.Exec(ctx, `
			insert into public.lead_tags (
				organization_id,
				lead_id,
				tag_id
			)
			values (
				$1::uuid,
				$2::uuid,
				$3::uuid
			)
			on conflict (lead_id, tag_id) do nothing
		`, organizationID, leadID, tagID); err != nil {
			return err
		}
	}

	return nil
}

func (repo Repository) getTagName(ctx context.Context, tx pgx.Tx, organizationID string, tagID string) (string, error) {
	var name string
	err := tx.QueryRow(ctx, `
		select name
		from public.tags
		where organization_id = $1::uuid
		  and id = $2::uuid
		limit 1
	`, organizationID, tagID).Scan(&name)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", ErrInvalidReference
	}
	if err != nil {
		return "", err
	}

	return name, nil
}

func (repo Repository) applySelectedPropertyCommercialValues(ctx context.Context, tx pgx.Tx, tenantContext tenant.Context, current leadSnapshot, input *updateInput) error {
	if input == nil || (!input.PropertyID.Set && !input.InterestPropertyID.Set) {
		return nil
	}

	currentPropertyID := selectedLeadPropertyID(current, updateInput{})
	propertyID := selectedLeadPropertyID(current, *input)
	if propertyID == currentPropertyID {
		return nil
	}

	if propertyID == "" {
		input.InterestValue = patchString{Set: true}
		input.CommissionPercentage = patchString{Set: true}
		return nil
	}

	canReadManagedCommercialValues := propertyscope.CanViewAll(tenantContext)
	commercialProjection := `nullif(property.preco, 0)::text, null::text`
	if canReadManagedCommercialValues {
		commercialProjection = `coalesce(nullif(property.preco, 0), nullif(property.valor_venda_avaliado, 0))::text,
		       property.commission_percentage::text`
	}
	var price, commission pgtype.Text
	if err := tx.QueryRow(ctx, `
		select `+commercialProjection+`
		from public.properties property
		where property.organization_id = $1::uuid
		  and property.id = $2::uuid
		  and `+propertyscope.VisibilitySQL("property", "$3", "$4", "$5")+`
		limit 1
	`,
		tenantContext.OrganizationID,
		propertyID,
		propertyscope.CanViewAll(tenantContext),
		nullableString(tenantContext.UserID),
		propertyscope.CanViewTeam(tenantContext),
	).Scan(&price, &commission); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrInvalidReference
		}
		return err
	}

	input.InterestValue = patchString{Set: true}
	if price.Valid {
		value := price.String
		input.InterestValue.Value = &value
	}
	if canReadManagedCommercialValues {
		input.CommissionPercentage = patchString{Set: true}
		if commission.Valid {
			value := commission.String
			input.CommissionPercentage.Value = &value
		}
	}

	return normalizeLeadUpdateFinancialInput(input, 0)
}

func (repo Repository) insertDealStatusActivities(ctx context.Context, tx pgx.Tx, tenantContext tenant.Context, current leadSnapshot, input updateInput, provenance ...map[string]any) error {
	if !input.DealStatus.Set || input.DealStatus.Value == nil || *input.DealStatus.Value == current.DealStatus {
		return nil
	}

	newStatus := *input.DealStatus.Value
	lostReason := current.LostReason
	if input.LostReason.Set {
		lostReason = ""
		if input.LostReason.Value != nil {
			lostReason = *input.LostReason.Value
		}
	}

	interestValue := current.InterestValue
	if input.InterestValue.Set {
		interestValue = ""
		if input.InterestValue.Value != nil {
			interestValue = *input.InterestValue.Value
		}
	}

	content := fmt.Sprintf(`Lead "%s" reaberto`, current.Name)
	if newStatus == "won" {
		content = fmt.Sprintf(`Lead "%s" marcado como GANHO`, current.Name)
	}
	if newStatus == "lost" {
		content = fmt.Sprintf(`Lead "%s" marcado como PERDIDO`, current.Name)
		if lostReason != "" {
			content = content + " - Motivo: " + lostReason
		}
	}

	metadata := map[string]any{
		"new_status":      newStatus,
		"from_status":     current.DealStatus,
		"to_status":       newStatus,
		"previous_status": current.DealStatus,
		"valor_interesse": nullableString(interestValue),
	}
	if newStatus == "lost" && lostReason != "" {
		metadata["lost_reason"] = lostReason
	}
	for _, values := range provenance {
		for key, value := range values {
			metadata[key] = value
		}
	}

	if err := repo.insertActivity(ctx, tx, tenantContext.OrganizationID, current.ID, tenantContext.UserID, "status_change", content, metadata); err != nil {
		return err
	}

	return nil
}

func (repo Repository) insertLeadUpdateActivities(ctx context.Context, tx pgx.Tx, tenantContext tenant.Context, current leadSnapshot, input updateInput) error {
	if input.Feedback.Set && input.Feedback.Value != nil {
		feedback := strings.TrimSpace(*input.Feedback.Value)
		if feedback != "" {
			if err := repo.insertActivity(ctx, tx, tenantContext.OrganizationID, current.ID, tenantContext.UserID, "note", feedback, map[string]any{
				"kind":   "feedback",
				"origin": "lead_update",
			}); err != nil {
				return err
			}
		}
	}

	if input.StageID.Set && input.StageID.Value != nil && *input.StageID.Value != current.StageID {
		var stageName, pipelineID string
		if err := tx.QueryRow(ctx, `
			select s.name, s.pipeline_id::text
			from public.stages s
			where s.organization_id = $1::uuid
			  and s.id = $2::uuid
			limit 1
		`, tenantContext.OrganizationID, *input.StageID.Value).Scan(&stageName, &pipelineID); err != nil {
			return err
		}
		if err := repo.insertActivity(ctx, tx, tenantContext.OrganizationID, current.ID, tenantContext.UserID, "stage_change", fmt.Sprintf(`Lead "%s" movido de etapa`, current.Name), map[string]any{
			"from_stage_id": nullableString(current.StageID),
			"to_stage_id":   *input.StageID.Value,
			"from_stage":    nullableString(current.StageName),
			"to_stage":      stageName,
			"from_pipeline": nullableString(current.PipelineID),
			"to_pipeline":   pipelineID,
		}); err != nil {
			return err
		}
	}

	propertyID := selectedLeadPropertyID(current, input)
	currentPropertyID := selectedLeadPropertyID(current, updateInput{})
	if propertyID == "" || propertyID == currentPropertyID {
		return nil
	}

	commercialProjection := "null::text"
	includeManagedCommission := propertyscope.CanViewAll(tenantContext)
	if includeManagedCommission {
		commercialProjection = "property.commission_percentage::text"
	}
	var title, code, price, commission pgtype.Text
	if err := tx.QueryRow(ctx, `
		select property.title, property.code, property.preco::text, `+commercialProjection+`
		from public.properties property
		where property.organization_id = $1::uuid
		  and property.id = $2::uuid
		  and `+propertyscope.VisibilitySQL("property", "$3", "$4", "$5")+`
		limit 1
	`,
		tenantContext.OrganizationID,
		propertyID,
		propertyscope.CanViewAll(tenantContext),
		nullableString(tenantContext.UserID),
		propertyscope.CanViewTeam(tenantContext),
	).Scan(&title, &code, &price, &commission); err != nil {
		return err
	}

	propertyTitle := textValue(title)
	propertyCode := textValue(code)
	content := strings.TrimSpace(strings.Join([]string{propertyCode, propertyTitle}, " - "))
	content = strings.Trim(content, "- ")
	if content == "" {
		content = "Imovel selecionado"
	}

	metadata := map[string]any{
		"property_id":    propertyID,
		"property_title": nullableString(propertyTitle),
		"property_code":  nullableString(propertyCode),
		"property_price": nullableString(textValue(price)),
		"origin":         "lead_update",
	}
	if includeManagedCommission {
		metadata["commission_percentage"] = nullableString(textValue(commission))
	}
	return repo.insertActivity(ctx, tx, tenantContext.OrganizationID, current.ID, tenantContext.UserID, "property_selected", content, metadata)
}

func (repo Repository) enqueueDealWonNotifications(ctx context.Context, queryer notificationRowsQueryer, tenantContext tenant.Context, current leadSnapshot, input updateInput) error {
	if !input.DealStatus.Set || input.DealStatus.Value == nil || *input.DealStatus.Value != "won" || current.DealStatus == "won" {
		return nil
	}

	assignedUserID := current.AssignedUserID
	if input.AssignedUserID.Set {
		assignedUserID = ""
		if input.AssignedUserID.Value != nil {
			assignedUserID = *input.AssignedUserID.Value
		}
	}

	interestValue := current.InterestValue
	if input.InterestValue.Set {
		interestValue = ""
		if input.InterestValue.Value != nil {
			interestValue = *input.InterestValue.Value
		}
	}

	recipients, err := repo.listDealWonNotificationRecipientsWithQueryer(ctx, queryer, tenantContext.OrganizationID, assignedUserID)
	if err != nil {
		return err
	}
	if len(recipients) == 0 {
		if assignedUserID != "" {
			recipients = []string{assignedUserID}
		}
	}
	actorName := "Equipe Vimob"
	if name, err := repo.getNotificationUserNameWithQueryer(ctx, queryer, tenantContext.OrganizationID, tenantContext.UserID); err != nil {
		return err
	} else if name != "" {
		actorName = name
	}
	organizationName := ""
	if err := queryer.QueryRow(ctx, `
		select coalesce(name, '')
		from public.organizations
		where id = $1::uuid
		limit 1
	`, tenantContext.OrganizationID).Scan(&organizationName); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return err
	}

	for _, recipientID := range recipients {
		if _, err := repo.enqueueDispatchNotificationWithQueryer(ctx, queryer, tenantContext.OrganizationID, recipientID, DispatchNotificationRequest{
			EventKey:  "deal_won",
			UserID:    recipientID,
			LeadID:    &current.ID,
			DedupeKey: dealWonNotificationDedupeKey(current, recipientID),
			Variables: map[string]any{
				"lead_name":         current.Name,
				"valor_interesse":   nullableString(interestValue),
				"actor_name":        actorName,
				"organization_name": organizationName,
			},
		}); err != nil {
			return err
		}
	}
	return nil
}

func dealWonNotificationDedupeKey(current leadSnapshot, recipientID string) string {
	// The pre-update timestamp identifies the open/lost -> won transition. It is
	// stable across a transaction retry, while a later reopen creates a new
	// episode that is allowed to notify the same recipient again.
	episode := firstNotificationText(stringFromMap(current.Data, "updated_at"), "initial")
	return notificationDedupeKey("deal_won", current.ID, recipientID, episode)
}

func (repo Repository) listDealWonNotificationRecipients(ctx context.Context, organizationID string, assignedUserID string) ([]string, error) {
	return repo.listDealWonNotificationRecipientsWithQueryer(ctx, repo.db.Pool(), organizationID, assignedUserID)
}

func (repo Repository) listDealWonNotificationRecipientsWithQueryer(ctx context.Context, queryer notificationRowsQueryer, organizationID string, assignedUserID string) ([]string, error) {
	rows, err := queryer.Query(ctx, `
		with base as (
			select nullif($2, '')::uuid as assigned_user_id
		),
		responsible as (
			select assigned_user_id as user_id
			from base
			where assigned_user_id is not null
		),
		admins as (
			select distinct om.user_id
			from public.organization_members om
			join public.users u on u.id = om.user_id
			where om.organization_id = $1::uuid
			  and coalesce(om.is_active, false) = true
			  and om.deleted_at is null
			  and coalesce(u.is_active, false) = true
			  and om.role in ('owner', 'admin', 'manager')
		),
		leaders as (
			select distinct leader.user_id
			from base
			join public.team_members member
			  on member.user_id = base.assigned_user_id
			 and member.organization_id = $1::uuid
			 and coalesce(member.is_active, true) = true
			join public.organization_members member_organization
			  on member_organization.organization_id = member.organization_id
			 and member_organization.user_id = member.user_id
			 and member_organization.is_active = true
			 and member_organization.deleted_at is null
			 and member_organization.membership_generation = member.membership_generation
			join public.team_members leader
			  on leader.team_id = member.team_id
			 and leader.organization_id = member.organization_id
			 and coalesce(leader.is_active, true) = true
			 and coalesce(leader.is_leader, false) = true
			join public.organization_members leader_organization
			  on leader_organization.organization_id = leader.organization_id
			 and leader_organization.user_id = leader.user_id
			 and leader_organization.is_active = true
			 and leader_organization.deleted_at is null
			 and leader_organization.membership_generation = leader.membership_generation
		)
		select distinct user_id::text
		from (
			select user_id from responsible
			union all
			select user_id from admins
			union all
			select user_id from leaders
		) recipients
		where user_id is not null
	`, organizationID, assignedUserID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	recipients := []string{}
	for rows.Next() {
		var userID string
		if err := rows.Scan(&userID); err != nil {
			return nil, err
		}
		if strings.TrimSpace(userID) != "" {
			recipients = append(recipients, userID)
		}
	}
	return recipients, rows.Err()
}

func (repo Repository) getNotificationUserName(ctx context.Context, organizationID string, userID string) (string, error) {
	return repo.getNotificationUserNameWithQueryer(ctx, repo.db.Pool(), organizationID, userID)
}

func (repo Repository) getNotificationUserNameWithQueryer(ctx context.Context, queryer notificationQueryer, organizationID string, userID string) (string, error) {
	var name pgtype.Text
	err := queryer.QueryRow(ctx, `
		select u.name
		from public.users u
		join public.organization_members om
		  on om.user_id = u.id
		 and om.organization_id = $1::uuid
		where u.id = $2::uuid
		  and coalesce(u.is_active, false) = true
		  and coalesce(om.is_active, false) = true
		limit 1
	`, organizationID, userID).Scan(&name)
	if errors.Is(err, pgx.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return textValue(name), nil
}

func (repo Repository) recordDealStatusGamification(ctx context.Context, tenantContext tenant.Context, current leadSnapshot, input updateInput) {
	if repo.gamificationRecorder == nil || !input.DealStatus.Set || input.DealStatus.Value == nil || *input.DealStatus.Value == current.DealStatus {
		return
	}

	newStatus := *input.DealStatus.Value
	switch newStatus {
	case "won":
		_ = repo.gamificationRecorder.RecordAction(ctx, tenantContext, "sale_closed", 1, current.ID)
	case "open":
		if current.DealStatus == "lost" {
			_ = repo.gamificationRecorder.RecordAction(ctx, tenantContext, "lost_lead_recovered", 1, current.ID)
		}
	}
}

func isLeadPhoneUniqueViolation(err error) bool {
	return leadPhoneUniqueViolationConstraint(err) != ""
}

func leadPhoneUniqueViolationConstraint(err error) string {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		return ""
	}

	if pgErr.Code != "23505" {
		return ""
	}
	switch pgErr.ConstraintName {
	case "leads_org_scope_phone_unique", "leads_org_phone_unique":
		return pgErr.ConstraintName
	default:
		return ""
	}
}

func isLinkedDevelopmentPropertyConsistencyViolation(err error) bool {
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) || pgErr.Code != "23514" {
		return false
	}

	switch pgErr.ConstraintName {
	case "property_development_unit_status_sync",
		"property_development_unit_price_sync",
		"property_development_unit_publication_sync":
		return true
	default:
		return false
	}
}

func (repo Repository) insertActivity(ctx context.Context, tx pgx.Tx, organizationID string, leadID string, userID string, activityType string, content string, metadata map[string]any) error {
	_, err := tx.Exec(ctx, `
		insert into public.activities (
			organization_id,
			lead_id,
			user_id,
			type,
			content,
			metadata
		)
		values (
			$1::uuid,
			$2::uuid,
			$3::uuid,
			$4,
			$5,
			$6::jsonb
		)
	`, organizationID, leadID, nullableString(userID), activityType, content, jsonb(metadata))
	return err
}

func (repo Repository) insertInitialFeedbackActivity(ctx context.Context, tx pgx.Tx, organizationID string, leadID string, userID string, message *string, origin string) error {
	if message == nil {
		return nil
	}

	feedback := strings.TrimSpace(*message)
	if feedback == "" {
		return nil
	}

	return repo.insertActivity(ctx, tx, organizationID, leadID, userID, "note", feedback, map[string]any{
		"kind":   "feedback",
		"origin": origin,
	})
}

func (repo Repository) insertNotification(ctx context.Context, tx pgx.Tx, organizationID string, userID string, leadID string, title string, content string, eventKey string, metadata map[string]any) error {
	return repo.insertNotificationWithType(ctx, tx, organizationID, userID, leadID, title, content, eventKey, "lead", metadata)
}

func (repo Repository) insertNotificationWithType(ctx context.Context, tx pgx.Tx, organizationID string, userID string, leadID string, title string, content string, eventKey string, notificationType string, metadata map[string]any) error {
	if userID == "" {
		return nil
	}

	notificationType = strings.TrimSpace(notificationType)
	if notificationType == "" {
		notificationType = "lead"
	}

	if metadata == nil {
		metadata = map[string]any{}
	}
	metadata = applyNotificationDispatchMetadata(metadata, eventKey, nil)
	dedupeKey := stringFromMap(metadata, "dedupe_key")

	_, err := tx.Exec(ctx, `
		with input as (
			select nullif($8, '') as dedupe_key
		)
		insert into public.notifications (
			organization_id,
			user_id,
			title,
			content,
			body,
			type,
			channel,
			lead_id,
			target_url,
			metadata
		)
		select
			$1::uuid,
			$2::uuid,
			$3,
			$4,
			$4,
			$6,
			'in_app',
			$5::uuid,
			'/crm/pipelines?lead=' || $5::text,
			$7::jsonb
		from input
		where input.dedupe_key is null
		   or not exists (
		     select 1
		     from public.notifications n
		     where n.organization_id = $1::uuid
		       and n.user_id = $2::uuid
		       and n.metadata->>'dedupe_key' = input.dedupe_key
		   )
	`, organizationID, userID, title, content, leadID, notificationType, jsonb(metadata), dedupeKey)
	if isNotificationDedupeConflict(err) {
		return nil
	}
	return err
}

func notificationDedupeKey(parts ...string) string {
	cleaned := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			cleaned = append(cleaned, part)
		}
	}
	return strings.Join(cleaned, ":")
}

func (repo Repository) getUserDisplayName(ctx context.Context, tx pgx.Tx, userID string) (string, error) {
	var name, email pgtype.Text
	err := tx.QueryRow(ctx, `
		select name, email
		from public.users
		where id = $1::uuid
	`, userID).Scan(&name, &email)
	if err != nil {
		return "", err
	}

	if value := textValue(name); value != "" {
		return value, nil
	}
	if value := textValue(email); value != "" {
		return value, nil
	}

	return userID, nil
}

func validateLostReasonContract(current leadSnapshot, input updateInput) error {
	nextStatus := current.DealStatus
	if input.DealStatus.Set {
		if input.DealStatus.Value == nil {
			return fmt.Errorf("%w: dealStatus is required", ErrInvalidInput)
		}
		nextStatus = *input.DealStatus.Value
	}

	nextLostReason := current.LostReason
	if input.LostReason.Set {
		nextLostReason = ""
		if input.LostReason.Value != nil {
			nextLostReason = strings.TrimSpace(*input.LostReason.Value)
		}
	}

	isMovingToLost := nextStatus == "lost" && current.DealStatus != "lost"
	requestedLostReason := ""
	if input.LostReason.Set && input.LostReason.Value != nil {
		requestedLostReason = strings.TrimSpace(*input.LostReason.Value)
	}
	if isMovingToLost && requestedLostReason == "" {
		return fmt.Errorf("%w: lostReason is required when dealStatus is lost", ErrLostReasonRequired)
	}

	lostReasonIsBlank := strings.TrimSpace(nextLostReason) == ""
	isClearingLostReason := nextStatus == "lost" && strings.TrimSpace(current.LostReason) != "" && input.LostReason.Set && lostReasonIsBlank
	if isClearingLostReason && lostReasonIsBlank {
		return fmt.Errorf("%w: lostReason is required when dealStatus is lost", ErrLostReasonRequired)
	}

	return nil
}

func normalizePhone(value string) string {
	var builder strings.Builder
	for _, char := range value {
		if unicode.IsDigit(char) {
			builder.WriteRune(char)
		}
	}

	digits := builder.String()
	if len(digits) >= 12 && strings.HasPrefix(digits, "55") {
		return digits[2:]
	}

	return digits
}

func leadIntakeScopeKey(roundRobinID *string) string {
	return distribution.IntakeScopeKey(roundRobinID)
}

func lockLeadIntakeIdentity(ctx context.Context, tx pgx.Tx, organizationID string, phone *string, intakeScopeKey string) error {
	if phone == nil || normalizePhone(*phone) == "" {
		return nil
	}
	_, err := tx.Exec(ctx, `
		select pg_advisory_xact_lock(identity_lock.lock_id)
		from (
			select distinct lock_candidates.lock_id
			from (values
				(hashtextextended($1 || ':legacy-global:' || normalize_phone($2), 0)),
				(hashtextextended($1 || ':' || $3 || ':' || normalize_phone($2), 0))
			) as lock_candidates(lock_id)
			order by lock_candidates.lock_id
		) as identity_lock
	`, organizationID, *phone, intakeScopeKey)
	return err
}

func legacyLeadPhoneUniquenessActive(ctx context.Context, queryer leadTeamQueryer) (bool, error) {
	var active bool
	err := queryer.QueryRow(ctx, `
		select to_regclass('public.leads_org_phone_unique') is not null
	`).Scan(&active)
	return active, err
}

func canViewAllLeads(tenantContext tenant.Context) bool {
	return tenantContext.IsSuperAdmin ||
		tenantContext.HasRole("owner", "admin") ||
		tenantContext.HasPermission(permissions.LeadViewAll)
}

func canManageLeads(tenantContext tenant.Context) bool {
	return canViewAllLeads(tenantContext) && tenantContext.HasPermission(permissions.LeadOperate)
}

func canCreateLeads(tenantContext tenant.Context) bool {
	return authorization.CanCreateLead(tenantContext)
}

func canCreateLeadInput(tenantContext tenant.Context, input createInput) bool {
	if input.ImportMode {
		return tenantContext.IsOrganizationMember() && tenantContext.HasPermission(permissions.LeadImport)
	}
	return canCreateLeads(tenantContext)
}

func canBindWhatsAppConversationDuringLeadCreation(tenantContext tenant.Context) bool {
	return tenantContext.HasModule("whatsapp") &&
		tenantContext.HasPermission(permissions.WhatsAppOperate) &&
		tenantContext.HasPermission(permissions.LeadOperate)
}

func canUseRequestedRoundRobin(tenantContext tenant.Context, input createInput) bool {
	return input.RoundRobinID == nil || tenantContext.HasPermission(permissions.DistributionManage)
}

func applyCreateAssignmentPolicy(tenantContext tenant.Context, input createInput) (createInput, error) {
	if canAssignLeads(tenantContext) {
		return input, nil
	}
	if input.AssignedUserID == nil || strings.TrimSpace(*input.AssignedUserID) == "" {
		if !keepsImportUnassignedForDistribution(input) {
			assignedUserID := tenantContext.UserID
			input.AssignedUserID = &assignedUserID
		}
		return input, nil
	}
	if strings.TrimSpace(*input.AssignedUserID) != tenantContext.UserID {
		return createInput{}, tenant.ErrOrganizationAccessDenied
	}
	return input, nil
}

func keepsImportUnassignedForDistribution(input createInput) bool {
	return input.ImportMode && input.AutoDistribute != nil && *input.AutoDistribute
}

func shouldAutoDistribute(input createInput) bool {
	return input.AutoDistribute == nil || *input.AutoDistribute
}

func newLeadDistributionRequest(tenantContext tenant.Context, input createInput, leadID string, intakeDestination distribution.IntakeDestination) distribution.Request {
	distributionSource := input.Source
	return distribution.Request{
		OrganizationID:     tenantContext.OrganizationID,
		LeadID:             leadID,
		IdempotencyKey:     "manual:" + leadID,
		RoundRobinID:       input.RoundRobinID,
		RoundRobinResolved: intakeDestination.Resolved,
		PreserveAssignee:   true,
		Source:             &distributionSource,
		OccurredAt:         time.Now().UTC(),
	}
}

func canEditAllLeads(tenantContext tenant.Context) bool {
	return canManageLeads(tenantContext)
}

func canAssignLeads(tenantContext tenant.Context) bool {
	return tenantContext.HasPermission(permissions.LeadOperate)
}

func canMoveLead(tenantContext tenant.Context, assignedUserID string) bool {
	return authorization.CanOperateLead(tenantContext, authorization.LeadResource{AssignedUserID: assignedUserID})
}

func canOperateLeadSnapshot(tenantContext tenant.Context, current leadSnapshot) bool {
	if isQueuePoolSnapshot(current) {
		return false
	}
	return authorization.CanOperateLead(tenantContext, authorization.LeadResource{
		AssignedUserID: current.AssignedUserID,
		TeamID:         current.TeamID,
	})
}

func canUpdateAssignedLeadOperationalPatch(tenantContext tenant.Context, current leadSnapshot, input updateInput) bool {
	if canOperateLeadSnapshot(tenantContext, current) {
		return isLeadStatusPatch(current, input) || isLeadFeedbackPatch(input) || isLeadPropertyInterestPatch(input)
	}

	return canUpdateLedLeadStatus(tenantContext, current, input)
}

func canUpdateVisibleLeadPropertyInterest(canViewLead bool, input updateInput) bool {
	return canViewLead && isLeadPropertyInterestPatch(input)
}

func canUpdateVisibleLeadStatus(canViewLead bool, current leadSnapshot, input updateInput) bool {
	return canViewLead &&
		isLeadStatusPatch(current, input) &&
		!input.PropertyID.Set &&
		!input.InterestPropertyID.Set &&
		!input.IsOwnResource.Set
}

func canUpdateAssignedLeadStatus(tenantContext tenant.Context, current leadSnapshot, input updateInput) bool {
	return canMoveLead(tenantContext, current.AssignedUserID) && isLeadStatusPatch(current, input) ||
		canUpdateLedLeadStatus(tenantContext, current, input)
}

func canUpdateLedLeadStatus(tenantContext tenant.Context, current leadSnapshot, input updateInput) bool {
	return canOperateLeadSnapshot(tenantContext, current) &&
		isLeadStatusPatch(current, input) &&
		!input.PropertyID.Set &&
		!input.InterestPropertyID.Set &&
		!input.IsOwnResource.Set
}

func isLeadStatusPatch(current leadSnapshot, input updateInput) bool {
	for _, field := range []patchString{
		input.Name,
		input.Email,
		input.Phone,
		input.Source,
		input.Message,
		input.PropertyCode,
		input.PipelineID,
		input.StageID,
		input.AssignedUserID,
		input.InterestValue,
		input.CommissionPercentage,
		input.Feedback,
		input.Cargo,
		input.Empresa,
		input.Profissao,
		input.Endereco,
		input.Numero,
		input.Complemento,
		input.Bairro,
		input.CEP,
		input.Cidade,
		input.UF,
		input.RendaFamiliar,
		input.FaixaValorImovel,
		input.FinalidadeCompra,
	} {
		if field.Set {
			return false
		}
	}

	if input.Trabalha.Set || input.ProcuraFinanciamento.Set {
		return false
	}

	if input.DealStatus.Set {
		return true
	}

	return current.DealStatus == "lost" &&
		input.LostReason.Set &&
		!input.PropertyID.Set &&
		!input.InterestPropertyID.Set &&
		!input.IsOwnResource.Set
}

func isLeadFeedbackPatch(input updateInput) bool {
	if !input.Feedback.Set {
		return false
	}

	for _, field := range []patchString{
		input.Name,
		input.Email,
		input.Phone,
		input.Source,
		input.Message,
		input.PropertyCode,
		input.PropertyID,
		input.InterestPropertyID,
		input.PipelineID,
		input.StageID,
		input.AssignedUserID,
		input.InterestValue,
		input.CommissionPercentage,
		input.DealStatus,
		input.LostReason,
		input.Cargo,
		input.Empresa,
		input.Profissao,
		input.Endereco,
		input.Numero,
		input.Complemento,
		input.Bairro,
		input.CEP,
		input.Cidade,
		input.UF,
		input.RendaFamiliar,
		input.FaixaValorImovel,
		input.FinalidadeCompra,
	} {
		if field.Set {
			return false
		}
	}

	return !input.Trabalha.Set &&
		!input.ProcuraFinanciamento.Set &&
		!input.IsOwnResource.Set
}

func isLeadPropertyInterestPatch(input updateInput) bool {
	if !input.PropertyID.Set && !input.InterestPropertyID.Set {
		return false
	}
	if (!input.PropertyID.Set || input.PropertyID.Value == nil) &&
		(!input.InterestPropertyID.Set || input.InterestPropertyID.Value == nil) {
		return false
	}

	for _, field := range []patchString{
		input.Name,
		input.Email,
		input.Phone,
		input.Source,
		input.Message,
		input.PipelineID,
		input.StageID,
		input.AssignedUserID,
		input.DealStatus,
		input.LostReason,
		input.Feedback,
		input.Cargo,
		input.Empresa,
		input.Profissao,
		input.Endereco,
		input.Numero,
		input.Complemento,
		input.Bairro,
		input.CEP,
		input.Cidade,
		input.UF,
		input.RendaFamiliar,
		input.FaixaValorImovel,
		input.FinalidadeCompra,
	} {
		if field.Set {
			return false
		}
	}

	return !input.Trabalha.Set &&
		!input.ProcuraFinanciamento.Set &&
		!input.IsOwnResource.Set
}

func canTransferLead(tenantContext tenant.Context, assignedUserID string) bool {
	return authorization.CanOperateLead(tenantContext, authorization.LeadResource{AssignedUserID: assignedUserID})
}

func canDeleteLeads(tenantContext tenant.Context) bool {
	return tenantContext.HasPermission(permissions.LeadDelete)
}
