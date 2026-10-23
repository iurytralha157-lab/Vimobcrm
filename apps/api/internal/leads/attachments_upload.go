package leads

import (
	"context"
	"fmt"
	"io"
	"mime"
	"path/filepath"
	"strings"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const leadAttachmentBucket = "whatsapp-media"

func (repo Repository) UploadLeadAttachment(ctx context.Context, tenantContext tenant.Context, leadID string, fileName string, contentType string, size int64, body io.Reader, requestKeys ...string) (LeadAttachment, error) {
	leadID, ok := normalizeUUID(leadID)
	if !ok {
		return LeadAttachment{}, ErrInvalidInput
	}
	if size <= 0 || size > maxLeadAttachmentUploadBytes {
		return LeadAttachment{}, ErrInvalidInput
	}
	if len(requestKeys) != 1 {
		return LeadAttachment{}, fmt.Errorf("%w: uploadRequestKey is required", ErrInvalidInput)
	}
	key, ok := normalizeUUID(requestKeys[0])
	if !ok {
		return LeadAttachment{}, fmt.Errorf("%w: uploadRequestKey must be a UUID", ErrInvalidInput)
	}
	if err := repo.ensureLeadEditable(ctx, tenantContext, leadID); err != nil {
		return LeadAttachment{}, err
	}
	content := make([]byte, int(size))
	_, err := io.ReadFull(body, content)
	if err != nil {
		return LeadAttachment{}, fmt.Errorf("%w: attachment size does not match its content", ErrInvalidInput)
	}
	var extra [1]byte
	_, extraErr := io.ReadFull(body, extra[:])
	if extraErr != io.EOF {
		return LeadAttachment{}, fmt.Errorf("%w: attachment size does not match its content", ErrInvalidInput)
	}
	contentType = validatedAttachmentContentType(content)
	cleanName := sanitizeAttachmentFileName(fileName)
	digest := attachmentUploadDigest(leadID, cleanName, contentType, content)
	objectPath := fmt.Sprintf("orgs/%s/leads/%s/docs/%s/%s-%s-%s", tenantContext.OrganizationID, leadID, tenantContext.UserID, key, digest[:16], cleanName)
	fileSize := size
	fileType := attachmentFileType(contentType, cleanName)
	columns, err := repo.getLeadAttachmentColumns(ctx)
	if err != nil {
		return LeadAttachment{}, err
	}
	return repo.uploadLeadAttachmentWithReceipt(ctx, tenantContext, leadAttachmentCreateInput{
		LeadID:   leadID,
		FileName: cleanName,
		FileType: &fileType,
		FileSize: &fileSize,
	}, content, contentType, attachmentUploadReceipt{key: key, digest: digest, leadID: leadID, objectPath: objectPath}, columns)
}

func sanitizeAttachmentFileName(value string) string {
	value = strings.TrimSpace(filepath.Base(value))
	if value == "" || value == "." || value == string(filepath.Separator) {
		return "documento"
	}

	var builder strings.Builder
	for _, r := range value {
		switch {
		case r >= 'a' && r <= 'z':
			builder.WriteRune(r)
		case r >= 'A' && r <= 'Z':
			builder.WriteRune(r)
		case r >= '0' && r <= '9':
			builder.WriteRune(r)
		case r == '.', r == '-', r == '_':
			builder.WriteRune(r)
		default:
			builder.WriteRune('-')
		}
	}

	clean := strings.Trim(builder.String(), ".-_")
	if clean == "" {
		return "documento"
	}
	if len(clean) > 160 {
		extension := filepath.Ext(clean)
		base := strings.TrimSuffix(clean, extension)
		if len(extension) > 20 {
			extension = ""
		}
		maxBase := 160 - len(extension)
		if maxBase < 1 {
			maxBase = 160
		}
		if len(base) > maxBase {
			base = base[:maxBase]
		}
		clean = base + extension
	}

	return clean
}

func attachmentFileType(contentType string, fileName string) string {
	contentType = strings.ToLower(strings.TrimSpace(contentType))
	if before, _, ok := strings.Cut(contentType, ";"); ok {
		contentType = strings.TrimSpace(before)
	}
	if contentType == "" {
		contentType = mime.TypeByExtension(strings.ToLower(filepath.Ext(fileName)))
	}

	switch {
	case strings.HasPrefix(contentType, "image/"):
		return "image"
	case strings.HasPrefix(contentType, "video/"):
		return "video"
	case strings.HasPrefix(contentType, "audio/"):
		return "audio"
	default:
		return "document"
	}
}
