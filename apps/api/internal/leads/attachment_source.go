package leads

import (
	"context"
	"encoding/json"
	"errors"
	"mime"
	"net/url"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/authorization"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type attachmentQueryer interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

// Browser URLs are hints only. A message must already be attributed to this
// contact; relinking its conversation never transfers older message evidence.
func (repo Repository) resolveAttachmentMessage(ctx context.Context, q attachmentQueryer, actor tenant.Context, input leadAttachmentCreateInput, requireWhatsApp bool) (leadAttachmentCreateInput, string, error) {
	if input.MessageID == nil || (requireWhatsApp && (!actor.HasModule("whatsapp") || !actor.HasPermission(permissions.WhatsAppView))) {
		return input, "", ErrInvalidReference
	}
	var objectPath, mediaURL, contentType, name pgtype.Text
	var size pgtype.Int8
	err := q.QueryRow(ctx, `
		select wm.media_storage_path, wm.media_url, wm.media_mime_type, wm.media_size,
		 coalesce(nullif(to_jsonb(wm)->>'media_filename',''), nullif(to_jsonb(wm)->>'media_file_name',''))
		from public.whatsapp_messages wm
		join public.whatsapp_conversations wc on wc.id=wm.conversation_id and wc.organization_id=wm.organization_id
		where wm.organization_id=$1::uuid and wm.id=$2::uuid and wm.lead_id=$3::uuid
		 and wm.capture_state is distinct from 'suppressed' and wm.unlinked_retention_scrubbed_at is null
		 and wm.media_status='ready' and wm.message_type not in ('text','reaction','deleted','deleted_event','system')
		 and coalesce(to_jsonb(wm)->>'is_deleted','false') <> 'true'
	`, actor.OrganizationID, *input.MessageID, input.LeadID).Scan(&objectPath, &mediaURL, &contentType, &size, &name)
	if errors.Is(err, pgx.ErrNoRows) {
		return input, "", ErrInvalidReference
	}
	if err != nil {
		return input, "", err
	}
	storagePath := textValue(objectPath)
	if storagePath == "" {
		storagePath = storagePathFromPublicStorageURL(textValue(mediaURL), repo.storage.projectURL)
	}
	if storagePath != "" {
		if !leadAttachmentStoragePathBelongsToOrganization(storagePath, actor.OrganizationID) {
			return input, "", ErrInvalidReference
		}
		input.FileURL = repo.storage.publicURL(leadAttachmentBucket, storagePath)
	} else {
		input.FileURL = safeAttachmentExternalURL(textValue(mediaURL))
		if input.FileURL == "" {
			return input, "", ErrInvalidReference
		}
	}
	input.FileName = textValue(name)
	if input.FileName == "" {
		input.FileName = "documento"
		if extensions, _ := mime.ExtensionsByType(textValue(contentType)); len(extensions) > 0 {
			input.FileName += extensions[0]
		}
	}
	input.FileName = sanitizeAttachmentFileName(input.FileName)
	typeName := attachmentFileType(textValue(contentType), input.FileName)
	input.FileType = &typeName
	input.FileSize = nil
	if size.Valid && size.Int64 > 0 {
		input.FileSize = &size.Int64
	}
	return input, storagePath, nil
}

func safeAttachmentExternalURL(raw string) string {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || parsed.Host == "" || parsed.User != nil || (parsed.Scheme != "https" && parsed.Scheme != "http") {
		return ""
	}
	return parsed.String()
}

func attachmentDocumentLeadID(objectPath, organizationID string) string {
	if !leadAttachmentStoragePathBelongsToOrganization(objectPath, organizationID) {
		return ""
	}
	prefix := "orgs/" + organizationID + "/leads/"
	if !strings.HasPrefix(objectPath, prefix) {
		return ""
	}
	parts := strings.Split(strings.TrimPrefix(objectPath, prefix), "/")
	if len(parts) < 3 || parts[1] != "docs" {
		return ""
	}
	id, ok := normalizeUUID(parts[0])
	if !ok {
		return ""
	}
	return id
}

func (repo Repository) resolveAttachmentDocument(ctx context.Context, tx pgx.Tx, actor tenant.Context, input leadAttachmentCreateInput, columns leadAttachmentColumns) (leadAttachmentCreateInput, string, string, error) {
	objectPath := storagePathFromPublicStorageURL(input.FileURL, repo.storage.projectURL)
	originID := attachmentDocumentLeadID(objectPath, actor.OrganizationID)
	if originID == "" {
		return input, "", "", ErrInvalidReference
	}
	// Public registration can copy only a persisted document. The upload path
	// calls the internal insert helper with its server-created object directly.
	original, err := scanLeadAttachment(tx.QueryRow(ctx, `select `+leadAttachmentSelectFields(columns)+`
		from public.lead_attachments la join public.leads l on l.id=la.lead_id
		where l.organization_id=$1::uuid and la.lead_id=$2::uuid and (
		 to_jsonb(la)->>'storage_path'=$3 or to_jsonb(la)->>'file_url'=$4
		 or to_jsonb(la)->>'public_url'=$4 or to_jsonb(la)->>'file_url'=$5)
		limit 1`, actor.OrganizationID, originID, objectPath, repo.storage.publicURL(leadAttachmentBucket, objectPath), input.FileURL))
	if errors.Is(err, pgx.ErrNoRows) {
		return input, "", "", ErrInvalidReference
	}
	if err != nil {
		return input, "", "", err
	}
	input.FileURL = repo.storage.publicURL(leadAttachmentBucket, objectPath)
	input.FileName, input.FileType, input.FileSize = original.FileName, original.FileType, original.FileSize
	return input, objectPath, originID, nil
}

func lockAttachmentMessageConversation(ctx context.Context, tx pgx.Tx, actor tenant.Context, messageID, leadID string) error {
	var id string
	err := tx.QueryRow(ctx, `select wc.id::text from public.whatsapp_messages wm
	 join public.whatsapp_conversations wc on wc.id=wm.conversation_id and wc.organization_id=wm.organization_id
	 where wm.organization_id=$1::uuid and wm.id=$2::uuid and wm.lead_id=$3::uuid
	 for no key update of wc`, actor.OrganizationID, messageID, leadID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrInvalidReference
	}
	return err
}

// Lock source and destination in deterministic order, then authorize the
// current assignments. No preflight result survives a concurrent transfer.
func lockAttachmentLeadResources(ctx context.Context, tx pgx.Tx, actor tenant.Context, destinationID, sourceID string) error {
	rows, err := tx.Query(ctx, `select l.id::text, coalesce(l.assigned_user_id::text,''), coalesce(to_jsonb(l)->>'team_id','')
	 from public.leads l where l.organization_id=$1::uuid and l.id=any($2::uuid[])
	 order by l.id for no key update of l`, actor.OrganizationID, []string{destinationID, sourceID})
	if err != nil {
		return err
	}
	defer rows.Close()
	found := map[string]bool{}
	type lockedResource struct {
		id       string
		resource authorization.LeadResource
	}
	resources := []lockedResource{}
	for rows.Next() {
		var id string
		var resource authorization.LeadResource
		if err := rows.Scan(&id, &resource.AssignedUserID, &resource.TeamID); err != nil {
			return err
		}
		found[id] = true
		resources = append(resources, lockedResource{id: id, resource: resource})
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if !found[destinationID] || !found[sourceID] {
		return ErrLeadNotFound
	}
	rows.Close()
	for _, locked := range resources {
		access, err := queuePoolAccessAfterLeadLock(ctx, tx, actor.OrganizationID, locked.id, &actor.UserID)
		if err != nil {
			return err
		}
		locked.resource.QueuePoolReadAccess = access
		if locked.id == destinationID && access != nil {
			return ErrQueuePoolConflict
		}
		if locked.id == destinationID && !authorization.CanOperateLead(actor, locked.resource) {
			return tenant.ErrOrganizationAccessDenied
		}
		if locked.id == sourceID && !authorization.CanViewLead(actor, locked.resource) {
			return ErrLeadNotFound
		}
	}
	return nil
}

func attachmentLeadVisible(ctx context.Context, q attachmentQueryer, actor tenant.Context, leadID string) bool {
	var visible bool
	err := q.QueryRow(ctx, `select exists(select 1 from public.leads l where l.organization_id=$1::uuid and l.id=$5::uuid
	 and `+leadVisibilitySQL("$2", "$3", "$4", actor.HasPermission(permissions.LeadViewOwn))+`)`,
		actor.OrganizationID, canViewAllLeads(actor), actor.UserID, actor.HasPermission(permissions.LeadViewTeam), leadID).Scan(&visible)
	return err == nil && visible
}

// Keep the internal stable object reference out of JSON whenever signing or
// its authorization cannot be confirmed. A saved document is still returned.
func (attachment LeadAttachment) MarshalJSON() ([]byte, error) {
	type alias LeadAttachment
	var fileURL *string
	if attachment.FileURL != "" {
		fileURL = &attachment.FileURL
	}
	return json.Marshal(struct {
		alias
		FileURL *string `json:"file_url"`
	}{alias: alias(attachment), FileURL: fileURL})
}
