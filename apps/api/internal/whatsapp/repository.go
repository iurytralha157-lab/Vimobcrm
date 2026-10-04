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
	db                   *dbpkg.Postgres
	storage              storageClient
	functions            functionsClient
	webhookSchemaGate    *evolutionWebhookSchemaGate
	gamificationRecorder GamificationRecorder
	leadPublisher        realtime.Publisher
}

type scanner interface {
	Scan(dest ...any) error
}

func NewRepository(db *dbpkg.Postgres, gamificationRecorder GamificationRecorder, storageConfig StorageConfig, publishers ...realtime.Publisher) Repository {
	publisher := realtime.Publisher(realtime.NoopPublisher{})
	if len(publishers) > 0 && publishers[0] != nil {
		publisher = publishers[0]
	}

	repo := Repository{
		db:                   db,
		storage:              newStorageClient(storageConfig),
		functions:            newFunctionsClient(storageConfig, db),
		webhookSchemaGate:    &evolutionWebhookSchemaGate{},
		gamificationRecorder: gamificationRecorder,
		leadPublisher:        publisher,
	}
	return repo
}

func (repo Repository) Close() {}

func (repo Repository) ListSessions(ctx context.Context, tenantContext tenant.Context) ([]Session, error) {
	args := []any{tenantContext.OrganizationID, tenantContext.UserID}
	rows, err := repo.db.Pool().Query(ctx, `
		select `+sessionSelectFields()+`
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
		session, err := scanSession(rows)
		if err != nil {
			return nil, err
		}
		if session.OwnerUserID != tenantContext.UserID {
			// Shared users need the number and connection state, not provider
			// identifiers or owner-only advanced settings.
			session.InstanceID = nil
			session.AdvancedSettings = nil
			if session.Owner != nil {
				session.Owner.Email = ""
			}
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
	sessionID, ok := normalizeUUID(sessionID)
	if !ok {
		return ErrSessionNotFound
	}
	if input.UserID == tenantContext.UserID || (!input.CanView && !input.CanSend) || (input.CanSend && !input.CanView) {
		return ErrInvalidInput
	}
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	// The session fence is held through the grant write. Revocation and a
	// concurrent send use the same session-first lock order.
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
	var recipientID string
	err = tx.QueryRow(ctx, `
		select recipient.id::text
		from public.users recipient
		join public.organization_members member
		  on member.user_id = recipient.id
		where member.organization_id = $1::uuid
		  and recipient.id = $2::uuid
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

	grantScope := ""
	var grantTeamID *string
	if ownerRole == "owner" || ownerRole == "admin" || ownerRole == "manager" {
		grantScope = "organization"
	} else {
		var teamID string
		err = tx.QueryRow(ctx, `
			select team.id::text
			from public.teams team
			join public.team_members leader
			  on leader.organization_id = team.organization_id
			 and leader.team_id = team.id
			 and leader.user_id = $2::uuid
			 and coalesce(leader.is_active, true) = true
			 and coalesce(leader.is_leader, false) = true
			join public.team_members member
			  on member.organization_id = team.organization_id
			 and member.team_id = team.id
			 and member.user_id = $3::uuid
			 and coalesce(member.is_active, true) = true
			where team.organization_id = $1::uuid
			  and coalesce(team.is_active, true) = true
			order by team.id
			limit 1
			for share of team, leader, member
		`, tenantContext.OrganizationID, tenantContext.UserID, input.UserID).Scan(&teamID)
		if errors.Is(err, pgx.ErrNoRows) {
			return tenant.ErrOrganizationAccessDenied
		}
		if err != nil {
			return err
		}
		grantScope = "team"
		grantTeamID = &teamID
	}

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
	`, tenantContext.OrganizationID, sessionID, input.UserID,
		input.CanView, input.CanSend, tenantContext.UserID, grantScope, grantTeamID)
	if err != nil {
		return err
	}
	return tx.Commit(ctx)
}

func (repo Repository) RevokeSessionAccess(ctx context.Context, tenantContext tenant.Context, sessionID string, userID string) error {
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

	args, where, empty, err := conversationFilterSQL(tenantContext, filter)
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

	rows, err := repo.db.Pool().Query(ctx, `
		select `+conversationSelectFields()+`
		from public.whatsapp_conversations wc
		left join public.whatsapp_sessions ws on ws.id = wc.session_id
		left join public.leads l on l.id = wc.lead_id
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
		conversation, err := scanConversation(rows)
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
		left join public.leads l on l.id = wc.lead_id
		where `+strings.Join(where, " and "), args...).Scan(&count)
	return count, err
}

// conversationFilterSQL is the single source of truth for list and unread
// count visibility. The explicit empty session scope is fail-closed so a
// client that has not resolved an allowed session never falls back to "all".
func conversationFilterSQL(tenantContext tenant.Context, filter ConversationListFilter) ([]any, []string, bool, error) {
	if filter.AccessibleProvided && len(filter.SessionIDs) == 0 {
		return nil, nil, true, nil
	}

	args := baseConversationArgs(tenantContext)
	where := []string{
		"wc.organization_id = $1::uuid",
		"wc.deleted_at is null",
		conversationVisibilitySQL(canViewOwnWhatsAppLeads(tenantContext)),
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
		where = append(where, "coalesce(wc.unread_count, 0) > 0")
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
			[]string{"wc.contact_name", "l.name", "wc.last_message"},
			fmt.Sprintf("$%d", textArg),
		)}
		if digits := onlyDigits(search); digits != "" {
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
	conversation, err := repo.GetConversationSnapshot(ctx, tenantContext, conversationID)
	if err != nil {
		return Conversation{}, err
	}

	return repo.resolveConversationLead(ctx, tenantContext, conversation)
}

// GetConversationSnapshot returns the current persisted card binding without
// running the legacy auto-link fallback. Browser deep links use this read only
// to pin the subsequent detail request to the same lead (or to "unlinked").
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
		left join public.leads l on l.id = wc.lead_id
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

// GetConversationForExpectedLead is the web-safe conversation read. Unlike
// GetConversation, it never auto-links an unbound conversation and returns no
// row when a browser still carries an older card snapshot.
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
		left join public.leads l on l.id = wc.lead_id
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
		"wc.deleted_at is null",
		"wm.capture_state is distinct from 'suppressed'",
		// Repeat authorization in this statement so a concurrent rebind cannot
		// reveal a new card between ensureCanViewConversationForLead and the read.
		conversationVisibilitySQL(canViewOwnWhatsAppLeads(tenantContext)),
		conversationReadableMessageLeadMatchSQL(),
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
	if filter.CursorAt != nil {
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
		select `+messageSelectFieldsWithSession("wc.session_id")+`
		from public.whatsapp_messages wm
		join public.whatsapp_conversations wc
		  on wc.id = wm.conversation_id
		 and wc.organization_id = wm.organization_id
		left join public.whatsapp_sessions ws
		  on ws.id = wc.session_id
		 and ws.organization_id = wc.organization_id
		left join public.leads l
		  on l.id = wc.lead_id
		 and l.organization_id = wc.organization_id
		where `+strings.Join(where, " and ")+`
		order by coalesce(wm.sent_at, wm.created_at) desc, wm.id desc
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
		value := oldest.SentAt.UTC().Format(time.RFC3339Nano) + "|" + oldest.ID
		nextCursor = &value
	}

	messages := make([]Message, 0, len(descMessages))
	for index := len(descMessages) - 1; index >= 0; index-- {
		messages = append(messages, descMessages[index])
	}
	// Even when the caller opts out of signed URLs, a legacy media_url from
	// the message row must not bypass an active nonlead retention deadline.
	if err := repo.prepareMessageMediaURLs(ctx, tenantContext.OrganizationID, messages, filter.IncludeMediaURLs); err != nil {
		return MessagePage{}, err
	}

	return MessagePage{Messages: messages, NextCursor: nextCursor}, nil
}

func (repo Repository) MarkConversationAsRead(ctx context.Context, tenantContext tenant.Context, conversationID string, expectedLeadID string) error {
	conversationID, ok := normalizeUUID(conversationID)
	if !ok {
		return ErrConversationNotFound
	}
	expectedLeadID, err := validateExpectedConversationLeadSnapshot(expectedLeadID)
	if err != nil {
		return err
	}
	if err := repo.ensureCanViewConversationForLead(ctx, tenantContext, conversationID, expectedLeadID); err != nil {
		return err
	}

	args := []any{tenantContext.OrganizationID, conversationID}
	expectedLeadPredicate := "lead_id is null"
	if expectedLeadID != unlinkedConversationLeadSnapshot {
		args = append(args, expectedLeadID)
		expectedLeadPredicate = fmt.Sprintf("lead_id = $%d::uuid", len(args))
	}
	tag, err := repo.db.Pool().Exec(ctx, `
		update public.whatsapp_conversations
		set unread_count = 0,
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
		  and `+expectedLeadPredicate+`
	`, args...)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrConversationNotFound
	}
	return nil
}

func (repo Repository) ArchiveConversation(ctx context.Context, tenantContext tenant.Context, conversationID string, archive bool, expectedLeadID string) error {
	conversationID, ok := normalizeUUID(conversationID)
	if !ok {
		return ErrConversationNotFound
	}
	expectedLeadID, err := validateExpectedConversationLeadSnapshot(expectedLeadID)
	if err != nil {
		return err
	}
	if err := repo.ensureCanViewConversationForLead(ctx, tenantContext, conversationID, expectedLeadID); err != nil {
		return err
	}

	args := []any{tenantContext.OrganizationID, conversationID, archive}
	expectedLeadPredicate := "lead_id is null"
	if expectedLeadID != unlinkedConversationLeadSnapshot {
		args = append(args, expectedLeadID)
		expectedLeadPredicate = fmt.Sprintf("lead_id = $%d::uuid", len(args))
	}
	tag, err := repo.db.Pool().Exec(ctx, `
		update public.whatsapp_conversations
		set archived_at = case when $3::boolean then now() else null end,
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
		  and `+expectedLeadPredicate+`
	`, args...)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrConversationNotFound
	}
	return nil
}

func (repo Repository) DeleteConversation(ctx context.Context, tenantContext tenant.Context, conversationID string, expectedLeadID string) error {
	conversationID, ok := normalizeUUID(conversationID)
	if !ok {
		return ErrConversationNotFound
	}
	expectedLeadID, err := validateExpectedConversationLeadSnapshot(expectedLeadID)
	if err != nil {
		return err
	}

	// Deleting a conversation removes it from the operational inbox. It is a
	// privileged action: lead visibility alone is deliberately insufficient.
	// Historical messages remain available through the lead history endpoint.
	args := []any{tenantContext.OrganizationID, conversationID, tenantContext.UserID}
	expectedLeadPredicate := "wc.lead_id is null"
	if expectedLeadID != unlinkedConversationLeadSnapshot {
		args = append(args, expectedLeadID)
		expectedLeadPredicate = fmt.Sprintf("wc.lead_id = $%d::uuid", len(args))
	}
	tag, err := repo.db.Pool().Exec(ctx, `
		update public.whatsapp_conversations wc
		set deleted_at = now(),
		    updated_at = now()
		from public.whatsapp_sessions ws
		where wc.organization_id = $1::uuid
		  and wc.id = $2::uuid
		  and `+expectedLeadPredicate+`
		  and wc.deleted_at is null
		  and ws.id = wc.session_id
		  and ws.organization_id = wc.organization_id
		  and ws.provider = 'evolution_go'
		  and coalesce(ws.is_active, true) = true
		  and coalesce(ws.status, '') <> 'deleted'
		  and ws.owner_user_id = $3::uuid
	`, args...)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrConversationNotFound
	}
	return nil
}

func (repo Repository) LinkConversationToLead(
	ctx context.Context,
	tenantContext tenant.Context,
	conversationID string,
	leadID string,
	expectedPreviousLeadID string,
) error {
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

	// Lock the session first, then the conversation and lead. A generic
	// WhatsAppManage permission does not grant access to somebody else's number.
	sessionID, err := discoverConversationSessionID(ctx, tx, tenantContext.OrganizationID, conversationID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrConversationNotFound
	}
	if err != nil {
		return err
	}
	var sessionOwnerID string
	err = tx.QueryRow(ctx, `
		select ws.owner_user_id::text
		from public.whatsapp_sessions ws
		where ws.organization_id = $1::uuid
		  and ws.id = $2::uuid
		  and ws.provider = 'evolution_go'
		  and coalesce(ws.is_active, true) = true
		  and coalesce(ws.status, '') <> 'deleted'
		  and (ws.owner_user_id = $3::uuid or `+sessionGrantExistsSQL("ws", "$3::uuid", true)+`)
		for share of ws
	`, tenantContext.OrganizationID, sessionID, tenantContext.UserID).Scan(&sessionOwnerID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrConversationNotFound
	}
	if err != nil {
		return err
	}
	// This query only establishes the organization-scoped conversation lock.
	// Supplying the four visibility arguments would leave $2-$4 unused and pgx
	// rejects that parameter set before the binding CAS can execute.
	lockArgs := []any{tenantContext.OrganizationID, conversationID}
	var remoteJID, contactPhone string
	var isGroup bool
	var currentLeadID pgtype.Text
	err = tx.QueryRow(ctx, `
		select
		  wc.remote_jid,
		  coalesce(wc.contact_phone, ''),
		  wc.is_group,
		  wc.lead_id::text,
		  ws.id::text
		from public.whatsapp_conversations wc
		join public.whatsapp_sessions ws
		  on ws.id = wc.session_id
		 and ws.organization_id = wc.organization_id
		where wc.organization_id = $1::uuid
		  and wc.id = $2::uuid
		  and wc.deleted_at is null
		  and not exists (
			select 1
			from private.whatsapp_nonlead_retention_candidates as retention
			where retention.conversation_id = wc.id
			  and retention.organization_id = wc.organization_id
			  and private.whatsapp_nonlead_retention_candidate_active(
			    retention.organization_id, retention.session_id, retention.conversation_id
			  )
			  and retention.state in ('pending', 'purging')
			  and retention.expires_at <= now()
		  )
		  and ws.provider = 'evolution_go'
		  and coalesce(ws.is_active, true) = true
		  and coalesce(ws.status, '') <> 'deleted'
		for update of wc
	`, lockArgs...).Scan(&remoteJID, &contactPhone, &isGroup, &currentLeadID, &sessionID)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrConversationNotFound
	}
	if err != nil {
		return err
	}

	if currentLeadID.Valid {
		visibilityArgs := append(baseConversationArgs(tenantContext), currentLeadID.String,
			sessionOwnerID == tenantContext.UserID)
		var currentLeadVisible bool
		err = tx.QueryRow(ctx, `
				select true
				from public.leads as l
				where l.organization_id = $1::uuid
				  and l.id = $5::uuid
				  and `+leadVisibilitySQL(canViewOwnWhatsAppLeads(tenantContext))+`
				  and ($6::boolean or l.assigned_user_id = $2::uuid)
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
	} else if sessionOwnerID != tenantContext.UserID {
		return ErrConversationNotFound
	}

	identity := newWhatsAppContactIdentity(contactPhone, remoteJID, isGroup)
	leadContact, err := resolveAccessibleLeadContact(ctx, tx, tenantContext, leadID, identity)
	if err != nil {
		return fmt.Errorf("%w: a conversa e o lead possuem telefones diferentes", err)
	}
	if sessionOwnerID != tenantContext.UserID && leadContact.AssignedUserID != tenantContext.UserID {
		return ErrConversationNotFound
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

	return tx.Commit(ctx)
}

func (repo Repository) GetMessageMediaURL(ctx context.Context, tenantContext tenant.Context, messageID string) (MessageMediaURL, error) {
	messageID, ok := normalizeUUID(messageID)
	if !ok {
		return MessageMediaURL{}, ErrMessageNotFound
	}

	args := append(baseConversationArgs(tenantContext), messageID)
	var conversationID, storagePath, messageType, mediaStatus string
	err := repo.db.Pool().QueryRow(ctx, `
		select
			wm.conversation_id::text,
			coalesce(wm.media_storage_path, ''),
			coalesce(wm.message_type, ''),
			coalesce(wm.media_status, '')
		from public.whatsapp_messages wm
		join public.whatsapp_conversations wc
		  on wc.id = wm.conversation_id
		 and wc.organization_id = wm.organization_id
		left join public.whatsapp_sessions ws
		  on ws.id = wm.session_id
		 and ws.organization_id = wm.organization_id
		left join public.leads l
		  on l.id = wm.lead_id
		 and l.organization_id = wm.organization_id
		where wm.organization_id = $1::uuid
		  and wc.organization_id = $1::uuid
		  and wm.id = $5::uuid
		  and wm.capture_state is distinct from 'suppressed'
		  and `+messageMediaVisibilitySQL(canViewOwnWhatsAppLeads(tenantContext))+`
		limit 1
	`, args...).Scan(
		&conversationID,
		&storagePath,
		&messageType,
		&mediaStatus,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return MessageMediaURL{}, ErrMessageNotFound
	}
	if err != nil {
		return MessageMediaURL{}, err
	}
	if strings.EqualFold(strings.TrimSpace(messageType), "text") ||
		strings.EqualFold(strings.TrimSpace(messageType), "reaction") ||
		!strings.EqualFold(strings.TrimSpace(mediaStatus), "ready") ||
		strings.TrimSpace(storagePath) == "" {
		return MessageMediaURL{}, ErrMessageNotFound
	}

	access, err := repo.whatsAppNonLeadMediaAccess(ctx, tenantContext.OrganizationID, conversationID)
	if err != nil {
		return MessageMediaURL{}, err
	}
	if !access.allowed {
		return MessageMediaURL{}, ErrMessageNotFound
	}
	signedURL, expiresIn, err := repo.signedWhatsAppMessageMediaURLWithDeadline(
		ctx, tenantContext.OrganizationID, storagePath, access.deadline,
	)
	if err != nil {
		return MessageMediaURL{}, err
	}
	if signedURL == "" {
		return MessageMediaURL{}, ErrMessageNotFound
	}
	return MessageMediaURL{
		MessageID: messageID,
		URL:       signedURL,
		ExpiresIn: expiresIn,
	}, nil
}

type whatsAppNonLeadMediaAccess struct {
	allowed  bool
	deadline *time.Time
}

// A pending nonlead conversation cannot receive a newly signed URL that
// remains valid beyond its original seven-day deadline. If retention is active
// but its candidate is missing, fail closed instead of issuing a long-lived
// Storage credential for an untracked conversation.
func (repo Repository) whatsAppNonLeadMediaAccess(ctx context.Context, organizationID, conversationID string) (whatsAppNonLeadMediaAccess, error) {
	var policyEnabled, leadLinked, isGroup bool
	var candidateState string
	var expiresAt pgtype.Timestamptz
	err := repo.db.Pool().QueryRow(ctx, `
		select private.whatsapp_nonlead_retention_candidate_active(
		         conversation.organization_id, conversation.session_id, conversation.id
		       ),
		       (conversation.lead_id is not null or exists (
		         select 1 from public.whatsapp_conversation_lead_bindings as binding
		         where binding.conversation_id = conversation.id
		           and binding.organization_id = conversation.organization_id
		       )),
		       coalesce(conversation.is_group, false),
		       coalesce(candidate.state, ''), candidate.expires_at
		from public.whatsapp_conversations as conversation
		left join private.whatsapp_nonlead_retention_candidates as candidate
		  on candidate.organization_id = conversation.organization_id
		 and candidate.conversation_id = conversation.id
		where conversation.organization_id = $1::uuid
		  and conversation.id = $2::uuid
		  and conversation.deleted_at is null
	`, organizationID, conversationID).Scan(
		&policyEnabled, &leadLinked, &isGroup, &candidateState, &expiresAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return whatsAppNonLeadMediaAccess{}, ErrMessageNotFound
	}
	if err != nil {
		return whatsAppNonLeadMediaAccess{}, err
	}
	if !policyEnabled {
		return whatsAppNonLeadMediaAccess{allowed: true}, nil
	}
	if leadLinked || isGroup {
		return whatsAppNonLeadMediaAccess{allowed: true}, nil
	}
	if candidateState == "pending" && expiresAt.Valid {
		deadline := expiresAt.Time
		if !time.Now().Before(deadline) {
			return whatsAppNonLeadMediaAccess{}, nil
		}
		return whatsAppNonLeadMediaAccess{allowed: true, deadline: &deadline}, nil
	}
	if candidateState == "purging" || candidateState == "converted" {
		return whatsAppNonLeadMediaAccess{}, nil
	}
	// An active policy without a pending candidate is unproven; fail closed.
	return whatsAppNonLeadMediaAccess{}, nil
}

func (repo Repository) signedWhatsAppMessageMediaURLWithTTL(ctx context.Context, organizationID string, objectPath string) (string, int, error) {
	return repo.signedWhatsAppMessageMediaURLWithDeadline(ctx, organizationID, objectPath, nil)
}

func (repo Repository) signedWhatsAppMessageMediaURLWithDeadline(ctx context.Context, organizationID string, objectPath string, deadline *time.Time) (string, int, error) {
	objectPath = strings.TrimSpace(objectPath)
	if objectPath == "" || !whatsappMediaPathBelongsToOrganization(objectPath, organizationID) {
		return "", 0, ErrMessageNotFound
	}
	if deadline != nil {
		// The Storage client can wait up to 20s. Reserve a little more than
		// that before the CRM deadline so the provider-issued token cannot
		// outlive the seven-day window while this request is in flight.
		const signingSafetySeconds = 25
		remaining := int(time.Until(*deadline).Seconds()) - signingSafetySeconds
		if remaining < 1 {
			return "", 0, ErrMessageNotFound
		}
		if remaining > whatsappMediaSignedURLTTLSeconds {
			remaining = whatsappMediaSignedURLTTLSeconds
		}
		signedURL, err := repo.storage.signedURL(ctx, whatsappMediaBucket, objectPath, remaining)
		if err != nil || signedURL == "" {
			return signedURL, 0, err
		}
		if !time.Now().Before(*deadline) {
			return "", 0, ErrMessageNotFound
		}
		// Bypass the path-only cache: the same deduplicated asset can also
		// belong to a lead whose URL has the ordinary fifteen-minute TTL.
		return signedURL, remaining, nil
	}

	if entry, ok := whatsappMediaSignedURLCache.Load(objectPath); ok {
		if entry.url != "" {
			remaining := int(time.Until(entry.expiresAt) / time.Second)
			if remaining < 1 {
				remaining = 1
			}
			return entry.url, remaining, nil
		}
	}

	signedURL, err := repo.storage.signedURL(ctx, whatsappMediaBucket, objectPath, whatsappMediaSignedURLTTLSeconds)
	if err != nil {
		return "", 0, err
	}
	if signedURL == "" {
		return "", 0, nil
	}
	cacheTTL := time.Duration(whatsappMediaSignedURLTTLSeconds)*time.Second - whatsappMediaSignedURLCacheSkew
	if cacheTTL <= 0 {
		cacheTTL = time.Duration(whatsappMediaSignedURLTTLSeconds) * time.Second
	}
	whatsappMediaSignedURLCache.Store(objectPath, cachedWhatsAppMediaSignedURL{
		url:       signedURL,
		expiresAt: time.Now().Add(cacheTTL),
	})
	return signedURL, int(cacheTTL / time.Second), nil
}

func (repo Repository) hydrateMessageMediaURLs(ctx context.Context, organizationID string, messages []Message) error {
	return repo.prepareMessageMediaURLs(ctx, organizationID, messages, true)
}

func (repo Repository) prepareMessageMediaURLs(ctx context.Context, organizationID string, messages []Message, includeSignedURLs bool) error {
	type pendingMediaURL struct {
		index    int
		path     string
		deadline *time.Time
	}

	pending := make([]pendingMediaURL, 0)
	accessByConversation := make(map[string]whatsAppNonLeadMediaAccess)
	for index := range messages {
		if messages[index].MediaURL == nil && (messages[index].MediaStoragePath == nil || *messages[index].MediaStoragePath == "") {
			continue
		}
		access, known := accessByConversation[messages[index].ConversationID]
		if !known {
			var err error
			access, err = repo.whatsAppNonLeadMediaAccess(ctx, organizationID, messages[index].ConversationID)
			if err != nil {
				return err
			}
			accessByConversation[messages[index].ConversationID] = access
		}
		if !access.allowed || access.deadline != nil {
			// A stored media_url can be a public or already signed Storage URL.
			// It must never be the fallback for an active nonlead retention cycle,
			// including when signing fails or the caller requested lazy media.
			messages[index].MediaURL = nil
		}
		if !access.allowed || !includeSignedURLs || messages[index].MediaStoragePath == nil ||
			*messages[index].MediaStoragePath == "" ||
			messages[index].MessageType == "text" || messages[index].MessageType == "reaction" {
			continue
		}
		objectPath := *messages[index].MediaStoragePath
		if !whatsappMediaPathBelongsToOrganization(objectPath, organizationID) {
			// Never ask the service-role Storage client to sign an object outside
			// the tenant represented by the authorized repository query.
			messages[index].MediaURL = nil
			continue
		}
		pending = append(pending, pendingMediaURL{index: index, path: objectPath, deadline: access.deadline})
	}

	if len(pending) == 0 {
		return nil
	}

	var wg sync.WaitGroup
	limit := make(chan struct{}, 6)
	for _, item := range pending {
		item := item
		wg.Add(1)
		go func() {
			defer wg.Done()
			select {
			case limit <- struct{}{}:
				defer func() { <-limit }()
			case <-ctx.Done():
				return
			}

			signedURL, _, err := repo.signedWhatsAppMessageMediaURLWithDeadline(
				ctx, organizationID, item.path, item.deadline,
			)
			if err != nil || signedURL == "" {
				return
			}
			messages[item.index].MediaURL = &signedURL
		}()
	}

	wg.Wait()
	return nil
}

func (repo Repository) ensureCanManageSession(ctx context.Context, tenantContext tenant.Context, sessionID string) error {
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
			left join public.leads l on l.id = wc.lead_id
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
// can only be linked by the session owner.
func (repo Repository) ensureCanLinkConversation(ctx context.Context, tenantContext tenant.Context, conversationID string) error {
	var allowed bool
	args := append(baseConversationArgs(tenantContext), conversationID)
	err := repo.db.Pool().QueryRow(ctx, `
		select exists (
			select 1
			from public.whatsapp_conversations wc
			left join public.whatsapp_sessions ws on ws.id = wc.session_id
			left join public.leads l on l.id = wc.lead_id
			where wc.organization_id = $1::uuid
			  and wc.deleted_at is null
			  and wc.id = $5::uuid
			  and (
				wc.lead_id is not null
				or not exists (
					select 1
					from private.whatsapp_nonlead_retention_candidates as retention
					where retention.conversation_id = wc.id
					  and retention.organization_id = wc.organization_id
					  and private.whatsapp_nonlead_retention_candidate_active(
					    retention.organization_id, retention.session_id, retention.conversation_id
					  )
					  and retention.state in ('pending', 'purging')
					  and retention.expires_at <= now()
				)
			  )
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
					and ws.owner_user_id = $2::uuid
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
		(
			select candidate.expires_at
			from private.whatsapp_nonlead_retention_candidates as candidate
			where candidate.conversation_id = wc.id
			  and candidate.organization_id = wc.organization_id
			  and private.whatsapp_nonlead_retention_candidate_active(
			    candidate.organization_id, candidate.session_id, candidate.conversation_id
			  )
			  and candidate.state = 'pending'
			  and wc.lead_id is null
		),
		ws.id::text,
		ws.instance_name,
		ws.phone_number,
		ws.status,
		ws.organization_id::text,
		ws.provider,
		l.id::text,
		l.name,
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
		), '[]'::jsonb)::text`
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
		null::timestamptz,
		ws.id::text,
		ws.instance_name,
		ws.phone_number,
		ws.status,
		ws.organization_id::text,
		ws.provider,
		l.id::text,
		l.name,
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
		), '[]'::jsonb)::text`
}

func messageSelectFields() string {
	return messageSelectFieldsWithSession("wm.session_id")
}

func messageSelectFieldsWithSession(sessionExpression string) string {
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
		coalesce(wm.sent_at, wm.created_at),
		wm.delivered_at,
		wm.read_at,
		wm.sender_jid,
		wm.sender_name`
}

func scanSession(row scanner) (Session, error) {
	var session Session
	var ownerID, ownerName, ownerEmail pgtype.Text
	var displayName, instanceID, phoneNumber, profileName, profilePicture pgtype.Text
	var lastConnectedAt pgtype.Timestamptz
	var settingsJSON string

	if err := row.Scan(
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
	); err != nil {
		return Session{}, err
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
	var conversation Conversation
	var conversationSessionID pgtype.Text
	var leadID, contactName, contactPhone, contactPicture, contactPresence, lastMessage pgtype.Text
	var presenceUpdatedAt, lastMessageAt, archivedAt, deletedAt, nonleadExpiresAt pgtype.Timestamptz
	var sessionID, sessionInstanceName, sessionPhone, sessionStatus, sessionOrgID, sessionProvider pgtype.Text
	var leadRefID, leadName, leadAvatar, leadPipelineID, leadStageID pgtype.Text
	var leadAssigneeID, leadAssigneeName, leadAssigneeAvatar pgtype.Text
	var pipelineID, pipelineName, stageID, stageName, stageColor pgtype.Text
	var tagsJSON string

	if err := row.Scan(
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
		&nonleadExpiresAt,
		&sessionID,
		&sessionInstanceName,
		&sessionPhone,
		&sessionStatus,
		&sessionOrgID,
		&sessionProvider,
		&leadRefID,
		&leadName,
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
	); err != nil {
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
	conversation.ArchivedAt = timePtr(archivedAt)
	conversation.DeletedAt = timePtr(deletedAt)
	conversation.NonleadExpiresAt = timePtr(nonleadExpiresAt)

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
	var remoteJID, reactionToMessageID, reactionEmoji, reactionSenderJID, reactionSenderName pgtype.Text
	var mediaSize pgtype.Int8
	var deliveredAt, readAt pgtype.Timestamptz
	var senderJID, senderName pgtype.Text
	var metadataJSON string

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
		&message.SentAt,
		&deliveredAt,
		&readAt,
		&senderJID,
		&senderName,
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
	message.DeliveredAt = timePtr(deliveredAt)
	message.ReadAt = timePtr(readAt)
	message.SenderJID = textPtr(senderJID)
	message.SenderName = textPtr(senderName)

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

func conversationVisibilitySQL(canViewOwn bool) string {
	return `(
		(
			wc.lead_id is not null
			or not exists (
				select 1
				from private.whatsapp_nonlead_retention_candidates as retention
				where retention.conversation_id = wc.id
				  and retention.organization_id = wc.organization_id
				  and private.whatsapp_nonlead_retention_candidate_active(
				    retention.organization_id, retention.session_id, retention.conversation_id
				  )
				  and retention.state in ('pending', 'purging')
				  and retention.expires_at <= now()
			)
		)
		and
		ws.id is not null
		and ws.organization_id = wc.organization_id
		and ws.provider = 'evolution_go'
		and coalesce(ws.is_active, true) = true
		and coalesce(ws.status, '') <> 'deleted'
		and (
			(
				wc.lead_id is not null
				and l.id is not null
				and l.organization_id = wc.organization_id
				and ` + leadVisibilitySQL(canViewOwn) + `
				and (
					ws.owner_user_id = $2::uuid
					or (
						l.assigned_user_id = $2::uuid
						and ` + sessionGrantExistsSQL("ws", "$2::uuid", false) + `
					)
				)
			)
			or (
				wc.lead_id is null
				and ws.owner_user_id = $2::uuid
			)
		)
	)`
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
			and exists (
				select 1
				from public.leads historical_lead
				where historical_lead.organization_id = wm.organization_id
				  and ` + recordedPreLeadBindingMatchSQL("historical_lead.id") + `
				  and ` + leadscope.VisibilitySQL("historical_lead", "$3", "$2", "$4", canViewOwn) + `
			)
		)
		or (
			wm.lead_id is null
			and wc.lead_id is null
			and wc.deleted_at is null
			and not exists (
				select 1
				from private.whatsapp_nonlead_retention_candidates as retention
				where retention.conversation_id = wc.id
				  and retention.organization_id = wc.organization_id
				  and private.whatsapp_nonlead_retention_candidate_active(
				    retention.organization_id, retention.session_id, retention.conversation_id
				  )
				  and retention.state in ('pending', 'purging')
				  and retention.expires_at <= now()
			)
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

// Only read paths bridge a newly recorded pre-lead message to the first
// explicit card binding. Mutating paths keep the exact message-level match.
func conversationReadableMessageLeadMatchSQL() string {
	return "(" + conversationMessageLeadMatchSQL() + " or (wc.lead_id is not null and " + recordedPreLeadBindingMatchSQL("wc.lead_id") + "))"
}

// The first non-stale binding is the only card that may inherit history
// recorded while this same conversation and session had no lead. Database
// creation time proves the message existed before the binding; provider time
// alone can be delayed or replayed. Legacy NULL and quarantine rows never
// gain a card from the current mutable conversation state.
func recordedPreLeadBindingMatchSQL(leadExpression string) string {
	return `(
		wm.lead_id is null
		and wm.capture_state = 'recorded'
		and wm.from_me = false
		and wm.session_id is not null
		and exists (
			select 1
			from public.whatsapp_conversation_lead_bindings first_binding
			where first_binding.organization_id = wm.organization_id
			  and first_binding.conversation_id = wm.conversation_id
			  and first_binding.session_id = wm.session_id
			  and first_binding.lead_id = ` + leadExpression + `
			  and first_binding.previous_lead_id is null
			  and first_binding.changed = true
			  and first_binding.stale = false
			  and wm.created_at < first_binding.active_from
			  and first_binding.id = (
				select earliest_binding.id
				from public.whatsapp_conversation_lead_bindings earliest_binding
				where earliest_binding.organization_id = wm.organization_id
				  and earliest_binding.conversation_id = wm.conversation_id
				  and earliest_binding.session_id = wm.session_id
				  and earliest_binding.stale = false
				order by earliest_binding.active_from asc, earliest_binding.id asc
				limit 1
			  )
		)
	)`
}

// Lead history keeps immutable message-level attribution and only the
// provenance-backed pre-lead bridge above. It never uses the current card.
func leadHistoryMessageLeadMatchSQL() string {
	return "(wm.lead_id = $5::uuid or " + recordedPreLeadBindingMatchSQL("$5::uuid") + ")"
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
