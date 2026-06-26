package automations

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"encoding/hex"
	"fmt"
	"io"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const automationMediaBucket = "automation-media"

func (repo Repository) ListMedia(ctx context.Context, tenantContext tenant.Context, mediaType string) ([]AutomationMediaFile, error) {
	if !tenantContext.HasPermission("automations_view") {
		return nil, tenant.ErrOrganizationAccessDenied
	}

	normalizedType, ok := normalizeAutomationMediaType(mediaType)
	if !ok {
		return nil, ErrInvalidInput
	}

	prefix := automationMediaFolder(tenantContext.OrganizationID, normalizedType)
	objects, err := repo.storage.list(ctx, automationMediaBucket, prefix, 100)
	if err != nil {
		return nil, err
	}

	files := make([]AutomationMediaFile, 0, len(objects))
	for _, object := range objects {
		name := strings.TrimSpace(object.Name)
		if name == "" || name == ".emptyFolderPlaceholder" {
			continue
		}
		objectPath := prefix + "/" + name
		files = append(files, automationMediaFileFromObject(repo.storage, object, objectPath))
	}

	return files, nil
}

func (repo Repository) UploadMedia(ctx context.Context, tenantContext tenant.Context, input AutomationMediaUploadInput, body io.Reader) (AutomationMediaUpload, error) {
	if !tenantContext.HasPermission("automations_edit") {
		return AutomationMediaUpload{}, tenant.ErrOrganizationAccessDenied
	}

	normalizedType, ok := normalizeAutomationMediaType(input.MediaType)
	if !ok {
		return AutomationMediaUpload{}, ErrInvalidInput
	}
	if input.Size <= 0 {
		return AutomationMediaUpload{}, ErrInvalidInput
	}

	contentType, err := normalizeAutomationMediaContentType(normalizedType, input.ContentType)
	if err != nil {
		return AutomationMediaUpload{}, err
	}

	objectPath, err := newAutomationMediaObjectPath(
		tenantContext.OrganizationID,
		normalizedType,
		input.OriginalFileName,
		contentType,
	)
	if err != nil {
		return AutomationMediaUpload{}, err
	}

	if err := repo.storage.upload(ctx, automationMediaBucket, objectPath, contentType, body); err != nil {
		return AutomationMediaUpload{}, err
	}

	fileName := path.Base(objectPath)
	size := input.Size
	metadata := map[string]any{
		"size":     input.Size,
		"mimetype": contentType,
	}

	return AutomationMediaUpload{
		AutomationMediaFile: AutomationMediaFile{
			Name:        fileName,
			Path:        objectPath,
			Bucket:      automationMediaBucket,
			PublicURL:   repo.storage.publicURL(automationMediaBucket, objectPath),
			ContentType: &contentType,
			Size:        &size,
			Metadata:    metadata,
		},
	}, nil
}

func (repo Repository) DeleteMedia(ctx context.Context, tenantContext tenant.Context, mediaType string, fileName string) error {
	if !tenantContext.HasPermission("automations_edit") {
		return tenant.ErrOrganizationAccessDenied
	}

	normalizedType, ok := normalizeAutomationMediaType(mediaType)
	if !ok {
		return ErrInvalidInput
	}

	safeName, ok := safeAutomationMediaFileName(fileName)
	if !ok {
		return ErrInvalidInput
	}

	objectPath := automationMediaFolder(tenantContext.OrganizationID, normalizedType) + "/" + safeName
	return repo.storage.remove(ctx, automationMediaBucket, objectPath)
}

func automationMediaFileFromObject(storage storageClient, object storageObject, objectPath string) AutomationMediaFile {
	metadata := object.Metadata
	if metadata == nil {
		metadata = map[string]any{}
	}

	return AutomationMediaFile{
		Name:        object.Name,
		Path:        objectPath,
		Bucket:      automationMediaBucket,
		PublicURL:   storage.publicURL(automationMediaBucket, objectPath),
		ContentType: metadataStringPtr(metadata, "mimetype"),
		Size:        metadataInt64Ptr(metadata, "size"),
		Metadata:    metadata,
		CreatedAt:   object.CreatedAt,
		UpdatedAt:   object.UpdatedAt,
	}
}

func normalizeAutomationMediaType(value string) (string, bool) {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "image":
		return "image", true
	case "audio":
		return "audio", true
	case "video":
		return "video", true
	default:
		return "", false
	}
}

func automationMediaFolder(organizationID string, mediaType string) string {
	return fmt.Sprintf("%s/%ss", organizationID, mediaType)
}

func newAutomationMediaObjectPath(organizationID string, mediaType string, originalFileName string, contentType string) (string, error) {
	token, err := randomAutomationMediaToken()
	if err != nil {
		return "", err
	}

	return fmt.Sprintf(
		"%s/%d-%s%s",
		automationMediaFolder(organizationID, mediaType),
		time.Now().UTC().UnixMilli(),
		token,
		automationMediaExtension(mediaType, originalFileName, contentType),
	), nil
}

func safeAutomationMediaFileName(value string) (string, bool) {
	value = strings.ReplaceAll(strings.TrimSpace(value), "\\", "/")
	name := path.Base(value)
	if name == "" || name == "." || name == "/" || strings.Contains(name, "..") {
		return "", false
	}

	return name, true
}

func normalizeAutomationMediaContentType(mediaType string, value string) (string, error) {
	value = cleanAutomationContentType(value)
	if isAllowedAutomationMediaContentType(mediaType, value) {
		return value, nil
	}

	return "", ErrInvalidInput
}

func cleanAutomationContentType(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if before, _, ok := strings.Cut(value, ";"); ok {
		return strings.TrimSpace(before)
	}

	return value
}

func isAllowedAutomationMediaContentType(mediaType string, value string) bool {
	switch mediaType {
	case "image":
		switch value {
		case "image/jpeg", "image/png", "image/webp", "image/gif":
			return true
		}
	case "audio":
		switch value {
		case "audio/aac", "audio/mpeg", "audio/mp3", "audio/ogg", "audio/wav", "audio/webm", "audio/mp4":
			return true
		}
	case "video":
		switch value {
		case "video/mp4", "video/mpeg", "video/quicktime", "video/webm", "video/ogg":
			return true
		}
	}

	return false
}

func automationMediaExtension(mediaType string, originalFileName string, contentType string) string {
	originalExt := strings.ToLower(path.Ext(strings.ReplaceAll(originalFileName, "\\", "/")))
	if isAllowedAutomationMediaExtension(mediaType, originalExt) {
		return originalExt
	}

	switch contentType {
	case "image/jpeg":
		return ".jpg"
	case "image/png":
		return ".png"
	case "image/webp":
		return ".webp"
	case "image/gif":
		return ".gif"
	case "audio/aac":
		return ".aac"
	case "audio/mpeg", "audio/mp3":
		return ".mp3"
	case "audio/ogg":
		return ".ogg"
	case "audio/wav":
		return ".wav"
	case "audio/webm":
		return ".webm"
	case "audio/mp4":
		return ".m4a"
	case "video/mp4":
		return ".mp4"
	case "video/mpeg":
		return ".mpeg"
	case "video/quicktime":
		return ".mov"
	case "video/webm":
		return ".webm"
	case "video/ogg":
		return ".ogv"
	default:
		return ".bin"
	}
}

func isAllowedAutomationMediaExtension(mediaType string, value string) bool {
	switch mediaType {
	case "image":
		switch value {
		case ".jpg", ".jpeg", ".png", ".webp", ".gif":
			return true
		}
	case "audio":
		switch value {
		case ".aac", ".mp3", ".ogg", ".oga", ".wav", ".webm", ".m4a":
			return true
		}
	case "video":
		switch value {
		case ".mp4", ".mpeg", ".mov", ".webm", ".ogg", ".ogv":
			return true
		}
	}

	return false
}

func randomAutomationMediaToken() (string, error) {
	var bytes [8]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "", err
	}

	return hex.EncodeToString(bytes[:]), nil
}

func metadataStringPtr(metadata map[string]any, key string) *string {
	value, ok := metadata[key]
	if !ok {
		return nil
	}
	text, ok := value.(string)
	if !ok || strings.TrimSpace(text) == "" {
		return nil
	}

	return &text
}

func metadataInt64Ptr(metadata map[string]any, key string) *int64 {
	value, ok := metadata[key]
	if !ok {
		return nil
	}

	var parsed int64
	switch typed := value.(type) {
	case float64:
		parsed = int64(typed)
	case int64:
		parsed = typed
	case int:
		parsed = int64(typed)
	case json.Number:
		number, err := typed.Int64()
		if err != nil {
			return nil
		}
		parsed = number
	case string:
		number, err := strconv.ParseInt(strings.TrimSpace(typed), 10, 64)
		if err != nil {
			return nil
		}
		parsed = number
	default:
		return nil
	}

	if parsed <= 0 {
		return nil
	}

	return &parsed
}
