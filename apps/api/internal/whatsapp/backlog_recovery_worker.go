package whatsapp

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"sync/atomic"
	"time"

	"github.com/jackc/pgx/v5"
)

// Etapa 2: recuperacao silenciosa do backlog suprimido.
//
// O processamento do backlog grava cada mensagem como uma linha suprimida
// (sem conteudo) e retem o envelope bruto processado por sete dias. Este
// worker varre esses envelopes de madrugada, reextrai o conteudo com o mesmo
// parser do caminho vivo e recupera a linha suprimida por UPDATE:
//   - conversa com lead do dono da conexao  -> capture_state = 'captured'
//   - conversa sem lead (caixa "Sem lead")  -> capture_state = 'unlinked_ephemeral'
//   - lead de outro responsavel             -> permanece suprimida (card alheio
//     nunca recebe historico de conexao alheia)
//
// UPDATE nunca dispara os gatilhos AFTER INSERT de automacao, atencao,
// avatar ou handoff, entao nenhuma automacao antiga e executada e nenhum
// aviso e gerado: a recuperacao nao mexe em unread_count. O cursor unico em
// private.whatsapp_backlog_recovery_checkpoint serializa as replicas via
// FOR UPDATE SKIP LOCKED.

const (
	defaultWhatsAppBacklogRecoveryBatch     = 40
	maxWhatsAppBacklogRecoveryBatch         = 200
	defaultWhatsAppBacklogRecoveryWindowUTC = "04:00-09:30" // 01:00-06:30 em America/Sao_Paulo
	whatsAppBacklogRecoveryActiveInterval   = time.Second
	whatsAppBacklogRecoveryIdleInterval     = time.Minute
	whatsAppBacklogRecoveryErrorInterval    = 10 * time.Second
	whatsAppBacklogRecoverySchemaRetry      = 30 * time.Second
)

type backlogRecoveryCounters struct {
	cycles             atomic.Uint64
	envelopesScanned   atomic.Uint64
	messagesExamined   atomic.Uint64
	recoveredLead      atomic.Uint64
	recoveredUnlinked  atomic.Uint64
	skippedForeignLead atomic.Uint64
	skippedMissingRow  atomic.Uint64
	skippedSession     atomic.Uint64
	skippedOther       atomic.Uint64
	mediaJobsQueued    atomic.Uint64
	errorsTotal        atomic.Uint64
	lastCycleMillis    atomic.Int64
	lastProgressMillis atomic.Int64
	windowOpen         atomic.Bool
}

var whatsappBacklogRecoveryStats backlogRecoveryCounters

func (stats *backlogRecoveryCounters) snapshot() map[string]any {
	formatMillis := func(value int64) any {
		if value <= 0 {
			return nil
		}
		return time.UnixMilli(value).UTC().Format(time.RFC3339)
	}
	return map[string]any{
		"cycles":             stats.cycles.Load(),
		"envelopesScanned":   stats.envelopesScanned.Load(),
		"messagesExamined":   stats.messagesExamined.Load(),
		"recoveredLead":      stats.recoveredLead.Load(),
		"recoveredUnlinked":  stats.recoveredUnlinked.Load(),
		"skippedForeignLead": stats.skippedForeignLead.Load(),
		"skippedMissingRow":  stats.skippedMissingRow.Load(),
		"skippedSession":     stats.skippedSession.Load(),
		"skippedOther":       stats.skippedOther.Load(),
		"mediaJobsQueued":    stats.mediaJobsQueued.Load(),
		"errors":             stats.errorsTotal.Load(),
		"windowOpen":         stats.windowOpen.Load(),
		"lastCycleAt":        formatMillis(stats.lastCycleMillis.Load()),
		"lastProgressAt":     formatMillis(stats.lastProgressMillis.Load()),
	}
}

// backlogRecoveryWindowOpen interpreta "HH:MM-HH:MM" em UTC, com suporte a
// janelas que cruzam a meia-noite. Janela vazia ou "always" significa sempre.
func backlogRecoveryWindowOpen(now time.Time, window string) bool {
	start, end, ok := parseBacklogRecoveryWindow(window)
	if !ok {
		return true
	}
	minute := now.Hour()*60 + now.Minute()
	if start == end {
		return true
	}
	if start < end {
		return minute >= start && minute < end
	}
	return minute >= start || minute < end
}

func parseBacklogRecoveryWindow(window string) (int, int, bool) {
	window = strings.TrimSpace(window)
	if window == "" || strings.EqualFold(window, "always") {
		return 0, 0, false
	}
	parts := strings.SplitN(window, "-", 2)
	if len(parts) != 2 {
		return 0, 0, false
	}
	parse := func(value string) (int, bool) {
		parsed, err := time.Parse("15:04", strings.TrimSpace(value))
		if err != nil {
			return 0, false
		}
		return parsed.Hour()*60 + parsed.Minute(), true
	}
	start, ok := parse(parts[0])
	if !ok {
		return 0, 0, false
	}
	end, ok := parse(parts[1])
	if !ok {
		return 0, 0, false
	}
	return start, end, true
}

func (handler Handler) StartBacklogRecoveryWorker(ctx context.Context, logger *slog.Logger) {
	config := handler.workerConfig.normalized()
	if !config.BacklogRecoveryWorkerEnabled {
		return
	}
	if logger == nil {
		logger = slog.Default()
	}
	if _, _, ok := parseBacklogRecoveryWindow(config.BacklogRecoveryWindowUTC); !ok &&
		strings.TrimSpace(config.BacklogRecoveryWindowUTC) != "" &&
		!strings.EqualFold(strings.TrimSpace(config.BacklogRecoveryWindowUTC), "always") {
		logger.Warn("whatsapp backlog recovery window invalida; rodando sem janela",
			"windowUTC", config.BacklogRecoveryWindowUTC)
	}
	go func() {
		for {
			if err := handler.repo.ensureBacklogRecoverySchema(ctx); err == nil {
				break
			} else if !errors.Is(err, context.Canceled) {
				logger.Error("whatsapp backlog recovery aguardando migracao da etapa 2", "error", err)
			}
			select {
			case <-ctx.Done():
				return
			case <-time.After(whatsAppBacklogRecoverySchemaRetry):
			}
		}
		logger.Info("whatsapp backlog recovery worker iniciado",
			"windowUTC", config.BacklogRecoveryWindowUTC,
			"batch", config.BacklogRecoveryBatch)
		for {
			var wait time.Duration
			if !backlogRecoveryWindowOpen(time.Now().UTC(), config.BacklogRecoveryWindowUTC) {
				whatsappBacklogRecoveryStats.windowOpen.Store(false)
				wait = whatsAppBacklogRecoveryIdleInterval
			} else {
				whatsappBacklogRecoveryStats.windowOpen.Store(true)
				scanned, err := handler.repo.runBacklogRecoveryBatch(ctx, config.BacklogRecoveryBatch)
				switch {
				case err != nil:
					if errors.Is(err, context.Canceled) {
						return
					}
					whatsappBacklogRecoveryStats.errorsTotal.Add(1)
					logger.Error("whatsapp backlog recovery batch falhou", "error", err)
					wait = whatsAppBacklogRecoveryErrorInterval
				case scanned == 0:
					wait = whatsAppBacklogRecoveryIdleInterval
				default:
					wait = whatsAppBacklogRecoveryActiveInterval
				}
			}
			select {
			case <-ctx.Done():
				return
			case <-time.After(wait):
			}
		}
	}()
}

func (repo Repository) ensureBacklogRecoverySchema(ctx context.Context) error {
	var one int
	err := repo.db.Pool().QueryRow(ctx, `
		select 1 from private.whatsapp_backlog_recovery_checkpoint where id = 1
	`).Scan(&one)
	if errors.Is(err, pgx.ErrNoRows) {
		return errors.New("checkpoint da recuperacao do backlog ausente")
	}
	return err
}

type backlogRecoveryEnvelope struct {
	ID             string
	OrganizationID string
	SessionID      string
	Payload        []byte
	CreatedAt      time.Time
}

func (repo Repository) runBacklogRecoveryBatch(ctx context.Context, batch int) (int, error) {
	if batch <= 0 {
		batch = defaultWhatsAppBacklogRecoveryBatch
	}
	tx, err := repo.db.Pool().BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.ReadCommitted})
	if err != nil {
		return 0, err
	}
	defer tx.Rollback(ctx)

	var lastCreatedAt time.Time
	var lastInboxID string
	err = tx.QueryRow(ctx, `
		select last_created_at, last_inbox_id::text
		from private.whatsapp_backlog_recovery_checkpoint
		where id = 1
		for update skip locked
	`).Scan(&lastCreatedAt, &lastInboxID)
	if errors.Is(err, pgx.ErrNoRows) {
		// Outra replica esta com o cursor agora; nada a fazer.
		return 0, nil
	}
	if err != nil {
		return 0, err
	}

	rows, err := tx.Query(ctx, `
		select id::text, organization_id::text, session_id::text, payload, created_at
		from public.whatsapp_webhook_inbox
		where status = 'processed'
		  and (created_at, id) > ($1::timestamptz, $2::uuid)
		  and position('message' in lower(event_type)) > 0
		  and position('receipt' in lower(event_type)) = 0
		order by created_at, id
		limit $3::integer
	`, lastCreatedAt, lastInboxID, batch)
	if err != nil {
		return 0, err
	}
	envelopes := make([]backlogRecoveryEnvelope, 0, batch)
	for rows.Next() {
		var envelope backlogRecoveryEnvelope
		if err := rows.Scan(&envelope.ID, &envelope.OrganizationID, &envelope.SessionID, &envelope.Payload, &envelope.CreatedAt); err != nil {
			rows.Close()
			return 0, err
		}
		envelopes = append(envelopes, envelope)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, err
	}
	if len(envelopes) == 0 {
		if err := tx.Commit(ctx); err != nil {
			return 0, err
		}
		whatsappBacklogRecoveryStats.cycles.Add(1)
		whatsappBacklogRecoveryStats.lastCycleMillis.Store(time.Now().UTC().UnixMilli())
		return 0, nil
	}

	recoveredLead, recoveredUnlinked := 0, 0
	sessions := map[string]*nativeEvolutionSession{}
	for _, envelope := range envelopes {
		leadCount, unlinkedCount, err := repo.recoverBacklogEnvelope(ctx, tx, sessions, envelope)
		if err != nil {
			return 0, fmt.Errorf("envelope %s: %w", envelope.ID, err)
		}
		recoveredLead += leadCount
		recoveredUnlinked += unlinkedCount
	}

	last := envelopes[len(envelopes)-1]
	if _, err := tx.Exec(ctx, `
		update private.whatsapp_backlog_recovery_checkpoint
		set last_created_at = $1::timestamptz,
		    last_inbox_id = $2::uuid,
		    envelopes_scanned = envelopes_scanned + $3::bigint,
		    messages_recovered_lead = messages_recovered_lead + $4::bigint,
		    messages_recovered_unlinked = messages_recovered_unlinked + $5::bigint,
		    updated_at = now()
		where id = 1
	`, last.CreatedAt, last.ID, len(envelopes), recoveredLead, recoveredUnlinked); err != nil {
		return 0, err
	}
	if err := tx.Commit(ctx); err != nil {
		return 0, err
	}

	now := time.Now().UTC().UnixMilli()
	whatsappBacklogRecoveryStats.cycles.Add(1)
	whatsappBacklogRecoveryStats.lastCycleMillis.Store(now)
	whatsappBacklogRecoveryStats.envelopesScanned.Add(uint64(len(envelopes)))
	if recoveredLead > 0 {
		whatsappBacklogRecoveryStats.recoveredLead.Add(uint64(recoveredLead))
	}
	if recoveredUnlinked > 0 {
		whatsappBacklogRecoveryStats.recoveredUnlinked.Add(uint64(recoveredUnlinked))
	}
	if recoveredLead > 0 || recoveredUnlinked > 0 {
		whatsappBacklogRecoveryStats.lastProgressMillis.Store(now)
	}
	return len(envelopes), nil
}

func (repo Repository) recoverBacklogEnvelope(
	ctx context.Context,
	tx pgx.Tx,
	sessions map[string]*nativeEvolutionSession,
	envelope backlogRecoveryEnvelope,
) (int, int, error) {
	payload, err := decodeNativeEvolutionPayload(envelope.Payload)
	if err != nil {
		// Envelope ilegivel nao pode envenenar o lote: segue adiante.
		whatsappBacklogRecoveryStats.skippedOther.Add(1)
		return 0, 0, nil
	}
	messages := extractNativeEvolutionMessages(payload)
	messages = withoutNativeEvolutionHistorySyncControls(messages)
	messages = withoutNativeEvolutionGroupMessages(messages)
	if len(messages) == 0 {
		return 0, 0, nil
	}

	key := envelope.OrganizationID + "|" + envelope.SessionID
	session, cached := sessions[key]
	if !cached {
		loaded, err := loadNativeEvolutionSession(ctx, tx, pendingEvolutionWebhook{
			ID:             envelope.ID,
			OrganizationID: envelope.OrganizationID,
			SessionID:      envelope.SessionID,
		})
		switch {
		case errors.Is(err, ErrSessionNotFound):
			sessions[key] = nil
		case err != nil:
			return 0, 0, err
		default:
			value := loaded
			sessions[key] = &value
		}
		session = sessions[key]
	}
	if session == nil {
		// Conexao inativa/apagada: as linhas suprimidas dela ficam como estao.
		whatsappBacklogRecoveryStats.skippedSession.Add(uint64(len(messages)))
		return 0, 0, nil
	}

	recoveredLead, recoveredUnlinked := 0, 0
	for _, message := range nativeEvolutionMessageProcessingOrder(messages) {
		whatsappBacklogRecoveryStats.messagesExamined.Add(1)
		if strings.TrimSpace(message.ProviderMessageID) == "" ||
			message.IsReaction || message.IsDeletion || message.IsGroup {
			whatsappBacklogRecoveryStats.skippedOther.Add(1)
			continue
		}
		recovered, target, err := recoverSuppressedBacklogMessage(ctx, tx, *session, message, whatsappMediaBackfillPriority)
		if err != nil {
			return recoveredLead, recoveredUnlinked, fmt.Errorf("mensagem %s: %w", message.ProviderMessageID, err)
		}
		if !recovered {
			continue
		}
		if target == "captured" {
			recoveredLead++
		} else {
			recoveredUnlinked++
		}
	}
	return recoveredLead, recoveredUnlinked, nil
}

func recoverSuppressedBacklogMessage(
	ctx context.Context,
	tx pgx.Tx,
	session nativeEvolutionSession,
	message nativeEvolutionMessage,
	mediaPriority int,
) (bool, string, error) {
	var rowID, conversationID, leadID, messageLeadID, direction string
	var isGroup, fromMe, quarantined, scrubbed, retired bool
	err := tx.QueryRow(ctx, `
		select m.id::text, m.conversation_id::text, coalesce(c.lead_id::text, ''),
		       coalesce(m.lead_id::text, ''),
		       coalesce(c.is_group, false), coalesce(m.from_me, false),
		       lower(coalesce(m.direction, 'inbound')),
		       (coalesce(m.metadata, '{}'::jsonb) ? 'lead_resolution_quarantine'),
		       m.unlinked_retention_scrubbed_at is not null,
		       (c.retired_at is not null or c.unlinked_retention_scrubbed_at is not null)
		from public.whatsapp_messages m
		join public.whatsapp_conversations c
		  on c.id = m.conversation_id
		 and c.organization_id = m.organization_id
		where m.organization_id = $1::uuid
		  and m.session_id = $2::uuid
		  and (m.provider_message_id = $3 or (m.provider_message_id is null and m.message_id = $3))
		  and m.capture_state = 'suppressed'
		order by m.id
		limit 1
		for update of m
	`, session.OrganizationID, session.ID, message.ProviderMessageID).Scan(
		&rowID, &conversationID, &leadID, &messageLeadID, &isGroup, &fromMe, &direction,
		&quarantined, &scrubbed, &retired,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		whatsappBacklogRecoveryStats.skippedMissingRow.Add(1)
		return false, "", nil
	}
	if err != nil {
		return false, "", err
	}
	if isGroup || quarantined || scrubbed || retired {
		whatsappBacklogRecoveryStats.skippedOther.Add(1)
		return false, "", nil
	}

	// O gatilho estrito do banco (set_whatsapp_message_context) rejeita
	// qualquer UPDATE em lead_id, entao a recuperacao nunca escreve essa
	// coluna: so recupera quando o contexto da linha ja bate com o da
	// conversa, e pula o raro caso em que o vinculo mudou desde a supressao.
	if messageLeadID != leadID {
		whatsappBacklogRecoveryStats.skippedOther.Add(1)
		return false, "", nil
	}
	target := ""
	if leadID != "" {
		var sessionOwnsLead bool
		if err := tx.QueryRow(ctx, nativeLeadBelongsToSessionOwnerQuery,
			session.OrganizationID, leadID, session.ID,
		).Scan(&sessionOwnsLead); err != nil {
			return false, "", err
		}
		if !sessionOwnsLead {
			// Card de outro responsavel nunca recebe historico de conexao alheia.
			whatsappBacklogRecoveryStats.skippedForeignLead.Add(1)
			return false, "", nil
		}
		target = "captured"
	} else {
		// Restricao do banco: unlinked_ephemeral e inbound sem from_me ou
		// outbound com from_me. Qualquer outra combinacao fica suprimida.
		if fromMe != (direction == "outbound") {
			whatsappBacklogRecoveryStats.skippedOther.Add(1)
			return false, "", nil
		}
		target = "unlinked_ephemeral"
	}

	conversation := nativeEvolutionConversation{
		ID:            conversationID,
		LeadID:        leadID,
		MessageLeadID: leadID,
		RemoteJID:     message.RemoteJID,
	}
	metadata := nativeEvolutionMessageMetadata(message, conversation)
	metadata["whatsapp_attendance_capture"] = map[string]any{
		"state":          target,
		"recovered_from": "backlog_etapa2",
		"recovered_at":   time.Now().UTC().Format(time.RFC3339Nano),
	}

	mediaStatus := ""
	if nativeIsMediaType(message.MessageType) {
		if message.MediaStoragePath != "" {
			mediaStatus = "ready"
		} else {
			mediaStatus = "pending"
		}
	}

	if _, err := tx.Exec(ctx, `
		update public.whatsapp_messages
		set content = nullif($2, ''),
		    media_url = nullif($3, ''),
		    media_mime_type = nullif($4, ''),
		    media_storage_path = nullif($5, ''),
		    media_size = nullif($6::bigint, 0),
		    media_status = nullif($7, ''),
		    media_error = null,
		    sender_jid = coalesce(sender_jid, nullif($8, '')),
		    sender_name = coalesce(sender_name, nullif($9, '')),
		    capture_state = $10,
		    metadata = coalesce(metadata, '{}'::jsonb) || $11::jsonb,
		    updated_at = now()
		where id = $1::uuid and capture_state = 'suppressed'
	`, rowID, message.Content, message.MediaURL, message.MediaMimeType,
		message.MediaStoragePath, message.MediaSize, mediaStatus,
		message.SenderJID, message.SenderName, target, jsonb(metadata)); err != nil {
		return false, "", err
	}

	if nativeIsMediaType(message.MessageType) && message.MediaStoragePath == "" {
		queued, queueErr := enqueueNativeEvolutionMediaJobWithPriority(ctx, tx, session, conversationID, message, rowID, mediaPriority)
		if queueErr != nil {
			return false, "", queueErr
		}
		if queued {
			whatsappBacklogRecoveryStats.mediaJobsQueued.Add(1)
		}
	}

	// Previa monotonica da conversa, sem tocar em unread_count: recuperacao
	// nunca gera aviso nem marca conversa como nao lida. O pushName e o
	// telefone resolvido do contato preenchem cartoes "@lid" sem identidade.
	contactName, contactPhone := "", ""
	if !message.FromMe {
		contactName = firstNonEmpty(message.ContactName, message.SenderName)
		contactPhone = message.ContactPhone
	}
	if _, err := tx.Exec(ctx, `
		update public.whatsapp_conversations
		set last_message = case when last_message_at is null or last_message_at <= $4 then $5 else last_message end,
		    last_message_preview = case when last_message_at is null or last_message_at <= $4 then $5 else last_message_preview end,
		    last_message_at = greatest(coalesce(last_message_at, $4), $4),
		    contact_name = coalesce(contact_name, nullif($6, '')),
		    contact_phone = coalesce(contact_phone, nullif($7, '')),
		    updated_at = now()
		where organization_id = $1::uuid and session_id = $2::uuid and id = $3::uuid
	`, session.OrganizationID, session.ID, conversationID,
		message.SentAt, nativeEvolutionPreview(message), contactName, contactPhone); err != nil {
		return false, "", err
	}
	return true, target, nil
}
