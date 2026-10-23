package whatsapp

import (
	"context"
	"encoding/hex"
	"errors"
	"strings"
)

var errOutboundMediaIntegrityUnverified = errors.New("outbound_media_integrity_unverified: Não foi possível confirmar o arquivo desta mensagem antiga. Anexe o arquivo novamente para criar um novo envio.")

func (repo Repository) whatsappOutboxMediaIntegrityVerified(ctx context.Context, item pendingWhatsAppOutbox, body map[string]any) (bool, error) {
	var digest, path, mime, sourceID, sourcePath string
	err := repo.db.Pool().QueryRow(ctx, `select coalesce(metadata->>'outbound_media_sha256',''),coalesce(media_storage_path,''),coalesce(media_mime_type,''),
	 coalesce(metadata->>'outbound_media_source_message_id',''),coalesce(metadata->>'outbound_media_source_path','')
	 from public.whatsapp_messages where organization_id=$1::uuid and id=$2::uuid and session_id=$3::uuid and conversation_id=$4::uuid`,
		item.OrganizationID, item.MessageRowID, item.SessionID, item.ConversationID).Scan(&digest, &path, &mime, &sourceID, &sourcePath)
	if err != nil {
		return false, err
	}
	decoded, decodeErr := hex.DecodeString(digest)
	if decodeErr != nil || len(decoded) != 32 || digest != strings.ToLower(digest) || digest != stringFromAny(body["mediaSHA256"]) || path != stringFromAny(body["mediaStoragePath"]) {
		return false, nil
	}
	if path != outboundMediaImmutablePath(item.OrganizationID, item.SessionID, deterministicProviderMessageID(item.ClientMessageID), mime, digest) {
		return false, nil
	}
	if sourcePath != "" {
		if _, ok := normalizeUUID(sourceID); !ok || !whatsappMediaPathBelongsToOrganization(sourcePath, item.OrganizationID) {
			return false, nil
		}
	}
	return true, nil
}

func mediaDeliveryFailureReason(lastError string) string {
	if strings.HasPrefix(lastError, "outbound_media_integrity_unverified:") {
		return "media_integrity_unverified"
	}
	return ""
}
