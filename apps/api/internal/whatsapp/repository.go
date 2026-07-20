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
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/searchtext"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

const whatsappMediaSignedURLTTLSeconds = 24 * 60 * 60
const whatsappMediaSignedURLCacheSkew = time.Minute

type cachedWhatsAppMediaSignedURL struct {
	url       string
	expiresAt time.Time
}

var whatsappMediaSignedURLCache sync.Map

type GamificationRecorder interface {
	RecordAction(ctx context.Context, tenantContext tenant.Context, actionType string, quantity int, referenceID string) error
}

type Repository struct {
	db                   *dbpkg.Postgres
	storage              storageClient
	functions            functionsClient
	gamificationRecorder GamificationRecorder
}

type scanner interface {
	Scan(dest ...any) error
}

func NewRepository(db *dbpkg.Postgres, gamificationRecorder GamificationRecorder, storageConfig StorageConfig) Repository {
	return Repository{
		db:                   db,
		storage:              newStorageClient(storageConfig),
		functions:            newFunctionsClient(storageConfig, db),
		gamificationRecorder: gamificationRecorder,
	}
}

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
		  and ws.owner_user_id = $2::uuid
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

	return []SessionAccess{}, nil
}

func (repo Repository) GrantSessionAccess(ctx context.Context, tenantContext tenant.Context, sessionID string, input grantAccessInput) error {
	sessionID, ok := normalizeUUID(sessionID)
	if !ok {
		return ErrSessionNotFound
	}
	if err := repo.ensureCanManageSession(ctx, tenantContext, sessionID); err != nil {
		return err
	}

	return fmt.Errorf("%w: compartilhamento de conexoes WhatsApp desativado por privacidade", ErrFeatureUnavailable)
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
	if err := repo.ensureCanManageSession(ctx, tenantContext, sessionID); err != nil {
		return err
	}

	_, err := repo.db.Pool().Exec(ctx, `
		delete from public.whatsapp_session_access
		where organization_id = $1::uuid
		  and session_id = $2::uuid
		  and user_id = $3::uuid
	`, tenantContext.OrganizationID, sessionID, userID)
	return err
}

func (repo Repository) ListConversations(ctx context.Context, tenantContext tenant.Context, filter ConversationListFilter) ([]Conversation, error) {
	if filter.AccessibleProvided && len(filter.SessionIDs) == 0 {
		return []Conversation{}, nil
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
			return nil, fmt.Errorf("%w: sessionId is invalid", ErrInvalidInput)
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
				return nil, fmt.Errorf("%w: sessionIds contains invalid uuid", ErrInvalidInput)
			}
			if seenSessionIDs[normalized] {
				continue
			}
			seenSessionIDs[normalized] = true
			args = append(args, normalized)
			placeholders = append(placeholders, fmt.Sprintf("$%d::uuid", len(args)))
		}
		if len(placeholders) == 0 {
			return []Conversation{}, nil
		}
		where = append(where, "wc.session_id in ("+strings.Join(placeholders, ", ")+")")
	}
	if filter.HideGroups {
		where = append(where, "wc.is_group = false")
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
			searchClauses = append(searchClauses, fmt.Sprintf("regexp_replace(coalesce(wc.contact_phone, ''), '\\D', '', 'g') like $%d", phoneArg))
		}
		where = append(where, "("+strings.Join(searchClauses, " or ")+")")
	}
	args = append(args, filter.Limit)
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
		return nil, err
	}
	defer rows.Close()

	conversations := []Conversation{}
	for rows.Next() {
		conversation, err := scanConversation(rows)
		if err != nil {
			return nil, err
		}
		conversations = append(conversations, conversation)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return conversations, nil
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

	return repo.resolveConversationLead(ctx, tenantContext, conversation)
}

func (repo Repository) ListMessages(ctx context.Context, tenantContext tenant.Context, conversationID string, filter MessageFilter) (MessagePage, error) {
	conversationID, ok := normalizeUUID(conversationID)
	if !ok {
		return MessagePage{}, ErrConversationNotFound
	}
	if err := repo.ensureCanViewConversation(ctx, tenantContext, conversationID); err != nil {
		return MessagePage{}, err
	}

	args := []any{tenantContext.OrganizationID, conversationID, filter.Limit}
	where := []string{
		"wm.organization_id = $1::uuid",
		"wm.conversation_id = $2::uuid",
		conversationMessageLeadMatchSQL(),
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
		where `+strings.Join(where, " and ")+`
		order by coalesce(wm.sent_at, wm.created_at) desc, wm.id desc
		limit $3::integer
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
	if err := repo.hydrateMessageMediaURLs(ctx, tenantContext.OrganizationID, messages); err != nil {
		return MessagePage{}, err
	}

	return MessagePage{Messages: messages, NextCursor: nextCursor}, nil
}

func (repo Repository) MarkConversationAsRead(ctx context.Context, tenantContext tenant.Context, conversationID string) error {
	conversationID, ok := normalizeUUID(conversationID)
	if !ok {
		return ErrConversationNotFound
	}
	if err := repo.ensureCanViewConversation(ctx, tenantContext, conversationID); err != nil {
		return err
	}

	_, err := repo.db.Pool().Exec(ctx, `
		update public.whatsapp_conversations
		set unread_count = 0,
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, tenantContext.OrganizationID, conversationID)
	return err
}

func (repo Repository) ArchiveConversation(ctx context.Context, tenantContext tenant.Context, conversationID string, archive bool) error {
	conversationID, ok := normalizeUUID(conversationID)
	if !ok {
		return ErrConversationNotFound
	}
	if err := repo.ensureCanEditConversation(ctx, tenantContext, conversationID); err != nil {
		return err
	}

	_, err := repo.db.Pool().Exec(ctx, `
		update public.whatsapp_conversations
		set archived_at = case when $3::boolean then now() else null end,
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, tenantContext.OrganizationID, conversationID, archive)
	return err
}

func (repo Repository) DeleteConversation(ctx context.Context, tenantContext tenant.Context, conversationID string) error {
	conversationID, ok := normalizeUUID(conversationID)
	if !ok {
		return ErrConversationNotFound
	}

	// Deleting a conversation removes it from the operational inbox. It is a
	// privileged action: lead visibility alone is deliberately insufficient.
	// Historical messages remain available through the lead history endpoint.
	tag, err := repo.db.Pool().Exec(ctx, `
		update public.whatsapp_conversations wc
		set deleted_at = now(),
		    updated_at = now()
		from public.whatsapp_sessions ws
		where wc.organization_id = $1::uuid
		  and wc.id = $2::uuid
		  and wc.deleted_at is null
		  and ws.id = wc.session_id
		  and ws.organization_id = wc.organization_id
		  and ws.provider = 'evolution_go'
		  and coalesce(ws.is_active, true) = true
		  and coalesce(ws.status, '') <> 'deleted'
		  and (ws.owner_user_id = $3::uuid or $4::boolean)
	`, tenantContext.OrganizationID, conversationID, tenantContext.UserID, canManageWhatsApp(tenantContext))
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrConversationNotFound
	}
	return nil
}

func (repo Repository) LinkConversationToLead(ctx context.Context, tenantContext tenant.Context, conversationID string, leadID string) error {
	conversationID, ok := normalizeUUID(conversationID)
	if !ok {
		return ErrConversationNotFound
	}
	leadID, ok = normalizeUUID(leadID)
	if !ok {
		return ErrInvalidReference
	}
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	args := append(baseConversationArgs(tenantContext), canManageWhatsApp(tenantContext), conversationID)
	var remoteJID, contactPhone string
	var isGroup bool
	err = tx.QueryRow(ctx, `
		select wc.remote_jid, coalesce(wc.contact_phone, ''), wc.is_group
		from public.whatsapp_conversations wc
		join public.whatsapp_sessions ws
		  on ws.id = wc.session_id
		 and ws.organization_id = wc.organization_id
		left join public.leads l
		  on l.id = wc.lead_id
		 and l.organization_id = wc.organization_id
		where wc.organization_id = $1::uuid
		  and wc.id = $6::uuid
		  and wc.deleted_at is null
		  and ws.provider = 'evolution_go'
		  and coalesce(ws.is_active, true) = true
		  and coalesce(ws.status, '') <> 'deleted'
		  and (
			(
			  wc.lead_id is not null
			  and l.id is not null
			  and `+leadVisibilitySQL(canViewOwnWhatsAppLeads(tenantContext))+`
			)
			or (
			  wc.lead_id is null
			  and (ws.owner_user_id = $2::uuid or $5::boolean)
			)
		  )
		for update of wc
	`, args...).Scan(&remoteJID, &contactPhone, &isGroup)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrConversationNotFound
	}
	if err != nil {
		return err
	}

	identity := newWhatsAppContactIdentity(contactPhone, remoteJID, isGroup)
	if err := ensureAccessibleLeadMatchesIdentity(ctx, tx, tenantContext, leadID, identity); err != nil {
		return fmt.Errorf("%w: a conversa e o lead possuem telefones diferentes", err)
	}

	tag, err := tx.Exec(ctx, `
		update public.whatsapp_conversations
		set lead_id = $3::uuid,
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, tenantContext.OrganizationID, conversationID, leadID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrConversationNotFound
	}

	if _, err := tx.Exec(ctx, `
		update public.whatsapp_messages
		set lead_id = $3::uuid
		where organization_id = $1::uuid
		  and conversation_id = $2::uuid
		  and lead_id is null
	`, tenantContext.OrganizationID, conversationID, leadID); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

func (repo Repository) hydrateMessageMediaURLs(ctx context.Context, organizationID string, messages []Message) error {
	type pendingMediaURL struct {
		index int
		path  string
	}

	pending := make([]pendingMediaURL, 0)
	now := time.Now()

	for index := range messages {
		if messages[index].MediaStoragePath == nil || *messages[index].MediaStoragePath == "" {
			continue
		}
		if messages[index].MessageType == "text" || messages[index].MessageType == "reaction" {
			continue
		}

		objectPath := *messages[index].MediaStoragePath
		if !whatsappMediaPathBelongsToOrganization(objectPath, organizationID) {
			// Never ask the service-role Storage client to sign an object outside
			// the tenant represented by the authorized repository query.
			messages[index].MediaURL = nil
			continue
		}
		if cached, ok := whatsappMediaSignedURLCache.Load(objectPath); ok {
			entry, ok := cached.(cachedWhatsAppMediaSignedURL)
			if ok && entry.url != "" && entry.expiresAt.After(now) {
				url := entry.url
				messages[index].MediaURL = &url
				continue
			}
			whatsappMediaSignedURLCache.Delete(objectPath)
		}

		pending = append(pending, pendingMediaURL{index: index, path: objectPath})
	}

	if len(pending) == 0 {
		return nil
	}

	var wg sync.WaitGroup
	limit := make(chan struct{}, 6)
	cacheTTL := time.Duration(whatsappMediaSignedURLTTLSeconds)*time.Second - whatsappMediaSignedURLCacheSkew
	if cacheTTL <= 0 {
		cacheTTL = time.Duration(whatsappMediaSignedURLTTLSeconds) * time.Second
	}

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

			signedURL, err := repo.storage.signedURL(ctx, "whatsapp-media", item.path, whatsappMediaSignedURLTTLSeconds)
			if err != nil || signedURL == "" {
				return
			}
			messages[item.index].MediaURL = &signedURL
			whatsappMediaSignedURLCache.Store(item.path, cachedWhatsAppMediaSignedURL{
				url:       signedURL,
				expiresAt: time.Now().Add(cacheTTL),
			})
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
	var ok bool
	args := append(baseConversationArgs(tenantContext), conversationID)
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
			left join public.leads l on l.id = wc.lead_id
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
		coalesce(wc.session_id::text, ''),
		$5::uuid::text,
		coalesce(history.remote_jid, case when wc.lead_id = $5::uuid then wc.remote_jid end, ''),
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
	var leadID, contactName, contactPhone, contactPicture, contactPresence, lastMessage pgtype.Text
	var presenceUpdatedAt, lastMessageAt, archivedAt, deletedAt pgtype.Timestamptz
	var sessionID, sessionInstanceName, sessionPhone, sessionStatus, sessionOrgID, sessionProvider pgtype.Text
	var leadRefID, leadName, leadAvatar, leadPipelineID, leadStageID pgtype.Text
	var leadAssigneeID, leadAssigneeName, leadAssigneeAvatar pgtype.Text
	var pipelineID, pipelineName, stageID, stageName, stageColor pgtype.Text
	var tagsJSON string

	if err := row.Scan(
		&conversation.ID,
		&conversation.SessionID,
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
	conversation.ContactName = textPtr(contactName)
	conversation.ContactPhone = textPtr(contactPhone)
	conversation.ContactPicture = textPtr(contactPicture)
	conversation.ContactPresence = textPtr(contactPresence)
	conversation.PresenceUpdatedAt = timePtr(presenceUpdatedAt)
	conversation.LastMessage = textPtr(lastMessage)
	conversation.LastMessageAt = timePtr(lastMessageAt)
	conversation.ArchivedAt = timePtr(archivedAt)
	conversation.DeletedAt = timePtr(deletedAt)

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

// A conversation timeline follows the conversation's current lead, while
// preserving old rows that predate message-level lead attribution.
func conversationMessageLeadMatchSQL() string {
	return "(wm.lead_id is null or wm.lead_id = wc.lead_id)"
}

// Lead history treats a non-null message lead as immutable evidence. The
// conversation lead is only a compatibility fallback for legacy null rows.
func leadHistoryMessageLeadMatchSQL() string {
	return "(wm.lead_id = $5::uuid or (wm.lead_id is null and wc.lead_id = $5::uuid))"
}

func leadVisibilitySQL(canViewOwn bool) string {
	canViewOwnSQL := "false"
	if canViewOwn {
		canViewOwnSQL = "true"
	}
	return `(
		$3::boolean
		or (` + canViewOwnSQL + ` and l.assigned_user_id = $2::uuid)
		or (
			$4::boolean
			and (
				(
					nullif(to_jsonb(l)->>'team_id', '') is not null
					and exists (
						select 1 from public.team_members leader
						where leader.organization_id = l.organization_id
						  and leader.user_id = $2::uuid
						  and leader.team_id::text = to_jsonb(l)->>'team_id'
						  and coalesce(leader.is_active, true) = true
						  and coalesce(leader.is_leader, false) = true
					)
				)
				or (
					nullif(to_jsonb(l)->>'team_id', '') is null
					and l.assigned_user_id is not null
					and exists (
						select 1
						from public.team_members leader
						join public.team_members member
						  on member.organization_id = leader.organization_id
						 and member.team_id = leader.team_id
						 and coalesce(member.is_active, true) = true
						where leader.organization_id = l.organization_id
						  and leader.user_id = $2::uuid
						  and coalesce(leader.is_active, true) = true
						  and coalesce(leader.is_leader, false) = true
						  and member.user_id = l.assigned_user_id
					)
				)
			)
		)
	)`
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
	if !value.Valid {
		return nil
	}

	return &value.String
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
