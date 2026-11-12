package whatsapp

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// No transaction or row lock is held across Storage I/O. Final admission below
// still repeats every actor/binding/dedupe check. Two first-time requests may
// create an unreferenced private digest object, but cannot rewrite the winner.
func (repo Repository) prepareOutboundMedia(ctx context.Context, organizationID, sessionID, conversationID, leadID, clientID, content, messageType, mimeType, filename, quoteID, remoteJID string, payload []byte, digest, sourcePath, mediaURL, objectPath string) (string, string, string, error) {
	var oldConversation, oldLead, oldContent, oldType, oldMime, oldQuote, oldRemote, oldURL, oldPath, oldDigest, oldSource, oldFilename string
	err := repo.db.Pool().QueryRow(ctx, `select conversation_id::text,coalesce(lead_id::text,''),coalesce(content,''),message_type,
	 coalesce(media_mime_type,''),coalesce(metadata->>'quoted_message_id',''),coalesce(remote_jid,''),coalesce(media_url,''),
	 coalesce(media_storage_path,''),coalesce(metadata->>'outbound_media_sha256',''),coalesce(metadata->>'outbound_media_source_path',''),
	 coalesce(nullif(metadata->>'media_filename',''),(select queued.payload->'body'->>'fileName' from public.whatsapp_outbox queued
	 where queued.message_id=wm.id and queued.organization_id=wm.organization_id limit 1),'') from public.whatsapp_messages wm
	 where organization_id=$1::uuid and session_id=$2::uuid and client_message_id=$3`, organizationID, sessionID, clientID).Scan(
		&oldConversation, &oldLead, &oldContent, &oldType, &oldMime, &oldQuote, &oldRemote, &oldURL, &oldPath, &oldDigest, &oldSource, &oldFilename)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return "", "", "", err
	}
	if err == nil {
		if oldConversation != conversationID || oldLead != leadID || oldContent != content || oldType != messageType || oldMime != mimeType || oldQuote != quoteID || oldRemote != remoteJID || (oldFilename != "" || oldDigest != "") && safeMediaFilename(oldFilename) != safeMediaFilename(filename) {
			return "", "", "", fmt.Errorf("%w: clientMessageId ja pertence a outra mensagem", ErrInvalidInput)
		}
		if len(payload) > 0 {
			if oldDigest != "" && oldDigest != digest {
				return "", "", "", fmt.Errorf("%w: midia difere da mensagem original", ErrInvalidInput)
			}
			if oldDigest == "" {
				if !whatsappMediaPathBelongsToOrganization(oldPath, organizationID) {
					return "", "", "", fmt.Errorf("%w: midia original indisponivel", ErrInvalidInput)
				}
				if err := repo.storage.verifyOutboundMediaDigest(ctx, oldPath, digest); err != nil {
					return "", "", "", fmt.Errorf("%w: midia difere da mensagem original", ErrInvalidInput)
				}
			}
		} else if sourcePath != "" {
			if sourcePath != oldPath && sourcePath != oldSource {
				return "", "", "", fmt.Errorf("%w: clientMessageId ja pertence a outra midia", ErrInvalidInput)
			}
		} else if oldURL != mediaURL {
			return "", "", "", fmt.Errorf("%w: clientMessageId ja pertence a outra midia", ErrInvalidInput)
		}
		// No object upload for an existing intent. Keep its historical digest
		// unchanged, including an empty digest on compatible legacy rows.
		return oldURL, oldPath, oldDigest, nil
	}
	if len(payload) == 0 && sourcePath != "" {
		payload, err = repo.storage.outboundMediaBytes(ctx, sourcePath)
		if err != nil {
			return "", "", "", fmt.Errorf("%w: midia armazenada indisponivel: %v", ErrProviderFailed, err)
		}
		digest = outboundMediaDigest(payload)
		if sourceDigest, immutable := immutableOutboundMediaPathDigest(sourcePath); immutable && sourceDigest != digest {
			return "", "", "", fmt.Errorf("%w: midia armazenada difere do arquivo original", ErrInvalidInput)
		}
		objectPath = outboundMediaImmutablePath(organizationID, sessionID, deterministicProviderMessageID(clientID), mimeType, digest)
		mediaURL = repo.storage.publicURL(whatsappMediaBucket, objectPath)
	}
	if len(payload) > 0 {
		if err := repo.storage.uploadImmutable(ctx, objectPath, mimeType, payload); err != nil {
			return "", "", "", fmt.Errorf("%w: nao foi possivel persistir a midia antes do envio: %v", ErrProviderFailed, err)
		}
	}
	return mediaURL, objectPath, digest, nil
}
