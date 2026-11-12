package whatsapp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/leadscope"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/pgvalue"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/realtime"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/searchtext"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/whatsappbinding"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

// Signed Storage URLs are bearer credentials. Keep their lifetime short and
// let authorized clients renew through the tenant-scoped lazy endpoint.
const whatsappMediaSignedURLTTLSeconds = 15 * 60
const whatsappMediaSignedURLCacheSkew = time.Minute
const whatsappMediaSignedURLCacheMaxEntries = 4096

type cachedWhatsAppMediaSignedURL struct {
	url       string
	expiresAt time.Time
}

type boundedWhatsAppMediaSignedURLCache struct {
	mu         sync.Mutex
	maxEntries int
	entries    map[string]cachedWhatsAppMediaSignedURL
}

func newBoundedWhatsAppMediaSignedURLCache(maxEntries int) *boundedWhatsAppMediaSignedURLCache {
	if maxEntries < 1 {
		maxEntries = whatsappMediaSignedURLCacheMaxEntries
	}
	return &boundedWhatsAppMediaSignedURLCache{
		maxEntries: maxEntries,
		entries:    make(map[string]cachedWhatsAppMediaSignedURL, maxEntries),
	}
}

func (cache *boundedWhatsAppMediaSignedURLCache) Load(key string) (cachedWhatsAppMediaSignedURL, bool) {
	cache.mu.Lock()
	defer cache.mu.Unlock()
	entry, ok := cache.entries[key]
	if !ok {
		return cachedWhatsAppMediaSignedURL{}, false
	}
	if !entry.expiresAt.After(time.Now()) {
		delete(cache.entries, key)
		return cachedWhatsAppMediaSignedURL{}, false
	}
	return entry, true
}

func (cache *boundedWhatsAppMediaSignedURLCache) Store(key string, entry cachedWhatsAppMediaSignedURL) {
	cache.mu.Lock()
	defer cache.mu.Unlock()
	if _, exists := cache.entries[key]; !exists && len(cache.entries) >= cache.maxEntries {
		now := time.Now()
		oldestKey := ""
		var oldestExpiry time.Time
		for candidateKey, candidate := range cache.entries {
			if !candidate.expiresAt.After(now) {
				delete(cache.entries, candidateKey)
				continue
			}
			if oldestKey == "" || candidate.expiresAt.Before(oldestExpiry) {
				oldestKey = candidateKey
				oldestExpiry = candidate.expiresAt
			}
		}
		if len(cache.entries) >= cache.maxEntries && oldestKey != "" {
			delete(cache.entries, oldestKey)
		}
	}
	cache.entries[key] = entry
}

func (cache *boundedWhatsAppMediaSignedURLCache) Delete(key string) {
	cache.mu.Lock()
	delete(cache.entries, key)
	cache.mu.Unlock()
}

func (cache *boundedWhatsAppMediaSignedURLCache) Len() int {
	cache.mu.Lock()
	defer cache.mu.Unlock()
	return len(cache.entries)
}

var whatsappMediaSignedURLCache = newBoundedWhatsAppMediaSignedURLCache(whatsappMediaSignedURLCacheMaxEntries)

type GamificationRecorder interface {
	RecordAction(ctx context.Context, tenantContext tenant.Context, actionType string, quantity int, referenceID string) error
}

type Repository struct {
	db                        *dbpkg.Postgres
	storage                   storageClient
	functions                 functionsClient
	webhookSchemaGate         *evolutionWebhookSchemaGate
	postFormGuardEnabled      bool
	legacyNativeCompatEnabled bool
	gamificationRecorder      GamificationRecorder
	leadPublisher             realtime.Publisher
	avatarURLs                *boundedWhatsAppMediaSignedURLCache
	avatarSlots               chan struct{}

	liveBoundDeadBacklogBypassEnabled bool
}

type scanner interface {
	Scan(dest ...any) error
}

func NewRepository(db *dbpkg.Postgres, gamificationRecorder GamificationRecorder, storageConfig StorageConfig, publishers ...realtime.Publisher) Repository {
	publisher := realtime.Publisher(realtime.NoopPublisher{})
	if len(publishers) > 0 && publishers[0] != nil {
		publisher = publishers[0]
	}

	return Repository{
		db:                        db,
		storage:                   newStorageClient(storageConfig),
		functions:                 newFunctionsClient(storageConfig, db),
		webhookSchemaGate:         &evolutionWebhookSchemaGate{},
		postFormGuardEnabled:      storageConfig.WhatsAppPostFormFollowUpGuardEnabled,
		legacyNativeCompatEnabled: storageConfig.LegacyNativeCompatEnabled,
		gamificationRecorder:      gamificationRecorder,
		leadPublisher:             publisher,
		avatarURLs:                newBoundedWhatsAppMediaSignedURLCache(whatsappMediaSignedURLCacheMaxEntries),
		avatarSlots:               make(chan struct{}, conversationAvatarConcurrency),

		liveBoundDeadBacklogBypassEnabled: storageConfig.LiveBoundDeadBacklogBypassEnabled,
	}
}

func (repo Repository) ListSessions(ctx context.Context, tenantContext tenant.Context) ([]Session, error) {
	args := []any{tenantContext.OrganizationID, tenantContext.UserID}
	rows, err := repo.db.Pool().Query(ctx, `
		select `+sessionSelectFields()+`,
		       (ws.status = 'connected' and exists (select 1 from public.users actor where actor.id=$2::uuid and actor.organization_id=$1::uuid and coalesce(actor.is_active,false)) and
		        (ws.owner_user_id = $2::uuid or `+sessionGrantExistsSQL("ws", "$2::uuid", true)+`)) as can_send
		from public.whatsapp_sessions ws
		left join public.users owner on owner.id = ws.owner_user_id
		where ws.organization_id = $1::uuid
		  and coalesce(ws.is_active, true) = true
		  and coalesce(ws.status, '') <> 'deleted'
		  and ws.provider = 'evolution_go'
		  and (ws.owner_user_id = $2::uuid or `+sessionGrantExistsSQL("ws", "$2::uuid", false)+`)
		order by ws.created_at desc, ws.id desc
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	sessions := []Session{}
	for rows.Next() {
		session, err := scanSessionWithCanSend(rows)
		if err != nil {
			return nil, err
		}
		if session.OwnerUserID != tenantContext.UserID {
			// A recipient sees connection state, never owner-only provider settings.
			session.InstanceID = nil
			session.AdvancedSettings = nil
			session.Owner = nil
		}
		sessions = append(sessions, session)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return sessions, nil
}

func (repo Repository) GetSession(ctx context.Context, tenantContext tenant.Context, sessionID string) (Session, error) {
	sessionID, ok := normalizeUUID(sessionID)
	if !ok {
		return Session{}, ErrSessionNotFound
	}

	session, err := scanSession(repo.db.Pool().QueryRow(ctx, `
		select `+sessionSelectFields()+`
		from public.whatsapp_sessions ws
		left join public.users owner on owner.id = ws.owner_user_id
		where ws.organization_id = $1::uuid
		  and ws.id = $2::uuid
		  and coalesce(ws.is_active, true) = true
		  and coalesce(ws.status, '') <> 'deleted'
		  and ws.provider = 'evolution_go'
		  and ws.owner_user_id = $3::uuid
		limit 1
	`, tenantContext.OrganizationID, sessionID, tenantContext.UserID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Session{}, ErrSessionNotFound
	}
	if err != nil {
		return Session{}, err
	}
	canSend := session.Status == "connected"
	session.CanSend = &canSend

	return session, nil
}

func (repo Repository) ListSessionAccess(ctx context.Context, tenantContext tenant.Context, sessionID string) ([]SessionAccess, error) {
	sessionID, ok := normalizeUUID(sessionID)
	if !ok {
		return nil, ErrSessionNotFound
	}
	if err := repo.ensureCanManageSession(ctx, tenantContext, sessionID); err != nil {
		return nil, err
	}

	rows, err := repo.db.Pool().Query(ctx, `
		select access.id::text, access.session_id::text, access.user_id::text,
		       access.access_mode, coalesce(access.can_view, false),
		       access.can_read, coalesce(access.can_send, false),
		       access.only_leads_access, access.granted_by::text,
		       access.grant_scope, access.grant_team_id::text,
		       access.created_at,
		       recipient.id::text,
		       coalesce(recipient.name, ''), coalesce(recipient.email, '')
		from public.whatsapp_session_access access
		join public.users recipient on recipient.id = access.user_id
		where access.organization_id = $1::uuid
		  and access.session_id = $2::uuid
		  and access.grant_scope in ('organization', 'team')
		order by lower(coalesce(recipient.name, '')), access.user_id
	`, tenantContext.OrganizationID, sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	accesses := []SessionAccess{}
	for rows.Next() {
		var access SessionAccess
		var grantedBy, grantScope, grantTeamID pgtype.Text
		var recipient AccessUser
		if err := rows.Scan(&access.ID, &access.SessionID, &access.UserID,
			&access.AccessMode, &access.CanView, &access.CanRead, &access.CanSend,
			&access.OnlyLeadsAccess, &grantedBy, &grantScope, &grantTeamID,
			&access.CreatedAt, &recipient.ID, &recipient.Name, &recipient.Email); err != nil {
			return nil, err
		}
		access.GrantedBy = textPtr(grantedBy)
		access.GrantScope = textPtr(grantScope)
		access.GrantTeamID = textPtr(grantTeamID)
		access.User = &recipient
		accesses = append(accesses, access)
	}
	return accesses, rows.Err()
}

func (repo Repository) GrantSessionAccess(ctx context.Context, tenantContext tenant.Context, sessionID string, input grantAccessInput) error {
	if err := requireOriginalWhatsAppOrganization(ctx, repo.db.Pool(), tenantContext); err != nil {
		return err
	}
	sessionID, ok := normalizeUUID(sessionID)
	if !ok {
		return ErrSessionNotFound
	}
	if input.UserID == tenantContext.UserID || (!input.CanView && !input.CanSend) || (input.CanSend && !input.CanView) {
		return ErrInvalidInput
	}
	var recipientEligible bool
	if err := repo.db.Pool().QueryRow(ctx, `select exists(select 1 from public.users recipient
	 join public.organization_members member on member.user_id=recipient.id and member.organization_id=$1::uuid
	 where recipient.id=$2::uuid and recipient.organization_id=$1::uuid and coalesce(recipient.is_active,false)
	 and coalesce(member.is_active,false) and member.deleted_at is null)`, tenantContext.OrganizationID, input.UserID).Scan(&recipientEligible); err != nil {
		return err
	}
	if !recipientEligible {
		return ErrInvalidReference
	}
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	// Users deletion owns actors before sessions. Use the same order, including
	// the recipient, before the resource fence and final eligibility queries.
	if err := lockWhatsAppUserMembershipRows(ctx, tx, tenantContext.OrganizationID, tenantContext.UserID, input.UserID); err != nil {
		return err
	}
	if err := requireOriginalWhatsAppOrganization(ctx, tx, tenantContext); err != nil {
		return err
	}
	// The session fence remains held through the grant write.
	var lockedSessionID string
	err = tx.QueryRow(ctx, `
		select ws.id::text
		from public.whatsapp_sessions ws
		where ws.organization_id = $1::uuid
		  and ws.id = $2::uuid
		  and ws.owner_user_id = $3::uuid
		  and ws.provider = 'evolution_go'
		  and coalesce(ws.is_active, true) = true
		  and coalesce(ws.status, '') <> 'deleted'
		for share of ws
	`, tenantContext.OrganizationID, sessionID, tenantContext.UserID).Scan(&lockedSessionID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrSessionNotFound
	}
	if err != nil {
		return err
	}

	// Resolve current database membership instead of cached permissions. A
	// normal user may have WhatsAppManage for their own connection but cannot
	// grant another person access to it.
	var ownerRole string
	err = tx.QueryRow(ctx, `
		select lower(btrim(member.role))
		from public.organization_members member
		join public.users actor on actor.id = member.user_id
		where member.organization_id = $1::uuid
		  and member.user_id = $2::uuid
		  and actor.organization_id = member.organization_id
		  and coalesce(member.is_active, false) = true
		  and member.deleted_at is null
		  and coalesce(actor.is_active, false) = true
		for share of member, actor
	`, tenantContext.OrganizationID, tenantContext.UserID).Scan(&ownerRole)
	if errors.Is(err, pgx.ErrNoRows) {
		return tenant.ErrOrganizationAccessDenied
	}
	if err != nil {
		return err
	}
	if ownerRole != "owner" && ownerRole != "admin" {
		return tenant.ErrOrganizationAccessDenied
	}
	var recipientID string
	err = tx.QueryRow(ctx, `
		select recipient.id::text
		from public.users recipient
		join public.organization_members member
		  on member.user_id = recipient.id
		where member.organization_id = $1::uuid
		  and recipient.id = $2::uuid
		  and recipient.organization_id = member.organization_id
		  and coalesce(recipient.is_active, false) = true
		  and coalesce(member.is_active, false) = true
		  and member.deleted_at is null
		for share of recipient, member
	`, tenantContext.OrganizationID, input.UserID).Scan(&recipientID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrInvalidReference
	}
	if err != nil {
		return err
	}

	grantScope := "organization"
	var grantTeamID *string

	// A repeated, identical grant must not rotate its identity and invalidate
	// already queued messages. Any change to its effective authority does.
	_, err = tx.Exec(ctx, `
		insert into public.whatsapp_session_access (
			organization_id, session_id, user_id, can_view, can_read,
			can_send, only_leads_access, access_mode, granted_by,
			grant_scope, grant_team_id
		) values (
			$1::uuid, $2::uuid, $3::uuid, $4::boolean, $4::boolean,
			$5::boolean, true, 'assigned_leads_only', $6::uuid,
			$7, $8::uuid
		)
		on conflict (session_id, user_id) do update set
			id = gen_random_uuid(),
			organization_id = excluded.organization_id,
			can_view = excluded.can_view,
			can_read = excluded.can_read,
			can_send = excluded.can_send,
			only_leads_access = true,
			access_mode = 'assigned_leads_only',
			granted_by = excluded.granted_by,
			grant_scope = excluded.grant_scope,
			grant_team_id = excluded.grant_team_id,
			created_at = now()
		where (
			whatsapp_session_access.organization_id,
			whatsapp_session_access.can_view,
			whatsapp_session_access.can_read,
			whatsapp_session_access.can_send,
			whatsapp_session_access.only_leads_access,
			whatsapp_session_access.access_mode,
			whatsapp_session_access.granted_by,
			whatsapp_session_access.grant_scope,
			whatsapp_session_access.grant_team_id
		) is distinct from (
			excluded.organization_id,
			excluded.can_view,
			excluded.can_read,
			excluded.can_send,
			excluded.only_leads_access,
			excluded.access_mode,
			excluded.granted_by,
			excluded.grant_scope,
			excluded.grant_team_id
		)
	`, tenantContext.OrganizationID, sessionID, input.UserID,
		input.CanView, input.CanSend, tenantContext.UserID, grantScope, grantTeamID)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (repo Repository) RevokeSessionAccess(ctx context.Context, tenantContext tenant.Context, sessionID string, userID string) error {
	if err := requireOriginalWhatsAppOrganization(ctx, repo.db.Pool(), tenantContext); err != nil {
		return err
	}
	sessionID, ok := normalizeUUID(sessionID)
	if !ok {
		return ErrSessionNotFound
	}
	userID, ok = normalizeUUID(userID)
	if !ok {
		return ErrInvalidInput
	}
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var lockedSessionID string
	err = tx.QueryRow(ctx, `
		select ws.id::text
		from public.whatsapp_sessions ws
		where ws.organization_id = $1::uuid
		  and ws.id = $2::uuid
		  and ws.owner_user_id = $3::uuid
		  and ws.provider = 'evolution_go'
		  and coalesce(ws.is_active, true) = true
		  and coalesce(ws.status, '') <> 'deleted'
		for update of ws
	`, tenantContext.OrganizationID, sessionID, tenantContext.UserID).Scan(&lockedSessionID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrSessionNotFound
	}
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `
		delete from public.whatsapp_session_access
		where organization_id = $1::uuid
		  and session_id = $2::uuid
		  and user_id = $3::uuid
	`, tenantContext.OrganizationID, sessionID, userID)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (repo Repository) ListConversations(ctx context.Context, tenantContext tenant.Context, filter ConversationListFilter) ([]Conversation, error) {
	conversations, _, err := repo.listConversationsPage(ctx, tenantContext, filter)
	return conversations, err
}

func (repo Repository) listConversationsPage(ctx context.Context, tenantContext tenant.Context, filter ConversationListFilter) ([]Conversation, *string, error) {
	// Keep repository callers safe even when they bypass the HTTP parser.
	if filter.Limit <= 0 {
		filter.Limit = 80
	} else if filter.Limit > 120 {
		filter.Limit = 120
	}

	includeSupervisory := canIncludeSupervisoryLeads(tenantContext, filter)
	args, where, empty, err := conversationFilterSQLWithSupervisoryRead(tenantContext, filter, includeSupervisory)
	if err != nil {
		return nil, nil, err
	}
	if empty {
		return []Conversation{}, nil, nil
	}
	if filter.CursorSet {
		args = append(args, filter.CursorCreatedAt, filter.CursorID)
		createdAtArg := len(args) - 1
		cursorIDArg := len(args)
		if filter.CursorLastMessageAt == nil {
			where = append(where, fmt.Sprintf(
				"wc.last_message_at is null and (wc.created_at, wc.id) < ($%d::timestamptz, $%d::uuid)",
				createdAtArg,
				cursorIDArg,
			))
		} else {
			args = append(args, *filter.CursorLastMessageAt)
			lastMessageAtArg := len(args)
			where = append(where, fmt.Sprintf(
				`(
					wc.last_message_at is null
					or wc.last_message_at < $%d::timestamptz
					or (
						wc.last_message_at = $%d::timestamptz
						and (wc.created_at, wc.id) < ($%d::timestamptz, $%d::uuid)
					)
				)`,
				lastMessageAtArg,
				lastMessageAtArg,
				createdAtArg,
				cursorIDArg,
			))
		}
	}
	args = append(args, filter.Limit+1)
	limitArg := len(args)

	selectFields := conversationSelectFields()
	if includeSupervisory {
		selectFields += ", not coalesce(" + operationalConversationAccessSQL() + ", false)"
	}
	rows, err := repo.db.Pool().Query(ctx, `
		select `+selectFields+`
		from public.whatsapp_conversations wc
		left join public.whatsapp_sessions ws on ws.id = wc.session_id
		left join public.leads l on l.id = wc.lead_id and l.organization_id = wc.organization_id
		left join public.pipelines pipeline on pipeline.id = l.pipeline_id
		left join public.stages stage on stage.id = l.stage_id
		where `+strings.Join(where, " and ")+`
		order by wc.last_message_at desc nulls last, wc.created_at desc, wc.id desc
		limit $`+fmt.Sprint(limitArg)+`::integer
	`, args...)
	if err != nil {
		return nil, nil, err
	}
	defer rows.Close()

	conversations := []Conversation{}
	for rows.Next() {
		conversation, err := scanConversationWithSupervisoryRead(rows, includeSupervisory)
		if err != nil {
			return nil, nil, err
		}
		conversations = append(conversations, conversation)
	}
	if err := rows.Err(); err != nil {
		return nil, nil, err
	}

	var nextCursor *string
	if len(conversations) > filter.Limit {
		conversations = conversations[:filter.Limit]
		cursor := encodeConversationCursor(conversations[len(conversations)-1])
		nextCursor = &cursor
	}

	for index := range conversations {
		if conversations[index].SupervisoryLeadView {
			conversations[index].projectSupervisoryLead()
		}
	}
	repo.hydrateConversationAvatars(ctx, tenantContext.OrganizationID, conversationAvatarPointers(conversations))
	return conversations, nextCursor, nil
}

// CountUnreadMessages returns the canonical total used by the inbox badge.
// It deliberately shares the list predicate, but does not apply pagination or
// enrich each conversation with pipeline, stage, assignee, or tag data.
func (repo Repository) CountUnreadMessages(ctx context.Context, tenantContext tenant.Context, filter ConversationListFilter) (int64, error) {
	args, where, empty, err := conversationFilterSQL(tenantContext, filter)
	if err != nil {
		return 0, err
	}
	if empty {
		return 0, nil
	}

	if !filter.PendingReply {
		where = append(where, "coalesce(wc.unread_count, 0) > 0")
	}
	var count int64
	err = repo.db.Pool().QueryRow(ctx, `
		select coalesce(sum(greatest(wc.unread_count, 0)), 0)::bigint
		from public.whatsapp_conversations wc
		left join public.whatsapp_sessions ws on ws.id = wc.session_id
		left join public.leads l on l.id = wc.lead_id and l.organization_id = wc.organization_id
		where `+strings.Join(where, " and "), args...).Scan(&count)
	return count, err
}

// ListConversationFilterOptions exposes only values represented by leads on
// conversations the caller can currently view. Session, archive and date
// scope are preserved; selected lead filters do not hide other choices.
func (repo Repository) listLegacyConversationFilterOptions(ctx context.Context, tenantContext tenant.Context, filter ConversationListFilter) (ConversationFilterOptions, error) {
	options := ConversationFilterOptions{
		Pipelines: []ConversationFilterOption{}, Teams: []ConversationFilterOption{},
		Users: []ConversationFilterOption{}, Sources: []string{},
		Tags: []ConversationFilterOption{}, Pages: []ConversationFilterOption{},
		Campaigns: []ConversationFilterOption{},
	}
	scope := ConversationListFilter{
		SessionID: filter.SessionID, SessionIDs: filter.SessionIDs,
		AccessibleProvided: filter.AccessibleProvided, HideGroups: filter.HideGroups,
		ShowArchived: filter.ShowArchived, LastMessageFrom: filter.LastMessageFrom,
		LastMessageTo: filter.LastMessageTo,
	}
	args, where, empty, err := conversationFilterSQLWithSupervisoryRead(tenantContext, scope,
		canIncludeSupervisoryLeads(tenantContext, filter))
	if err != nil || empty {
		return options, err
	}
	campaignOptionWhere := "a.campaign_id is not null"
	if pageID := strings.TrimSpace(filter.PageID); pageID != "" {
		if len(pageID) > 255 {
			return options, fmt.Errorf("%w: pageId is invalid", ErrInvalidInput)
		}
		args = append(args, pageID)
		campaignOptionWhere += fmt.Sprintf(" and a.page_id = $%d", len(args))
	}

	rows, err := repo.db.Pool().Query(ctx, `
		with visible_leads as materialized (
			select distinct l.id, l.organization_id, l.pipeline_id, l.team_id,
				l.assigned_user_id, l.source, l.meta_campaign_id, l.utm_campaign
			from public.whatsapp_conversations wc
			join public.whatsapp_sessions ws on ws.id = wc.session_id
			join public.leads l on l.id = wc.lead_id and l.organization_id = wc.organization_id
			where `+strings.Join(where, " and ")+`
		), attribution as materialized (
			select nullif(btrim(entry.page_id), '') as page_id,
				nullif(btrim(entry.page_name), '') as page_name,
				coalesce(nullif(btrim(entry.campaign_id), ''), nullif(btrim(entry.campaign_name), ''),
					nullif(btrim(entry.utm_campaign), '')) as campaign_id,
				coalesce(nullif(btrim(entry.campaign_name), ''), nullif(btrim(entry.utm_campaign), ''),
					nullif(btrim(entry.campaign_id), '')) as campaign_name
			from visible_leads l
			join public.lead_entry_events entry on entry.organization_id = l.organization_id
				and entry.lead_id = l.id and entry.is_countable = true
			union all
			select nullif(btrim(lm.page_id), ''), null,
				coalesce(nullif(btrim(lm.campaign_id), ''), nullif(btrim(lm.campaign_name), '')),
				coalesce(nullif(btrim(lm.campaign_name), ''), nullif(btrim(lm.campaign_id), ''))
			from visible_leads l
			join public.lead_meta lm on lm.organization_id = l.organization_id and lm.lead_id = l.id
			union all
			select null, null,
				coalesce(nullif(btrim(l.meta_campaign_id), ''), nullif(btrim(l.utm_campaign), '')),
				coalesce(nullif(btrim(l.utm_campaign), ''), nullif(btrim(l.meta_campaign_id), ''))
			from visible_leads l
		)
		select kind, id, min(name) as name from (
			(select distinct 'pipeline'::text as kind, p.id::text as id, p.name::text as name
			 from visible_leads l join public.pipelines p on p.id = l.pipeline_id and p.organization_id = l.organization_id
			 order by name, id limit 300)
			union all
			(select distinct 'team'::text, team.id::text, team.name::text
			 from visible_leads l
			 join public.team_members tm on tm.organization_id = l.organization_id
				and tm.user_id = l.assigned_user_id and coalesce(tm.is_active, true) = true
			 join public.teams team on team.id = tm.team_id and team.organization_id = tm.organization_id
				and team.is_active = true
			 join public.users member on member.id = tm.user_id and coalesce(member.is_active, false) = true
			 join public.organization_members membership on membership.organization_id = tm.organization_id
				and membership.user_id = tm.user_id and coalesce(membership.is_active, false) = true
				and membership.deleted_at is null
				and membership.membership_generation = tm.membership_generation
			 order by 3, 2 limit 300)
			union all
			(select distinct 'team'::text, team.id::text, team.name::text
			 from visible_leads l
			 join public.teams team on team.id = l.team_id and team.organization_id = l.organization_id
				and team.is_active = true
			 where l.assigned_user_id is null
			 order by 3, 2 limit 300)
			union all
			(select distinct 'user'::text, member.id::text, member.name::text
			 from visible_leads l join public.users member on member.id = l.assigned_user_id
				and coalesce(member.is_active, false) = true
			 join public.organization_members membership on membership.organization_id = l.organization_id
				and membership.user_id = member.id and coalesce(membership.is_active, false) = true
				and membership.deleted_at is null
			 order by 3, 2 limit 300)
			union all
			(select distinct 'source'::text, btrim(l.source), btrim(l.source)
			 from visible_leads l where nullif(btrim(l.source), '') is not null
			 order by 2, 3 limit 300)
			union all
			(select distinct 'tag'::text, tag.id::text, tag.name::text
			 from visible_leads l
			 join public.lead_tags lt on lt.organization_id = l.organization_id and lt.lead_id = l.id
			 join public.tags tag on tag.id = lt.tag_id and tag.organization_id = lt.organization_id
			 order by 3, 2 limit 300)
			union all
			(select 'page'::text, a.page_id, min(coalesce(a.page_name, a.page_id))
			 from attribution a where a.page_id is not null
			 group by a.page_id order by 3, 2 limit 500)
			union all
			(select 'campaign'::text, a.campaign_id, min(coalesce(a.campaign_name, a.campaign_id))
			 from attribution a where `+campaignOptionWhere+`
			 group by a.campaign_id order by 3, 2 limit 500)
		) scoped_options
		group by kind, id
		order by kind, name, id
	`, args...)
	if err != nil {
		return options, err
	}
	defer rows.Close()
	for rows.Next() {
		var kind, id, name string
		if err := rows.Scan(&kind, &id, &name); err != nil {
			return options, err
		}
		value := ConversationFilterOption{ID: id, Name: name}
		switch kind {
		case "pipeline":
			options.Pipelines = append(options.Pipelines, value)
		case "team":
			options.Teams = append(options.Teams, value)
		case "user":
			options.Users = append(options.Users, value)
		case "source":
			options.Sources = append(options.Sources, id)
		case "tag":
			options.Tags = append(options.Tags, value)
		case "page":
			options.Pages = append(options.Pages, value)
		case "campaign":
			options.Campaigns = append(options.Campaigns, value)
		}
	}
	return options, rows.Err()
}

// conversationFilterSQL is the single source of truth for list and unread
// count visibility. The explicit empty session scope is fail-closed so a
// client that has not resolved an allowed session never falls back to "all".
func conversationFilterSQL(tenantContext tenant.Context, filter ConversationListFilter) ([]any, []string, bool, error) {
	return conversationFilterSQLWithSupervisoryRead(tenantContext, filter, false)
}

func conversationFilterSQLWithSupervisoryRead(tenantContext tenant.Context, filter ConversationListFilter, includeSupervisory bool) ([]any, []string, bool, error) {
	if !validConversationFilterText(filter.Search, 180) || !validConversationFilterText(filter.LeadSource, maxLeadSourceFilterLength) {
		return nil, nil, false, ErrInvalidInput
	}
	if filter.AccessibleProvided && len(filter.SessionIDs) == 0 {
		return nil, nil, true, nil
	}
	if filter.WithoutLead && conversationHasLeadFilters(filter) {
		return nil, nil, true, nil
	}

	args := baseConversationArgs(tenantContext)
	visibility := operationalConversationVisibilitySQL(canViewOwnWhatsAppLeads(tenantContext))
	if includeSupervisory {
		args = append(args, strings.ToLower(strings.TrimSpace(tenantContext.MemberRole)))
		rolePlaceholder := fmt.Sprintf("$%d", len(args))
		visibility = conversationVisibilitySQL(canViewOwnWhatsAppLeads(tenantContext)) + " and (" +
			operationalConversationAccessSQL() + " or " + supervisoryLeadVisibilitySQL(tenantContext, rolePlaceholder) + ")"
	}
	where := []string{
		"wc.organization_id = $1::uuid",
		"wc.deleted_at is null",
		visibility,
	}
	if !filter.WithoutLead {
		// Cards fantasmas: uma conversa sem lead so entra na caixa principal
		// quando tem ao menos uma mensagem visivel ali (regra de 12/11:
		// conversas sem lead convivem com as de lead, como um WhatsApp
		// normal). Linhas suprimidas nao contam. O filtro "Sem lead" usa
		// withoutLead=1 e nao passa por este corte.
		where = append(where, conversationMainListContentSQL())
	}

	addFilter := func(clause string, value any) {
		args = append(args, value)
		where = append(where, fmt.Sprintf(clause, len(args)))
	}

	if strings.TrimSpace(filter.SessionID) != "" {
		sessionID, ok := normalizeUUID(filter.SessionID)
		if !ok {
			return nil, nil, false, fmt.Errorf("%w: sessionId is invalid", ErrInvalidInput)
		}
		addFilter("wc.session_id = $%d::uuid", sessionID)
	}
	if len(filter.SessionIDs) > 0 {
		placeholders := make([]string, 0, len(filter.SessionIDs))
		seenSessionIDs := make(map[string]bool, len(filter.SessionIDs))
		for _, sessionID := range filter.SessionIDs {
			normalized, ok := normalizeUUID(sessionID)
			if !ok {
				if strings.TrimSpace(sessionID) == "" {
					continue
				}
				return nil, nil, false, fmt.Errorf("%w: sessionIds contains invalid uuid", ErrInvalidInput)
			}
			if seenSessionIDs[normalized] {
				continue
			}
			seenSessionIDs[normalized] = true
			args = append(args, normalized)
			placeholders = append(placeholders, fmt.Sprintf("$%d::uuid", len(args)))
		}
		if len(placeholders) == 0 {
			return nil, nil, true, nil
		}
		where = append(where, "wc.session_id in ("+strings.Join(placeholders, ", ")+")")
	}
	if filter.LastMessageFrom != nil {
		addFilter("wc.last_message_at >= $%d::timestamptz", *filter.LastMessageFrom)
	}
	if filter.LastMessageTo != nil {
		addFilter("wc.last_message_at <= $%d::timestamptz", *filter.LastMessageTo)
	}
	if filter.LeadCreatedFrom != nil {
		addFilter("l.created_at >= $%d::timestamptz", *filter.LeadCreatedFrom)
	}
	if filter.LeadCreatedTo != nil {
		addFilter("l.created_at <= $%d::timestamptz", *filter.LeadCreatedTo)
	}
	if source := strings.TrimSpace(filter.LeadSource); source != "" {
		addFilter("(l.organization_id = wc.organization_id and l.source = $%d)", source)
	}
	for _, item := range []struct {
		name   string
		value  string
		column string
	}{
		{"pipelineId", filter.PipelineID, "l.pipeline_id"},
		{"teamId", filter.TeamID, "l.team_id"},
	} {
		if strings.TrimSpace(item.value) == "" {
			continue
		}
		value, ok := normalizeUUID(item.value)
		if !ok {
			return nil, nil, false, fmt.Errorf("%w: %s is invalid", ErrInvalidInput, item.name)
		}
		if item.name == "teamId" {
			// Match the Contacts/Dashboard current-assignee team semantics.
			// An unassigned lead retains its recorded queue team.
			if filter.UserID == "unassigned" {
				addFilter("l.team_id = $%d::uuid", value)
			} else {
				addFilter(`exists (
					select 1 from public.team_members tm
					join public.teams team on team.id = tm.team_id and team.organization_id = tm.organization_id and team.is_active = true
					join public.users member on member.id = tm.user_id and coalesce(member.is_active, false) = true
					join public.organization_members membership on membership.organization_id = tm.organization_id
						and membership.user_id = tm.user_id and coalesce(membership.is_active, false) = true
						and membership.deleted_at is null
						and membership.membership_generation = tm.membership_generation
					where tm.organization_id = wc.organization_id and tm.team_id = $%d::uuid
						and tm.user_id = l.assigned_user_id and coalesce(tm.is_active, true) = true
				)`, value)
			}
		} else {
			addFilter(item.column+" = $%d::uuid", value)
		}
	}
	if userID := strings.TrimSpace(filter.UserID); userID != "" {
		if userID == "unassigned" {
			where = append(where, "l.assigned_user_id is null")
		} else {
			value, ok := normalizeUUID(userID)
			if !ok {
				return nil, nil, false, fmt.Errorf("%w: userId is invalid", ErrInvalidInput)
			}
			addFilter("l.assigned_user_id = $%d::uuid", value)
		}
	}
	if len(filter.TagIDs) > 0 {
		ids, err := normalizedConversationUUIDs(filter.TagIDs, 50, "tagIds")
		if err != nil {
			return nil, nil, false, err
		}
		addFilter(`exists (
			select 1 from public.lead_tags lt
			where lt.organization_id = wc.organization_id and lt.lead_id = l.id
				and lt.tag_id = any($%d::uuid[])
		)`, ids)
	}
	if status := strings.TrimSpace(filter.DealStatus); status != "" {
		if status != "open" && status != "won" && status != "lost" {
			return nil, nil, false, fmt.Errorf("%w: dealStatus is invalid", ErrInvalidInput)
		}
		addFilter("l.deal_status = $%d", status)
	}
	if err := appendConversationAttributionFilter(&args, &where, filter); err != nil {
		return nil, nil, false, err
	}
	if filter.HideGroups {
		where = append(where, "wc.is_group = false")
	}
	if filter.OnlyLeads {
		where = append(where, "wc.lead_id is not null")
	}
	if filter.WithoutLead {
		where = append(where, "wc.lead_id is null")
	}
	if filter.PendingReply {
		where = append(where, conversationPendingReplySQL())
	}
	search := strings.TrimSpace(filter.Search)
	if search == "" && filter.ShowArchived {
		where = append(where, "wc.archived_at is not null")
	} else if search == "" {
		where = append(where, "wc.archived_at is null")
	}
	if search != "" {
		args = append(args, searchtext.Pattern(search))
		textArg := len(args)
		searchClauses := []string{searchtext.AnySQL(
			[]string{"wc.contact_name", "l.name", "(" + conversationListPreviewSQL() + ")::jsonb->>'preview'"},
			fmt.Sprintf("$%d", textArg),
		)}
		if digits := searchtext.PhoneDigits(search); digits != "" {
			args = append(args, "%"+digits+"%")
			phoneArg := len(args)
			searchClauses = append(searchClauses, fmt.Sprintf(`(
				regexp_replace(coalesce(wc.contact_phone, ''), '\D', '', 'g') like $%d
				or case
					when wc.contact_phone is null
						and lower(wc.remote_jid) ~ '^[1-9][0-9]{7,14}(:[0-9]+)?@(s[.]whatsapp[.]net|c[.]us)$'
					then split_part(split_part(wc.remote_jid, '@', 1), ':', 1) like $%d
					else false
				end
			)`, phoneArg, phoneArg))
		}
		where = append(where, "("+strings.Join(searchClauses, " or ")+")")
	}

	return args, where, false, nil
}

func normalizedConversationUUIDs(values []string, maxItems int, field string) ([]string, error) {
	if len(values) > maxItems {
		return nil, fmt.Errorf("%w: %s contains too many values", ErrInvalidInput, field)
	}
	result := make([]string, 0, len(values))
	for _, raw := range values {
		value, ok := normalizeUUID(strings.TrimSpace(raw))
		if !ok {
			return nil, fmt.Errorf("%w: %s contains invalid uuid", ErrInvalidInput, field)
		}
		result = append(result, value)
	}
	return uniqueConversationFilterValues(result), nil
}

// Page and campaign must describe one historical entry, or one legacy
// lead_meta row. Never satisfy them from separate arrivals on the same lead.
func appendConversationAttributionFilter(args *[]any, where *[]string, filter ConversationListFilter) error {
	page := strings.TrimSpace(filter.PageID)
	if !validConversationFilterText(page, 255) {
		return fmt.Errorf("%w: pageId is invalid", ErrInvalidInput)
	}
	campaigns := make([]string, 0, len(filter.CampaignIDs))
	for _, raw := range filter.CampaignIDs {
		value := strings.TrimSpace(raw)
		if value == "" {
			continue
		}
		if !validConversationFilterText(value, 255) {
			return fmt.Errorf("%w: campaignIds contains oversized value", ErrInvalidInput)
		}
		campaigns = append(campaigns, value)
	}
	campaigns = uniqueConversationFilterValues(campaigns)
	if len(campaigns) > 50 {
		return fmt.Errorf("%w: campaignIds contains too many values", ErrInvalidInput)
	}
	if page == "" && len(campaigns) == 0 && filter.AdSetID == "" && filter.AdID == "" {
		return nil
	}
	pageClause := ""
	if page != "" {
		*args = append(*args, page)
		pageClause = fmt.Sprintf(" and btrim(%%s.page_id) = $%d", len(*args))
	}
	campaignClause := ""
	if len(campaigns) > 0 {
		*args = append(*args, campaigns)
		index := len(*args)
		campaignClause = fmt.Sprintf(" and (btrim(%%s.campaign_id) = any($%d::text[]) or btrim(%%s.campaign_name) = any($%d::text[])%%s)", index, index)
	}
	eventCondition := "entry.organization_id = wc.organization_id and entry.lead_id = l.id and entry.is_countable = true"
	legacyCondition := "lm.organization_id = wc.organization_id and lm.lead_id = l.id"
	leadConditions := []string{}
	if pageClause != "" {
		eventCondition += fmt.Sprintf(pageClause, "entry")
		legacyCondition += fmt.Sprintf(pageClause, "lm")
	}
	if campaignClause != "" {
		index := len(*args)
		eventCondition += fmt.Sprintf(campaignClause, "entry", "entry", fmt.Sprintf(" or btrim(entry.utm_campaign) = any($%d::text[])", index))
		legacyCondition += fmt.Sprintf(campaignClause, "lm", "lm", "")
		leadConditions = append(leadConditions, fmt.Sprintf("(btrim(l.meta_campaign_id) = any($%d::text[]) or btrim(l.utm_campaign) = any($%d::text[]))", index, index))
	}
	for _, field := range []struct{ value, idColumn, nameColumn string }{
		{filter.AdSetID, "adset_id", "adset_name"}, {filter.AdID, "ad_id", "ad_name"},
	} {
		value := strings.TrimSpace(field.value)
		if value == "" {
			continue
		}
		if !validConversationFilterText(value, 255) {
			return fmt.Errorf("%w: attribution value is invalid", ErrInvalidInput)
		}
		*args = append(*args, value)
		index := len(*args)
		eventCondition += fmt.Sprintf(" and (btrim(entry.%s) = $%d or btrim(entry.%s) = $%d)", field.idColumn, index, field.nameColumn, index)
		legacyCondition += fmt.Sprintf(" and (btrim(lm.%s) = $%d or btrim(lm.%s) = $%d)", field.idColumn, index, field.nameColumn, index)
		leadConditions = append(leadConditions, fmt.Sprintf("btrim(l.meta_%s) = $%d", field.idColumn, index))
	}
	legacy := fmt.Sprintf("exists (select 1 from public.lead_meta lm where %s)", legacyCondition)
	if page == "" && len(leadConditions) > 0 {
		// Every selected dimension must match this one first-touch projection.
		legacy = fmt.Sprintf("((%s) or %s)", strings.Join(leadConditions, " and "), legacy)
	}
	*where = append(*where, fmt.Sprintf(`(l.organization_id = wc.organization_id and (
		exists (select 1 from public.lead_entry_events entry where %s)
		or %s
	))`, eventCondition, legacy))
	return nil
}

func encodeConversationCursor(conversation Conversation) string {
	lastMessageAt := "-"
	if conversation.LastMessageAt != nil {
		lastMessageAt = conversation.LastMessageAt.UTC().Format(time.RFC3339Nano)
	}
	return strings.Join([]string{
		"v1",
		lastMessageAt,
		conversation.CreatedAt.UTC().Format(time.RFC3339Nano),
		conversation.ID,
	}, "|")
}

func onlyDigits(value string) string {
	var builder strings.Builder
	for _, char := range value {
		if char >= '0' && char <= '9' {
			builder.WriteRune(char)
		}
	}
	return builder.String()
}

func (repo Repository) GetConversation(ctx context.Context, tenantContext tenant.Context, conversationID string) (Conversation, error) {
	return repo.GetConversationSnapshot(ctx, tenantContext, conversationID)
}

// GetConversationSnapshot returns the current persisted card binding. Browser
// deep links use this read only to pin the subsequent detail request to the
// same lead (or to "unlinked").
func (repo Repository) GetConversationSnapshot(ctx context.Context, tenantContext tenant.Context, conversationID string) (Conversation, error) {
	conversationID, ok := normalizeUUID(conversationID)
	if !ok {
		return Conversation{}, ErrConversationNotFound
	}

	args := append(baseConversationArgs(tenantContext), conversationID)
	conversation, err := scanConversation(repo.db.Pool().QueryRow(ctx, `
		select `+conversationSelectFields()+`
		from public.whatsapp_conversations wc
		left join public.whatsapp_sessions ws on ws.id = wc.session_id
		left join public.leads l on l.id = wc.lead_id and l.organization_id = wc.organization_id
		left join public.pipelines pipeline on pipeline.id = l.pipeline_id
		left join public.stages stage on stage.id = l.stage_id
		where wc.organization_id = $1::uuid
		  and wc.deleted_at is null
		  and `+conversationVisibilitySQL(canViewOwnWhatsAppLeads(tenantContext))+`
		  and wc.id = $5::uuid
		limit 1
	`, args...))
	if errors.Is(err, pgx.ErrNoRows) {
		return Conversation{}, ErrConversationNotFound
	}
	if err != nil {
		return Conversation{}, err
	}
	return conversation, nil
}

// GetConversationForExpectedLead returns no row when a browser still carries
// an older card snapshot. Neither this nor GetConversation mutates a binding.
func (repo Repository) GetConversationForExpectedLead(ctx context.Context, tenantContext tenant.Context, conversationID string, expectedLeadID string) (Conversation, error) {
	conversationID, ok := normalizeUUID(conversationID)
	if !ok {
		return Conversation{}, ErrConversationNotFound
	}
	expectedLeadID, err := validateExpectedConversationLeadSnapshot(expectedLeadID)
	if err != nil {
		return Conversation{}, err
	}

	args := append(baseConversationArgs(tenantContext), conversationID)
	expectedLeadPredicate := "wc.lead_id is null"
	if expectedLeadID != unlinkedConversationLeadSnapshot {
		args = append(args, expectedLeadID)
		expectedLeadPredicate = fmt.Sprintf("wc.lead_id = $%d::uuid", len(args))
	}
	conversation, err := scanConversation(repo.db.Pool().QueryRow(ctx, `
		select `+conversationSelectFields()+`
		from public.whatsapp_conversations wc
		left join public.whatsapp_sessions ws on ws.id = wc.session_id
		left join public.leads l on l.id = wc.lead_id and l.organization_id = wc.organization_id
		left join public.pipelines pipeline on pipeline.id = l.pipeline_id
		left join public.stages stage on stage.id = l.stage_id
		where wc.organization_id = $1::uuid
		  and wc.deleted_at is null
		  and `+conversationVisibilitySQL(canViewOwnWhatsAppLeads(tenantContext))+`
		  and wc.id = $5::uuid
		  and `+expectedLeadPredicate+`
		limit 1
	`, args...))
	if errors.Is(err, pgx.ErrNoRows) {
		return Conversation{}, ErrConversationNotFound
	}
	if err != nil {
		return Conversation{}, err
	}
	return conversation, nil
}

func (repo Repository) ListMessages(ctx context.Context, tenantContext tenant.Context, conversationID string, filter MessageFilter) (MessagePage, error) {
	conversationID, ok := normalizeUUID(conversationID)
	if !ok {
		return MessagePage{}, ErrConversationNotFound
	}
	if filter.ExpectedLeadID != "" {
		normalizedExpectedLeadID, err := validateExpectedConversationLeadSnapshot(filter.ExpectedLeadID)
		if err != nil {
			return MessagePage{}, err
		}
		filter.ExpectedLeadID = normalizedExpectedLeadID
	}
	if err := repo.ensureCanViewConversationForLead(ctx, tenantContext, conversationID, filter.ExpectedLeadID); err != nil {
		return MessagePage{}, err
	}

	args := append(baseConversationArgs(tenantContext), conversationID, filter.Limit)
	where := []string{
		"wm.organization_id = $1::uuid",
		"wm.conversation_id = $5::uuid",
		"wm.capture_state is distinct from 'suppressed'",
		"wc.deleted_at is null",
		conversationVisibilitySQL(canViewOwnWhatsAppLeads(tenantContext)),
		conversationMessageLeadMatchSQL(),
	}
	if filter.ExpectedLeadID != "" {
		// Repeat the active-card guard in the message statement. If a binding
		// changes after the authorization check, this request returns no rows
		// instead of leaking the newly active card into the stale UI cache.
		if filter.ExpectedLeadID == unlinkedConversationLeadSnapshot {
			where = append(where, "wc.lead_id is null")
		} else {
			args = append(args, filter.ExpectedLeadID)
			where = append(where, fmt.Sprintf("wc.lead_id = $%d::uuid", len(args)))
		}
	}
	fromSQL := `
		from public.whatsapp_messages wm
		join public.whatsapp_conversations wc
		  on wc.id = wm.conversation_id
		 and wc.organization_id = wm.organization_id
		left join public.whatsapp_sessions ws
		  on ws.id = wc.session_id
		 and ws.organization_id = wc.organization_id
		left join public.leads l
		  on l.id = wc.lead_id
		 and l.organization_id = wc.organization_id`
	orderSequenceSQL := "0::bigint"
	if filter.OrderingVersion == 2 {
		orderSequenceSQL = messageIngressOrderSQL()
	}
	if filter.OrderingVersion == 2 {
		if err := repo.appendCanonicalMessageCursor(ctx, &args, &where, fromSQL, filter); err != nil {
			return MessagePage{}, err
		}
	} else if filter.CursorAt != nil {
		args = append(args, *filter.CursorAt)
		cursorAtArg := len(args)
		if filter.CursorID != "" {
			args = append(args, filter.CursorID)
			where = append(where, fmt.Sprintf(
				"(coalesce(wm.sent_at, wm.created_at), wm.id) < ($%d::timestamptz, $%d::uuid)",
				cursorAtArg,
				len(args),
			))
		} else {
			// Backwards compatibility for clients that still hold the former
			// timestamp-only cursor. New responses always include the UUID tie-breaker.
			where = append(where, fmt.Sprintf("coalesce(wm.sent_at, wm.created_at) < $%d::timestamptz", cursorAtArg))
		}
	}

	rows, err := repo.db.Pool().Query(ctx, `
		select `+messageSelectFieldsWithCapabilities("wc.session_id", orderSequenceSQL, operationalMessageTargetSQL(tenantContext))+fromSQL+`
		where `+strings.Join(where, " and ")+`
		order by `+messageOrderSQL(filter)+`
		limit $6::integer
	`, args...)
	if err != nil {
		return MessagePage{}, err
	}
	defer rows.Close()

	descMessages := []Message{}
	for rows.Next() {
		message, err := scanMessage(rows)
		if err != nil {
			return MessagePage{}, err
		}
		descMessages = append(descMessages, message)
	}
	if err := rows.Err(); err != nil {
		return MessagePage{}, err
	}

	var nextCursor *string
	if len(descMessages) == filter.Limit {
		oldest := descMessages[len(descMessages)-1]
		value := messageCursor(oldest, filter)
		nextCursor = &value
	}

	messages := make([]Message, 0, len(descMessages))
	for index := len(descMessages) - 1; index >= 0; index-- {
		messages = append(messages, descMessages[index])
	}
	if filter.IncludeMediaURLs {
		if err := repo.hydrateMessageMediaURLs(ctx, tenantContext.OrganizationID, messages, tenantContext); err != nil {
			return MessagePage{}, err
		}
	}

	return MessagePage{Messages: messages, NextCursor: nextCursor}, nil
}

func (repo Repository) MarkConversationAsRead(ctx context.Context, tenantContext tenant.Context, conversationID string, expectedLeadID string) error {
	return repo.mutateConversationInbox(ctx, tenantContext, conversationID, expectedLeadID, true, false)
}

func (repo Repository) ArchiveConversation(ctx context.Context, tenantContext tenant.Context, conversationID string, archive bool, expectedLeadID string) error {
	return repo.mutateConversationInbox(ctx, tenantContext, conversationID, expectedLeadID, false, archive)
}

func (repo Repository) DeleteConversation(ctx context.Context, tenantContext tenant.Context, conversationID string, expectedLeadID string) error {
	// Hide only an operational inbox route. Canonical lead history is retained.
	return repo.mutateConversationInbox(ctx, tenantContext, conversationID, expectedLeadID, false, false, true)
}

func (repo Repository) LinkConversationToLead(
	ctx context.Context,
	tenantContext tenant.Context,
	conversationID string,
	leadID string,
	expectedPreviousLeadID string,
	resultOut ...*ConversationLeadLinkResult,
) error {
	return repo.linkConversationToLeadWithOwnSession(ctx, tenantContext, conversationID, leadID, expectedPreviousLeadID, "", false, false, resultOut...)
}

// Public linking keeps its existing scope. A personal start also pins the
// selected session's owner before acquiring its conversation and lead locks.
func (repo Repository) linkConversationToLeadWithOwnSession(
	ctx context.Context,
	tenantContext tenant.Context,
	conversationID string,
	leadID string,
	expectedPreviousLeadID string,
	ownSessionID string,
	futureOnly bool,
	startAttendance bool,
	resultOut ...*ConversationLeadLinkResult,
) error {
	if err := requireOriginalWhatsAppOrganization(ctx, repo.db.Pool(), tenantContext); err != nil {
		return err
	}
	conversationID, ok := normalizeUUID(conversationID)
	if !ok {
		return ErrConversationNotFound
	}
	leadID, ok = normalizeUUID(leadID)
	if !ok {
		return ErrInvalidReference
	}
	expectedPreviousLeadID, err := validateExpectedPreviousConversationLeadID(expectedPreviousLeadID)
	if err != nil {
		return err
	}
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if futureOnly || startAttendance {
		if err := lockOriginalWhatsAppActor(ctx, tx, tenantContext); err != nil {
			return err
		}
	}
	if ownSessionID != "" {
		if err := lockConversationSendSession(ctx, tx, tenantContext, ownSessionID); err != nil {
			return err
		}
		if err := revalidateOwnStartSession(ctx, tx, tenantContext, ownSessionID, true); err != nil {
			return err
		}
	}

	// General linking keeps the organization-scoped conversation lock. The
	// optional third argument also pins a personal start to its selected session.
	lockArgs := []any{tenantContext.OrganizationID, conversationID}
	lockArgs = append(lockArgs, ownSessionID)
	var remoteJID, contactPhone string
	var isGroup bool
	var currentLeadID, sessionOwnerID pgtype.Text
	var unlinkedRetentionV1 bool
	var retiredAt pgtype.Timestamptz
	err = tx.QueryRow(ctx, `
		select
		  wc.remote_jid,
		  coalesce(wc.contact_phone, ''),
		  coalesce(wc.is_group, false),
		  wc.lead_id::text,
		  ws.owner_user_id::text,
		  wc.unlinked_retention_v1,
		  wc.retired_at
		from public.whatsapp_conversations wc
		join public.whatsapp_sessions ws
		  on ws.id = wc.session_id
		 and ws.organization_id = wc.organization_id
		where wc.organization_id = $1::uuid
		  and wc.id = $2::uuid
		  and (nullif($3, '')::uuid is null or wc.session_id = nullif($3, '')::uuid)
		  and wc.deleted_at is null
		  and (
		    `+conversationRetentionVisibilitySQL()+`
		    or (
		      wc.unlinked_retention_v1
		      and wc.lead_id is null
		      and wc.retired_at is not null
		      and wc.unlinked_retention_scrubbed_at is null
		      and wc.created_at > now() - interval '7 days'
		    )
		  )
		  and ws.provider = 'evolution_go'
		  and coalesce(ws.is_active, true) = true
		  and coalesce(ws.status, '') <> 'deleted'
		for update of wc
	`, lockArgs...).Scan(&remoteJID, &contactPhone, &isGroup, &currentLeadID, &sessionOwnerID, &unlinkedRetentionV1, &retiredAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrConversationNotFound
	}
	if err != nil {
		return err
	}

	if currentLeadID.Valid {
		visibilityArgs := append(baseConversationArgs(tenantContext), currentLeadID.String)
		var currentLeadVisible bool
		err = tx.QueryRow(ctx, `
				select true
				from public.leads as l
				where l.organization_id = $1::uuid
				  and l.id = $5::uuid
				  and `+leadVisibilitySQL(canViewOwnWhatsAppLeads(tenantContext))+`
				for share of l
		`, visibilityArgs...).Scan(&currentLeadVisible)
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrConversationNotFound
		}
		if err != nil {
			return err
		}
		if !currentLeadVisible {
			return ErrConversationNotFound
		}
	} else if !sessionOwnerID.Valid || sessionOwnerID.String != tenantContext.UserID {
		// A null lead has no assignment/team grant to inherit. Even an admin
		// must own the physical session before attaching its private history.
		return ErrConversationNotFound
	}
	if isGroup {
		return ErrInvalidReference
	}
	if !futureOnly && !currentLeadID.Valid && !unlinkedRetentionV1 {
		// A legacy null lead may have belonged to another card. A new binding
		// requires explicit consent to keep all earlier history out of it.
		return ErrInvalidReference
	}
	if (currentLeadID.Valid && currentLeadID.String != expectedPreviousLeadID) ||
		(!currentLeadID.Valid && expectedPreviousLeadID != unlinkedConversationLeadSnapshot) {
		return ErrConversationBindingChanged
	}
	identity := newWhatsAppContactIdentity(contactPhone, remoteJID, isGroup)
	if futureOnly {
		if ownSessionID == "" || currentLeadID.Valid || unlinkedRetentionV1 || retiredAt.Valid {
			return ErrConversationBindingChanged
		}
		if err := requireOriginalWhatsAppOrganization(ctx, tx, tenantContext); err != nil {
			return err
		}
		if identity.IsGroup || identity.PNConflict || identity.ContactPhone == "" {
			return ErrInvalidReference
		}
		eligible, err := whatsappbinding.CanLinkLegacyForFuture(ctx, tx, tenantContext.OrganizationID, conversationID)
		if err != nil {
			return err
		}
		if !eligible {
			return ErrConversationBindingChanged
		}
	}

	if err := ensureAccessibleLeadMatchesIdentity(ctx, tx, tenantContext, leadID, identity); err != nil {
		return fmt.Errorf("%w: a conversa e o lead possuem telefones diferentes", err)
	}

	result := ConversationLeadLinkResult{BindingMode: "active"}
	if unlinkedRetentionV1 && !currentLeadID.Valid {
		result, err = confirmUnlinkedHistoryBinding(ctx, tx, tenantContext.OrganizationID, conversationID, leadID, tenantContext.UserID, "manual_link")
		if err != nil {
			return err
		}
	} else {
		if retiredAt.Valid {
			return ErrConversationBindingChanged
		}
		if _, err := activateRepositoryWhatsAppConversationLeadBindingIfExpected(
			ctx,
			tx,
			tenantContext.OrganizationID,
			conversationID,
			leadID,
			expectedPreviousLeadID,
		); err != nil {
			return err
		}
	}
	if startAttendance {
		if err := startAssignedOwnerAttendance(ctx, tx, tenantContext, conversationID, ownSessionID, leadID); err != nil {
			return err
		}
	} else if futureOnly {
		if _, err := whatsappbinding.StartAssignedOwnerAttendance(ctx, tx, tenantContext, conversationID, ownSessionID, leadID); err != nil {
			return err
		}
	}
	if err := tx.Commit(ctx); err != nil {
		return err
	}
	if len(resultOut) > 0 && resultOut[0] != nil {
		*resultOut[0] = result
	}
	return nil
}

func (repo Repository) GetMessageMediaURL(ctx context.Context, tenantContext tenant.Context, messageID string) (MessageMediaURL, error) {
	messageID, ok := normalizeUUID(messageID)
	if !ok {
		return MessageMediaURL{}, ErrMessageNotFound
	}
	scope, err := loadMessageMediaReadScope(ctx, repo.db.Pool(), tenantContext, messageID, true)
	if err != nil {
		return MessageMediaURL{}, err
	}
	if scope.Path == "" {
		return MessageMediaURL{}, ErrMessageNotFound
	}
	signedURL, expiresIn, err := repo.signedWhatsAppMessageMediaURLWithTTL(ctx, tenantContext.OrganizationID, scope.Path)
	if err != nil {
		return MessageMediaURL{}, err
	}
	if signedURL == "" {
		return MessageMediaURL{}, ErrMessageNotFound
	}
	// Storage I/O and cache hits never keep DB locks. The current immutable
	// attribution/path is checked again before returning any capability.
	if err := revalidateMessageMediaReadScope(ctx, repo.db.Pool(), tenantContext, scope, true); err != nil {
		return MessageMediaURL{}, err
	}
	return MessageMediaURL{MessageID: messageID, URL: signedURL, ExpiresIn: expiresIn}, nil
}

func (repo Repository) signedWhatsAppMessageMediaURL(ctx context.Context, organizationID string, objectPath string) (string, error) {
	signedURL, _, err := repo.signedWhatsAppMessageMediaURLWithTTL(ctx, organizationID, objectPath)
	return signedURL, err
}

func (repo Repository) signedWhatsAppMessageMediaURLWithTTL(ctx context.Context, organizationID string, objectPath string) (string, int, error) {
	objectPath = strings.TrimSpace(objectPath)
	if objectPath == "" || !whatsappMediaPathBelongsToOrganization(objectPath, organizationID) {
		return "", 0, ErrMessageNotFound
	}

	entry, ok := whatsappMediaSignedURLCache.Load(objectPath)
	if !ok || entry.url == "" {
		key := whatsAppMediaSigningKey{
			organizationID: organizationID, objectPath: objectPath, bucket: whatsappMediaBucket,
			origin: repo.storage.projectURL, client: repo.storage.httpClient,
		}
		var err error
		entry, err = whatsappMediaSigningFlights.Do(ctx, key, func(signCtx context.Context) (cachedWhatsAppMediaSignedURL, error) {
			// A previous flight may have populated the cache between the initial
			// miss and registering this flight. Preserve the original cache key.
			if cached, exists := whatsappMediaSignedURLCache.Load(objectPath); exists && cached.url != "" {
				return cached, nil
			}
			signedURL, err := repo.storage.signedURL(signCtx, whatsappMediaBucket, objectPath, whatsappMediaSignedURLTTLSeconds)
			if err != nil || signedURL == "" {
				return cachedWhatsAppMediaSignedURL{}, err
			}
			cacheTTL := time.Duration(whatsappMediaSignedURLTTLSeconds)*time.Second - whatsappMediaSignedURLCacheSkew
			if cacheTTL <= 0 {
				cacheTTL = time.Duration(whatsappMediaSignedURLTTLSeconds) * time.Second
			}
			return cachedWhatsAppMediaSignedURL{url: signedURL, expiresAt: time.Now().Add(cacheTTL)}, nil
		}, func(signed cachedWhatsAppMediaSignedURL) {
			whatsappMediaSignedURLCache.Store(objectPath, signed)
		})
		if err != nil {
			return "", 0, err
		}
	}
	if entry.url == "" {
		return "", 0, nil
	}
	remaining := int(time.Until(entry.expiresAt) / time.Second)
	if remaining < 1 {
		remaining = 1
	}
	return entry.url, remaining, nil
}

func (repo Repository) hydrateMessageMediaURLs(ctx context.Context, organizationID string, messages []Message, actors ...tenant.Context) error {
	type pendingMediaURL struct {
		index int
		scope messageMediaReadScope
		url   string
	}
	ids := []string{}
	for index := range messages {
		if pointerValue(messages[index].MediaStoragePath) != "" {
			messages[index].MediaURL = nil
			if _, valid := normalizeUUID(messages[index].ID); valid {
				ids = append(ids, messages[index].ID)
			}
		}
	}
	// Internal callers without an actor never mint a browser capability.
	if len(ids) == 0 || len(actors) == 0 || actors[0].OrganizationID != organizationID {
		return nil
	}
	before, err := loadMessageMediaReadScopes(ctx, repo.db.Pool(), actors[0], ids)
	if err != nil {
		return err
	}
	pending := []pendingMediaURL{}
	for index, message := range messages {
		scope, ok := before[message.ID]
		if !ok || scope.Path == "" || !whatsappMediaPathBelongsToOrganization(scope.Path, organizationID) ||
			scope.Path != pointerValue(message.MediaStoragePath) || scope.ConversationID != message.ConversationID ||
			scope.SessionID != pointerValue(message.SessionID) || scope.Kind != message.MessageType {
			continue
		}
		pending = append(pending, pendingMediaURL{index: index, scope: scope})
	}
	if len(pending) == 0 {
		return nil
	}
	var wg sync.WaitGroup
	limit := make(chan struct{}, 6)
	for index := range pending {
		item := &pending[index]
		wg.Add(1)
		go func() {
			defer wg.Done()
			select {
			case limit <- struct{}{}:
				defer func() { <-limit }()
			case <-ctx.Done():
				return
			}
			signed, err := repo.signedWhatsAppMessageMediaURL(ctx, organizationID, item.scope.Path)
			if err == nil {
				item.url = signed
			}
		}()
	}
	wg.Wait()
	after, err := loadMessageMediaReadScopes(ctx, repo.db.Pool(), actors[0], ids)
	if err != nil {
		return err
	}
	for _, item := range pending {
		if current, ok := after[item.scope.ID]; ok && current == item.scope && item.url != "" {
			signed := item.url
			messages[item.index].MediaURL = &signed
		}
	}
	return nil
}

func (repo Repository) ensureCanManageSession(ctx context.Context, tenantContext tenant.Context, sessionID string) error {
	if err := requireOriginalWhatsAppOrganization(ctx, repo.db.Pool(), tenantContext); err != nil {
		return err
	}
	var ok bool
	err := repo.db.Pool().QueryRow(ctx, `
		select exists (
			select 1
			from public.whatsapp_sessions ws
			where ws.organization_id = $1::uuid
			  and ws.id = $2::uuid
			  and coalesce(ws.is_active, true) = true
			  and coalesce(ws.status, '') <> 'deleted'
			  and ws.provider = 'evolution_go'
			  and ws.owner_user_id = $3::uuid
		)
	`, tenantContext.OrganizationID, sessionID, tenantContext.UserID).Scan(&ok)
	if err != nil {
		return err
	}
	if !ok {
		return ErrSessionNotFound
	}

	return nil
}

func (repo Repository) ensureCanViewConversation(ctx context.Context, tenantContext tenant.Context, conversationID string) error {
	return repo.ensureCanViewConversationForLead(ctx, tenantContext, conversationID, "")
}

func (repo Repository) ensureCanViewConversationForLead(
	ctx context.Context,
	tenantContext tenant.Context,
	conversationID string,
	expectedLeadID string,
) error {
	var ok bool
	args := append(baseConversationArgs(tenantContext), conversationID)
	expectedLeadPredicate := ""
	if expectedLeadID != "" {
		normalizedExpectedLeadID, err := validateExpectedConversationLeadSnapshot(expectedLeadID)
		if err != nil {
			return err
		}
		if normalizedExpectedLeadID == unlinkedConversationLeadSnapshot {
			expectedLeadPredicate = "and wc.lead_id is null"
		} else {
			args = append(args, normalizedExpectedLeadID)
			expectedLeadPredicate = fmt.Sprintf("and wc.lead_id = $%d::uuid", len(args))
		}
	}
	err := repo.db.Pool().QueryRow(ctx, `
		select exists (
			select 1
			from public.whatsapp_conversations wc
			left join public.whatsapp_sessions ws on ws.id = wc.session_id
			left join public.leads l on l.id = wc.lead_id and l.organization_id = wc.organization_id
			where wc.organization_id = $1::uuid
			  and wc.deleted_at is null
		  and `+conversationVisibilitySQL(canViewOwnWhatsAppLeads(tenantContext))+`
			  and wc.id = $5::uuid
			  `+expectedLeadPredicate+`
		)
	`, args...).Scan(&ok)
	if err != nil {
		return err
	}
	if !ok {
		return ErrConversationNotFound
	}

	return nil
}

func (repo Repository) ensureCanEditConversation(ctx context.Context, tenantContext tenant.Context, conversationID string) error {
	return repo.ensureCanViewConversation(ctx, tenantContext, conversationID)
}

// ensureCanLinkConversation permits normal users to relink only conversations
// they can already see. Unlinked inbox items stay quarantined from brokers and
// can only be linked by the session owner or a WhatsApp administrator.
func (repo Repository) ensureCanLinkConversation(ctx context.Context, tenantContext tenant.Context, conversationID string) error {
	var allowed bool
	args := append(baseConversationArgs(tenantContext), canManageWhatsApp(tenantContext), conversationID)
	err := repo.db.Pool().QueryRow(ctx, `
		select exists (
			select 1
			from public.whatsapp_conversations wc
			left join public.whatsapp_sessions ws on ws.id = wc.session_id
			left join public.leads l on l.id = wc.lead_id and l.organization_id = wc.organization_id
			where wc.organization_id = $1::uuid
			  and wc.deleted_at is null
			  and wc.id = $6::uuid
			  and ws.id is not null
			  and ws.organization_id = wc.organization_id
			  and ws.provider = 'evolution_go'
			  and coalesce(ws.is_active, true) = true
			  and coalesce(ws.status, '') <> 'deleted'
			  and (
				(
					l.id is not null
					and l.organization_id = wc.organization_id
					and `+leadVisibilitySQL(canViewOwnWhatsAppLeads(tenantContext))+`
				)
				or (
					wc.lead_id is null
					and (ws.owner_user_id = $2::uuid or $5::boolean)
				)
			  )
		)
	`, args...).Scan(&allowed)
	if err != nil {
		return err
	}
	if !allowed {
		return ErrConversationNotFound
	}

	return nil
}

func (repo Repository) validateUser(ctx context.Context, organizationID string, userID string) error {
	var exists bool
	err := repo.db.Pool().QueryRow(ctx, `
		select exists (
			select 1
			from public.users u
			join public.organization_members om
			  on om.user_id = u.id
			 and om.organization_id = $1::uuid
			where u.id = $2::uuid
			  and u.organization_id = $1::uuid
			  and coalesce(u.is_active, false) = true
			  and coalesce(om.is_active, false) = true
		)
	`, organizationID, userID).Scan(&exists)
	if err != nil {
		return err
	}
	if !exists {
		return ErrInvalidReference
	}

	return nil
}

// ensureCanViewLead applies the same organization, assignee and team scope as
// the Leads domain. A lead merely belonging to the same organization is not
// enough: that was the source of the WhatsApp history BOLA/IDOR.
func (repo Repository) ensureCanViewLead(ctx context.Context, tenantContext tenant.Context, leadID string) error {
	leadID, ok := normalizeUUID(leadID)
	if !ok {
		return ErrInvalidReference
	}

	var allowed bool
	args := append(baseConversationArgs(tenantContext), leadID)
	err := repo.db.Pool().QueryRow(ctx, `
		select exists (
			select 1
			from public.leads l
			where l.organization_id = $1::uuid
			  and l.id = $5::uuid
			  and `+leadVisibilitySQL(canViewOwnWhatsAppLeads(tenantContext))+`
		)
	`, args...).Scan(&allowed)
	if err != nil {
		return err
	}
	if !allowed {
		return ErrInvalidReference
	}

	return nil
}

func sessionSelectFields() string {
	return `
		ws.id::text,
		ws.organization_id::text,
		ws.owner_user_id::text,
		ws.instance_name,
		ws.display_name,
		ws.instance_id,
		ws.status,
		ws.phone_number,
		ws.profile_name,
		ws.profile_picture,
		coalesce(ws.is_active, true),
		coalesce(ws.is_notification_session, false),
		ws.provider,
		coalesce(ws.advanced_settings, '{}'::jsonb)::text,
		ws.created_at,
		ws.updated_at,
		ws.last_connected_at,
		owner.id::text,
		owner.name,
		owner.email`
}

func conversationSelectFields() string {
	return `
		wc.id::text,
		coalesce(wc.session_id::text, ''),
		wc.lead_id::text,
		wc.remote_jid,
		wc.contact_name,
		wc.contact_phone,
		wc.contact_picture,
		wc.contact_presence,
		wc.presence_updated_at,
		wc.last_message,
		wc.last_message_at,
		wc.unread_count,
		wc.is_group,
		wc.archived_at,
		wc.deleted_at,
		wc.created_at,
		wc.updated_at,
		ws.id::text,
		ws.instance_name,
		ws.phone_number,
		ws.status,
		ws.organization_id::text,
		ws.provider,
		l.id::text,
		l.name,
		l.source,
		l.whatsapp_avatar_url,
		l.pipeline_id::text,
		l.stage_id::text,
		l.assigned_user_id::text,
		(
			select u.name
			from public.users u
			where u.id = l.assigned_user_id
			limit 1
		),
		(
			select u.avatar_url
			from public.users u
			where u.id = l.assigned_user_id
			limit 1
		),
		pipeline.id::text,
		pipeline.name,
		stage.id::text,
		stage.name,
		stage.color,
		coalesce((
			select jsonb_agg(jsonb_build_object(
				'tag', jsonb_build_object(
					'id', t.id::text,
					'name', t.name,
					'color', t.color
				)
			))
			from public.lead_tags lt
			join public.tags t on t.id = lt.tag_id
			where lt.lead_id = l.id
		), '[]'::jsonb)::text,
		` + conversationListPreviewSQL() + `,
		` + conversationAvatarReferenceSQL(false)
}

// Lead-history conversation summaries must describe the lead being requested,
// not the conversation's mutable current assignment. A conversation may have
// been relinked after immutable message rows were attributed to another lead.
// Returning wc.lead_id/contact/last_message in that case would leak the current
// lead's CRM metadata even though the message query itself is correctly scoped.
func leadHistoryConversationSelectFields() string {
	return `
		wc.id::text,
		ws.id::text,
		$5::uuid::text,
		coalesce(history.remote_jid, case when wc.lead_id = $5::uuid or exists (
		  select 1
		  from public.whatsapp_conversation_lead_bindings binding_identity
		  where binding_identity.organization_id = wc.organization_id
		    and binding_identity.conversation_id = wc.id
		    and binding_identity.lead_id = $5::uuid
		) then wc.remote_jid end, ''),
		l.name,
		coalesce(nullif(l.phone, ''), nullif(to_jsonb(l)->>'whatsapp', '')),
		l.whatsapp_avatar_url,
		null::text,
		null::timestamptz,
		history.preview,
		history.message_at,
		0::integer,
		wc.is_group,
		null::timestamptz,
		wc.deleted_at,
		coalesce(history.first_at, wc.created_at),
		coalesce(history.message_at, wc.updated_at),
		ws.id::text,
		ws.instance_name,
		ws.phone_number,
		ws.status,
		ws.organization_id::text,
		ws.provider,
		l.id::text,
		l.name,
		l.source,
		l.whatsapp_avatar_url,
		l.pipeline_id::text,
		l.stage_id::text,
		l.assigned_user_id::text,
		(
			select u.name
			from public.users u
			where u.id = l.assigned_user_id
			limit 1
		),
		(
			select u.avatar_url
			from public.users u
			where u.id = l.assigned_user_id
			limit 1
		),
		pipeline.id::text,
		pipeline.name,
		stage.id::text,
		stage.name,
		stage.color,
		coalesce((
			select jsonb_agg(jsonb_build_object(
				'tag', jsonb_build_object(
					'id', t.id::text,
					'name', t.name,
					'color', t.color
				)
			))
			from public.lead_tags lt
			join public.tags t on t.id = lt.tag_id
			where lt.lead_id = l.id
		), '[]'::jsonb)::text,
		case when history.preview is not null then jsonb_build_object(
		  'preview', history.preview, 'from_me', history.from_me, 'status', history.status
		)::text end,
		` + conversationAvatarReferenceSQL(true)
}

func messageSelectFields() string {
	return messageSelectFieldsWithSession("wm.session_id")
}

func messageSelectFieldsWithSession(sessionExpression string) string {
	return messageSelectFieldsWithOrder(sessionExpression, "0::bigint")
}

func messageSelectFieldsWithOrder(sessionExpression, orderSequenceSQL string) string {
	return messageSelectFieldsWithCapabilities(sessionExpression, orderSequenceSQL, "false")
}

func messageSelectFieldsWithCapabilities(sessionExpression, orderSequenceSQL, capabilitiesSQL string) string {
	return `
		wm.id::text,
		wm.conversation_id::text,
		(` + sessionExpression + `)::text,
		coalesce(wm.message_id, wm.client_message_id, wm.id::text),
		wm.client_message_id,
		wm.from_me,
		wm.content,
		wm.message_type,
		wm.media_url,
		wm.media_mime_type,
		wm.media_status,
		wm.media_error,
		wm.media_size,
		wm.media_storage_path,
		wm.remote_jid,
		wm.reaction_to_message_id,
		wm.reaction_emoji,
		wm.reaction_sender_jid,
		wm.reaction_sender_name,
		'{}'::text,
		wm.status,
		case when wm.from_me and wm.status = 'failed' then (
			coalesce((select jsonb_build_object(
				'last_error', outbound.last_error,
				'status', outbound.status,
				'failed_at', coalesce(outbound.failed_at, outbound.dead_lettered_at)
			)
			from public.whatsapp_outbox outbound
			where outbound.organization_id = wm.organization_id
			  and outbound.message_id = wm.id
			limit 1), '{}'::jsonb) || jsonb_build_object(
			  'persisted_code', wm.metadata->>'delivery_error_code',
			  'persisted_reason', wm.metadata->>'delivery_error_reason',
			  'persisted_at', wm.metadata->>'delivery_failed_at'
			)
		)::text else null end,
		coalesce(wm.sent_at, wm.created_at),
		wm.delivered_at,
		wm.read_at,
		wm.sender_jid,
		wm.sender_name,
		wm.sender_user_id::text,
		wm.created_at,
		` + orderSequenceSQL + `,
		(` + messagePresentationSQL() + `)::text,
		` + capabilitiesSQL + `, ` + capabilitiesSQL
}

func scanSession(row scanner) (Session, error) {
	return scanSessionFields(row, false)
}

func scanSessionWithCanSend(row scanner) (Session, error) {
	return scanSessionFields(row, true)
}

func scanSessionFields(row scanner, includeCanSend bool) (Session, error) {
	var session Session
	var ownerID, ownerName, ownerEmail pgtype.Text
	var displayName, instanceID, phoneNumber, profileName, profilePicture pgtype.Text
	var lastConnectedAt pgtype.Timestamptz
	var settingsJSON string
	var canSend bool

	dest := []any{
		&session.ID,
		&session.OrganizationID,
		&session.OwnerUserID,
		&session.InstanceName,
		&displayName,
		&instanceID,
		&session.Status,
		&phoneNumber,
		&profileName,
		&profilePicture,
		&session.IsActive,
		&session.IsNotificationSession,
		&session.Provider,
		&settingsJSON,
		&session.CreatedAt,
		&session.UpdatedAt,
		&lastConnectedAt,
		&ownerID,
		&ownerName,
		&ownerEmail,
	}
	if includeCanSend {
		dest = append(dest, &canSend)
	}
	if err := row.Scan(dest...); err != nil {
		return Session{}, err
	}
	if includeCanSend {
		session.CanSend = &canSend
	}

	session.DisplayName = textPtr(displayName)
	session.InstanceID = textPtr(instanceID)
	session.PhoneNumber = textPtr(phoneNumber)
	session.ProfileName = textPtr(profileName)
	session.ProfilePicture = textPtr(profilePicture)
	session.LastConnectedAt = timePtr(lastConnectedAt)
	session.AdvancedSettings = decodeObjectJSON(settingsJSON)
	if ownerID.Valid {
		session.Owner = &OwnerRef{ID: ownerID.String, Name: textValue(ownerName), Email: textValue(ownerEmail)}
	}

	return session, nil
}

func scanSessionAccess(row scanner) (SessionAccess, error) {
	var item SessionAccess
	var grantedBy, userID, userName, userEmail pgtype.Text
	if err := row.Scan(
		&item.ID,
		&item.SessionID,
		&item.UserID,
		&item.AccessMode,
		&item.CanView,
		&item.CanRead,
		&item.CanSend,
		&item.OnlyLeadsAccess,
		&grantedBy,
		&item.CreatedAt,
		&userID,
		&userName,
		&userEmail,
	); err != nil {
		return SessionAccess{}, err
	}
	item.GrantedBy = textPtr(grantedBy)
	if userID.Valid {
		item.User = &AccessUser{ID: userID.String, Name: textValue(userName), Email: textValue(userEmail)}
	}

	return item, nil
}

func scanConversation(row scanner) (Conversation, error) {
	return scanConversationWithSupervisoryRead(row, false)
}

func scanConversationWithSupervisoryRead(row scanner, includeSupervisory bool) (Conversation, error) {
	var conversation Conversation
	var conversationSessionID pgtype.Text
	var leadID, contactName, contactPhone, contactPicture, contactPresence, lastMessage pgtype.Text
	var presenceUpdatedAt, lastMessageAt, archivedAt, deletedAt pgtype.Timestamptz
	var sessionID, sessionInstanceName, sessionPhone, sessionStatus, sessionOrgID, sessionProvider pgtype.Text
	var leadRefID, leadName, leadSource, leadAvatar, leadPipelineID, leadStageID pgtype.Text
	var leadAssigneeID, leadAssigneeName, leadAssigneeAvatar pgtype.Text
	var pipelineID, pipelineName, stageID, stageName, stageColor pgtype.Text
	var tagsJSON string
	var listPreviewJSON pgtype.Text
	var avatarReferenceJSON pgtype.Text

	destinations := []any{
		&conversation.ID,
		&conversationSessionID,
		&leadID,
		&conversation.RemoteJID,
		&contactName,
		&contactPhone,
		&contactPicture,
		&contactPresence,
		&presenceUpdatedAt,
		&lastMessage,
		&lastMessageAt,
		&conversation.UnreadCount,
		&conversation.IsGroup,
		&archivedAt,
		&deletedAt,
		&conversation.CreatedAt,
		&conversation.UpdatedAt,
		&sessionID,
		&sessionInstanceName,
		&sessionPhone,
		&sessionStatus,
		&sessionOrgID,
		&sessionProvider,
		&leadRefID,
		&leadName,
		&leadSource,
		&leadAvatar,
		&leadPipelineID,
		&leadStageID,
		&leadAssigneeID,
		&leadAssigneeName,
		&leadAssigneeAvatar,
		&pipelineID,
		&pipelineName,
		&stageID,
		&stageName,
		&stageColor,
		&tagsJSON,
		&listPreviewJSON,
		&avatarReferenceJSON,
	}
	if includeSupervisory {
		destinations = append(destinations, &conversation.SupervisoryLeadView)
	}
	if err := row.Scan(destinations...); err != nil {
		return Conversation{}, err
	}

	conversation.LeadID = textPtr(leadID)
	conversation.SessionID = textValue(conversationSessionID)
	conversation.ContactName = textPtr(contactName)
	conversation.ContactPhone = textPtr(contactPhone)
	conversation.ContactPicture = textPtr(contactPicture)
	conversation.ContactPresence = textPtr(contactPresence)
	conversation.PresenceUpdatedAt = timePtr(presenceUpdatedAt)
	conversation.LastMessage = textPtr(lastMessage)
	conversation.LastMessageAt = timePtr(lastMessageAt)
	if err := applyConversationListPreview(&conversation, textValue(listPreviewJSON)); err != nil {
		return Conversation{}, err
	}
	conversation.ArchivedAt = timePtr(archivedAt)
	conversation.DeletedAt = timePtr(deletedAt)
	if avatarReferenceJSON.Valid {
		var reference conversationAvatarReference
		if err := json.Unmarshal([]byte(avatarReferenceJSON.String), &reference); err != nil {
			return Conversation{}, errors.New("invalid conversation avatar reference")
		}
		conversation.avatarReference = &reference
	}

	if sessionID.Valid {
		conversation.Session = &SessionLite{
			ID:             sessionID.String,
			InstanceName:   textValue(sessionInstanceName),
			PhoneNumber:    textPtr(sessionPhone),
			Status:         textValue(sessionStatus),
			OrganizationID: textValue(sessionOrgID),
			Provider:       textPtr(sessionProvider),
		}
	}

	if leadRefID.Valid {
		lead := &LeadLite{
			ID:                leadRefID.String,
			Name:              textValue(leadName),
			Source:            textPtr(leadSource),
			WhatsAppAvatarURL: textPtr(leadAvatar),
			PipelineID:        textPtr(leadPipelineID),
			StageID:           textPtr(leadStageID),
			Tags:              decodeLeadTags(tagsJSON),
		}
		if leadAssigneeID.Valid {
			lead.Assignee = &LeadAssigneeRef{ID: leadAssigneeID.String, Name: textValue(leadAssigneeName), AvatarURL: textPtr(leadAssigneeAvatar)}
		}
		if pipelineID.Valid {
			lead.Pipeline = &NameRef{ID: pipelineID.String, Name: textValue(pipelineName)}
		}
		if stageID.Valid {
			lead.Stage = &StageRef{ID: stageID.String, Name: textValue(stageName), Color: textPtr(stageColor)}
		}
		conversation.Lead = lead
	}

	return conversation, nil
}

func scanMessage(row scanner) (Message, error) {
	var message Message
	var sessionID, clientMessageID, content, mediaURL, mediaMimeType, mediaStatus, mediaError, mediaStoragePath pgtype.Text
	var deliveryFailureJSON pgtype.Text
	var remoteJID, reactionToMessageID, reactionEmoji, reactionSenderJID, reactionSenderName pgtype.Text
	var mediaSize pgtype.Int8
	var deliveredAt, readAt pgtype.Timestamptz
	var senderJID, senderName, senderUserID pgtype.Text
	var metadataJSON string
	var presentationJSON string

	if err := row.Scan(
		&message.ID,
		&message.ConversationID,
		&sessionID,
		&message.MessageID,
		&clientMessageID,
		&message.FromMe,
		&content,
		&message.MessageType,
		&mediaURL,
		&mediaMimeType,
		&mediaStatus,
		&mediaError,
		&mediaSize,
		&mediaStoragePath,
		&remoteJID,
		&reactionToMessageID,
		&reactionEmoji,
		&reactionSenderJID,
		&reactionSenderName,
		&metadataJSON,
		&message.Status,
		&deliveryFailureJSON,
		&message.SentAt,
		&deliveredAt,
		&readAt,
		&senderJID,
		&senderName,
		&senderUserID,
		&message.OrderCreatedAt,
		&message.OrderIngressSequence,
		&presentationJSON,
		&message.CanQuote, &message.CanReact,
	); err != nil {
		return Message{}, err
	}

	message.SessionID = textPtr(sessionID)
	message.ClientMessageID = textPtr(clientMessageID)
	message.Content = textPtr(content)
	message.MediaURL = textPtr(mediaURL)
	message.MediaMimeType = textPtr(mediaMimeType)
	message.MediaStatus = textPtr(mediaStatus)
	message.MediaError = textPtr(mediaError)
	message.MediaSize = int64Ptr(mediaSize)
	message.MediaStoragePath = textPtr(mediaStoragePath)
	message.RemoteJID = textPtr(remoteJID)
	message.ReactionToMessageID = textPtr(reactionToMessageID)
	message.ReactionEmoji = textPtr(reactionEmoji)
	message.ReactionSenderJID = textPtr(reactionSenderJID)
	message.ReactionSenderName = textPtr(reactionSenderName)
	message.Metadata = decodeObjectJSON(metadataJSON)
	applyMessagePresentation(&message, presentationJSON)
	if message.FromMe && message.Status == "failed" {
		code := deliveryErrorSendFailed
		if deliveryFailureJSON.Valid {
			var failure struct {
				LastError       string     `json:"last_error"`
				Status          string     `json:"status"`
				FailedAt        *time.Time `json:"failed_at"`
				PersistedCode   string     `json:"persisted_code"`
				PersistedReason string     `json:"persisted_reason"`
				PersistedAt     string     `json:"persisted_at"`
			}
			if err := json.Unmarshal([]byte(deliveryFailureJSON.String), &failure); err != nil {
				return Message{}, fmt.Errorf("decode WhatsApp delivery failure: %w", err)
			}
			code = messageDeliveryErrorCode(failure.LastError)
			reason := mediaDeliveryFailureReason(failure.LastError)
			if failure.PersistedReason == "media_integrity_unverified" {
				reason = failure.PersistedReason
			}
			if failure.Status == "dead" && code == deliveryErrorSendFailed {
				// Exhausted retries do not prove the provider never received the
				// stanza. Report uncertainty rather than a definitive rejection.
				code = deliveryErrorOutcomeUnknown
			}
			switch failure.PersistedCode {
			case deliveryErrorRecipientNotRegistered, deliveryErrorOutcomeUnknown, deliveryErrorSendFailed:
				code = failure.PersistedCode
			}
			if code == deliveryErrorSendFailed && reason != "" {
				message.DeliveryErrorReason = &reason
			}
			message.DeliveryFailedAt = failure.FailedAt
			if message.DeliveryFailedAt == nil && failure.PersistedAt != "" {
				if persistedAt, err := time.Parse(time.RFC3339Nano, failure.PersistedAt); err == nil {
					message.DeliveryFailedAt = &persistedAt
				}
			}
		}
		message.DeliveryErrorCode = &code
	}
	message.DeliveredAt = timePtr(deliveredAt)
	message.ReadAt = timePtr(readAt)
	message.SenderJID = textPtr(senderJID)
	message.SenderName = textPtr(senderName)
	message.SenderUserID = textPtr(senderUserID)

	return message, nil
}

func baseConversationArgs(tenantContext tenant.Context) []any {
	return []any{
		tenantContext.OrganizationID,
		tenantContext.UserID,
		canViewAllWhatsAppLeads(tenantContext),
		tenantContext.HasPermission("lead_view_team"),
	}
}

// A caixa principal nunca lista conversa sem lead e sem historico visivel:
// os contatos "@lid" do backlog criam conversas cujo conteudo e suprimido ou
// recuperado como "Sem lead" (unlinked), e sem este corte elas aparecem como
// cartoes vazios ("Sem mensagens") e inflam o contador de nao lidas.
func conversationMainListContentSQL() string {
	return `(
		wc.lead_id is not null
		or exists (
			select 1
			from public.whatsapp_messages visible_message
			where visible_message.organization_id = wc.organization_id
			  and visible_message.conversation_id = wc.id
			  and coalesce(visible_message.capture_state, 'captured') in ('legacy', 'captured', 'unlinked_ephemeral')
		)
	)`
}

func conversationVisibilitySQL(canViewOwn bool) string {
	return `(
		ws.id is not null
		and ws.organization_id = wc.organization_id
		and ws.provider = 'evolution_go'
		and ` + conversationRetentionVisibilitySQL() + `
		and (
			(
				wc.lead_id is not null
				and l.id is not null
				and l.organization_id = wc.organization_id
				and ` + leadVisibilitySQL(canViewOwn) + `
			)
			or (
				wc.lead_id is null
				and coalesce(ws.is_active, true) = true
				and coalesce(ws.status, '') <> 'deleted'
				and ws.owner_user_id = $2::uuid
			)
		)
	)`
}

// The operational inbox contains the owner's authorized conversations and
// shared conversations assigned to this recipient. Broader CRM lead history
// stays readable through snapshot/history endpoints, without sharing a number.
func operationalConversationVisibilitySQL(canViewOwn bool) string {
	return conversationVisibilitySQL(canViewOwn) + " and " + operationalConversationAccessSQL()
}

func operationalConversationAccessSQL() string {
	return `(
		ws.owner_user_id = $2::uuid
		or (
			wc.lead_id is not null
			and l.assigned_user_id = $2::uuid
			and ` + sessionGrantExistsSQL("ws", "$2::uuid", false) + `
		)
	)`
}

// An enrolled direct conversation without a current lead leaves the operational
// inbox seven days after creation. A retired epoch remains owner-readable until its
// deadline, but retirement still excludes it from physical routing and sends.
func conversationRetentionVisibilitySQL() string {
	return `(
	  (wc.retired_at is null and (
	    not wc.unlinked_retention_v1 or wc.lead_id is not null
	    or coalesce(wc.is_group, false) = true or wc.created_at > now() - interval '7 days'
	  ))
	  or (
	    wc.retired_at is not null
	    and wc.unlinked_retention_v1
	    and wc.lead_id is null
	    and wc.unlinked_retention_scrubbed_at is null
	    and wc.created_at > now() - interval '7 days'
	  )
	)`
}

// The database compares the frozen physical route before retirement. A
// rejected result (including a database awaiting its partial-index cutover)
// cannot fall through to a new conversation INSERT.
func retireWhatsAppUnlinkedConversationEpoch(
	ctx context.Context,
	queryer whatsappQueryRower,
	organizationID string,
	sessionID string,
	expectedConversationID string,
	remoteJID string,
) error {
	var rawResult string
	err := queryer.QueryRow(ctx, `
		select public.retire_whatsapp_unlinked_conversation_epoch(
			p_organization_id => $1::uuid,
			p_session_id => $2::uuid,
			p_expected_conversation_id => $3::uuid,
			p_remote_jid => $4
		)::text
	`, organizationID, sessionID, expectedConversationID, remoteJID).Scan(&rawResult)
	if err != nil {
		return err
	}
	var outcome struct {
		Retired        bool   `json:"retired"`
		ConversationID string `json:"conversation_id"`
		Reason         string `json:"reason"`
	}
	if err := json.Unmarshal([]byte(rawResult), &outcome); err != nil {
		return fmt.Errorf("decode WhatsApp unlinked epoch retirement: %w", err)
	}
	if !outcome.Retired || outcome.ConversationID != expectedConversationID {
		return fmt.Errorf("%w: unlinked epoch retirement %s", ErrConversationBindingChanged, outcome.Reason)
	}
	return nil
}

// Lead history is immutable CRM evidence. A disconnected/deleted WhatsApp
// session can no longer send, but it must not make already authorized lead
// messages disappear. The target lead is joined as `l` by the two history
// queries; tenant/user visibility remains identical to current lead access.
func leadHistoryVisibilitySQL(canViewOwn bool) string {
	return `(
		l.id is not null
		and l.organization_id = wc.organization_id
		and ` + leadVisibilitySQL(canViewOwn) + `
	)`
}

// Media authorization is evaluated in the same statement that selects the
// object path. An attributed message follows its immutable message-level lead,
// even if the conversation is later relinked. A null legacy attribution never
// inherits the conversation's current card; only a still-unlinked quarantine
// row is operationally visible to the owner of its active historical session.
func messageMediaVisibilitySQL(canViewOwn bool) string {
	return `(
		(
			wm.lead_id is not null
			and ` + leadHistoryVisibilitySQL(canViewOwn) + `
		)
		or (
			wm.lead_id is null
			and wc.lead_id is null
			and wc.deleted_at is null
			and ` + conversationRetentionVisibilitySQL() + `
			and ws.id is not null
			and ws.provider = 'evolution_go'
			and coalesce(ws.is_active, true) = true
			and coalesce(ws.status, '') <> 'deleted'
			and ws.owner_user_id = $2::uuid
		)
	)`
}

// A conversation timeline follows the conversation's current lead. Null rows
// remain visible only while the conversation itself is still quarantined;
// after a card switch they must not be inherited by the new active card.
func conversationMessageLeadMatchSQL() string {
	return "(wm.lead_id = wc.lead_id or (wm.lead_id is null and wc.lead_id is null))"
}

// Lead history uses only immutable message-level attribution. Legacy null rows
// are backfilled from the binding ledger during cutover and are never inferred
// from the conversation's current card at read time.
func leadHistoryMessageLeadMatchSQL() string {
	return "wm.lead_id = $5::uuid"
}

func leadVisibilitySQL(canViewOwn bool) string {
	return leadscope.VisibilitySQL("l", "$3", "$2", "$4", canViewOwn)
}

func canViewAllWhatsAppLeads(tenantContext tenant.Context) bool {
	return tenantContext.IsSuperAdmin ||
		tenantContext.HasRole("owner", "admin") ||
		tenantContext.HasPermission("lead_view_all")
}

func canViewOwnWhatsAppLeads(tenantContext tenant.Context) bool {
	return tenantContext.HasPermission(permissions.LeadViewOwn)
}

func canManageWhatsApp(tenantContext tenant.Context) bool {
	return tenantContext.IsSuperAdmin ||
		tenantContext.HasRole("owner", "admin") ||
		tenantContext.HasPermission(permissions.WhatsAppManage)
}

func canCreateOwnWhatsAppSession(tenantContext tenant.Context) bool {
	return canManageWhatsApp(tenantContext) ||
		(tenantContext.IsOrganizationMember() && tenantContext.HasModule("whatsapp"))
}

func canCreateOwnWhatsAppSessionWithQuota(tenantContext tenant.Context, quota SessionQuota) bool {
	return canCreateOwnWhatsAppSession(tenantContext) ||
		(tenantContext.IsOrganizationMember() && quota.MaxSessions != nil)
}

func textValue(value pgtype.Text) string {
	if !value.Valid {
		return ""
	}

	return value.String
}

func textPtr(value pgtype.Text) *string {
	return pgvalue.TextPointer(value)
}

func timePtr(value pgtype.Timestamptz) *time.Time {
	if !value.Valid {
		return nil
	}

	return &value.Time
}

func int64Ptr(value pgtype.Int8) *int64 {
	if !value.Valid {
		return nil
	}

	return &value.Int64
}

func decodeObjectJSON(raw string) map[string]any {
	out := map[string]any{}
	_ = json.Unmarshal([]byte(raw), &out)
	return out
}

func decodeLeadTags(raw string) []LeadTagRef {
	out := []LeadTagRef{}
	_ = json.Unmarshal([]byte(raw), &out)
	return out
}
