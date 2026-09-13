package properties

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/mail"
	"net/url"
	pathpkg "path"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	propertyPrivateBucket          = "property-private"
	propertyAssetMaxFileBytes      = int64(10 << 20)
	propertyAssetAccessTTL         = 90 * time.Second
	propertyAssetUploadTokenTTL    = 2 * time.Hour
	propertyAssetMaxPhotos         = 20
	propertyAssetMaxPendingUploads = 20
	propertyAssetCleanupBatchSize  = 20
	propertyAssetMaxUploadFileName = 240
)

var validPropertyAssetTypes = map[string]struct{}{
	"photo": {}, "video": {}, "virtual_tour": {}, "floor_plan": {}, "document": {},
}

var validPropertyAssetVisibilities = map[string]struct{}{
	"public": {}, "internal": {}, "confidential": {},
}

var validPropertyUploadAssetTypes = map[string]struct{}{
	"photo": {}, "floor_plan": {}, "document": {},
}

var validPropertyPrivateMIMETypes = map[string]struct{}{
	"image/jpeg": {}, "image/png": {}, "image/webp": {}, "image/gif": {}, "application/pdf": {},
}

var canonicalPropertyAssetFileName = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,239}$`)

// workspaceOptionalString distinguishes an omitted field from an explicit
// null so PATCH requests can clear nullable columns without overwriting fields
// the caller did not send.
type workspaceOptionalString struct {
	Set   bool
	Value *string
}

func (value *workspaceOptionalString) UnmarshalJSON(data []byte) error {
	value.Set = true
	if bytes.Equal(bytes.TrimSpace(data), []byte("null")) {
		value.Value = nil
		return nil
	}
	var text string
	if err := json.Unmarshal(data, &text); err != nil {
		return fmt.Errorf("%w: expected string or null", ErrInvalidInput)
	}
	value.Value = &text
	return nil
}

type workspaceOptionalInt64 struct {
	Set   bool
	Value *int64
}

func (value *workspaceOptionalInt64) UnmarshalJSON(data []byte) error {
	value.Set = true
	if bytes.Equal(bytes.TrimSpace(data), []byte("null")) {
		value.Value = nil
		return nil
	}
	var number int64
	if err := json.Unmarshal(data, &number); err != nil {
		return fmt.Errorf("%w: expected integer or null", ErrInvalidInput)
	}
	value.Value = &number
	return nil
}

type PropertyOwnerDetailsInput struct {
	Name             string  `json:"name"`
	PhoneResidential *string `json:"phone_residential"`
	PhoneCommercial  *string `json:"phone_commercial"`
	Cellphone        *string `json:"cellphone"`
	Email            *string `json:"email"`
	MediaSource      *string `json:"media_source"`
	NotifyEmail      bool    `json:"notify_email"`
	Notes            *string `json:"notes"`
}

type PropertyOwnerUpdateInput struct {
	PropertyOwnerDetailsInput
	ExpectedUpdatedAt string `json:"expected_updated_at"`
}

type CreatePropertyOwnershipInput struct {
	OwnerID             *string                    `json:"owner_id"`
	NewOwner            *PropertyOwnerDetailsInput `json:"new_owner"`
	OwnershipPercentage float64                    `json:"ownership_percentage"`
	IsPrimary           bool                       `json:"is_primary"`
	ValidFrom           string                     `json:"valid_from"`
	Notes               *string                    `json:"notes"`
}

type UpdatePropertyOwnershipInput struct {
	OwnershipPercentage float64                   `json:"ownership_percentage"`
	IsPrimary           bool                      `json:"is_primary"`
	ValidFrom           string                    `json:"valid_from"`
	Notes               *string                   `json:"notes"`
	Owner               *PropertyOwnerUpdateInput `json:"owner"`
	ExpectedUpdatedAt   string                    `json:"expected_updated_at"`
}

type EndPropertyOwnershipInput struct {
	ValidTo           string `json:"valid_to"`
	ExpectedUpdatedAt string `json:"expected_updated_at"`
}

type CreatePropertyAssetInput struct {
	AssetType        string         `json:"asset_type"`
	Visibility       string         `json:"visibility"`
	StoragePath      *string        `json:"storage_path"`
	ExternalURL      *string        `json:"external_url"`
	Title            *string        `json:"title"`
	Description      *string        `json:"description"`
	FileName         *string        `json:"file_name"`
	MIMEType         *string        `json:"mime_type"`
	FileSizeBytes    *int64         `json:"file_size_bytes"`
	SortOrder        int            `json:"sort_order"`
	IsPrimary        bool           `json:"is_primary"`
	DocumentCategory *string        `json:"document_category"`
	ExpiresAt        *string        `json:"expires_at"`
	Metadata         map[string]any `json:"metadata"`
}

type UpdatePropertyAssetInput struct {
	AssetType         string                  `json:"asset_type"`
	Visibility        string                  `json:"visibility"`
	StoragePath       workspaceOptionalString `json:"storage_path"`
	ExternalURL       workspaceOptionalString `json:"external_url"`
	Title             workspaceOptionalString `json:"title"`
	Description       workspaceOptionalString `json:"description"`
	FileName          workspaceOptionalString `json:"file_name"`
	MIMEType          workspaceOptionalString `json:"mime_type"`
	FileSizeBytes     workspaceOptionalInt64  `json:"file_size_bytes"`
	DocumentCategory  workspaceOptionalString `json:"document_category"`
	ExpiresAt         workspaceOptionalString `json:"expires_at"`
	Metadata          map[string]any          `json:"metadata"`
	ExpectedUpdatedAt string                  `json:"expected_updated_at"`
}

type DeletePropertyAssetInput struct {
	ExpectedUpdatedAt string `json:"expected_updated_at"`
}

type PropertyAssetOrderItem struct {
	ID                string `json:"id"`
	SortOrder         int    `json:"sort_order"`
	ExpectedUpdatedAt string `json:"expected_updated_at"`
}

type ReorderPropertyAssetsInput struct {
	Items []PropertyAssetOrderItem `json:"items"`
}

type SetPrimaryPropertyAssetInput struct {
	ExpectedUpdatedAt string `json:"expected_updated_at"`
}

var reservedPropertyAssetMetadataKeys = map[string]struct{}{
	"integration_managed":   {},
	"integration_provider":  {},
	"integration_providers": {},
	"integration_retired":   {},
}

type CreatePropertyAssetUploadIntentInput struct {
	AssetType     string `json:"asset_type"`
	FileName      string `json:"file_name"`
	MIMEType      string `json:"mime_type"`
	FileSizeBytes int64  `json:"file_size_bytes"`
}

type PropertyAssetUploadIntent struct {
	Bucket      string `json:"bucket"`
	StoragePath string `json:"storage_path"`
	Token       string `json:"token"`
	SignedURL   string `json:"signed_url"`
	ExpiresAt   string `json:"expires_at"`
}

func (input *PropertyOwnerDetailsInput) Validate() error {
	name, err := validateBoundedOwnerText(input.Name, "name", 160, true)
	if err != nil {
		return err
	}
	input.Name = name
	for _, field := range []struct {
		name  string
		value **string
		limit int
	}{
		{name: "phone_residential", value: &input.PhoneResidential, limit: 40},
		{name: "phone_commercial", value: &input.PhoneCommercial, limit: 40},
		{name: "cellphone", value: &input.Cellphone, limit: 40},
		{name: "email", value: &input.Email, limit: 160},
		{name: "media_source", value: &input.MediaSource, limit: 80},
		{name: "notes", value: &input.Notes, limit: 1200},
	} {
		if *field.value == nil {
			continue
		}
		value, err := validateBoundedOwnerText(**field.value, field.name, field.limit, false)
		if err != nil {
			return err
		}
		if value == "" {
			*field.value = nil
			continue
		}
		*field.value = &value
	}
	if input.Email != nil {
		address, err := mail.ParseAddress(*input.Email)
		if err != nil || !strings.EqualFold(address.Address, *input.Email) {
			return fmt.Errorf("%w: owner email is invalid", ErrInvalidInput)
		}
		email := strings.ToLower(address.Address)
		input.Email = &email
	}
	if input.NotifyEmail && input.Email == nil {
		return fmt.Errorf("%w: owner email is required when notify_email is enabled", ErrInvalidInput)
	}
	return nil
}

type DiscardPropertyAssetUploadInput struct {
	StoragePath string `json:"storage_path"`
}

func (input *CreatePropertyOwnershipInput) Validate() error {
	if (input.OwnerID == nil) == (input.NewOwner == nil) {
		return fmt.Errorf("%w: exactly one of owner_id or new_owner is required", ErrInvalidInput)
	}
	if input.OwnerID != nil {
		ownerID, ok := normalizeUUID(*input.OwnerID)
		if !ok {
			return fmt.Errorf("%w: owner_id is invalid", ErrInvalidInput)
		}
		input.OwnerID = &ownerID
	}
	if input.NewOwner != nil {
		if err := input.NewOwner.Validate(); err != nil {
			return err
		}
	}
	if err := validateOwnershipRelationship(input.OwnershipPercentage, input.ValidFrom, input.Notes); err != nil {
		return err
	}
	input.ValidFrom = strings.TrimSpace(input.ValidFrom)
	input.Notes = trimWorkspaceNullable(input.Notes, 1200)
	return nil
}

func (input *UpdatePropertyOwnershipInput) Validate() error {
	if err := validateOwnershipRelationship(input.OwnershipPercentage, input.ValidFrom, input.Notes); err != nil {
		return err
	}
	input.ValidFrom = strings.TrimSpace(input.ValidFrom)
	input.Notes = trimWorkspaceNullable(input.Notes, 1200)
	if err := validateRequiredWorkspaceTimestamp(input.ExpectedUpdatedAt, "expected_updated_at"); err != nil {
		return err
	}
	if input.Owner != nil {
		if err := input.Owner.PropertyOwnerDetailsInput.Validate(); err != nil {
			return err
		}
		if err := validateRequiredWorkspaceTimestamp(input.Owner.ExpectedUpdatedAt, "owner.expected_updated_at"); err != nil {
			return err
		}
	}
	return nil
}

func (input *EndPropertyOwnershipInput) Validate() error {
	input.ValidTo = strings.TrimSpace(input.ValidTo)
	if _, err := time.Parse("2006-01-02", input.ValidTo); err != nil {
		return fmt.Errorf("%w: valid_to is invalid", ErrInvalidInput)
	}
	return validateRequiredWorkspaceTimestamp(input.ExpectedUpdatedAt, "expected_updated_at")
}

func validateOwnershipRelationship(percentage float64, validFrom string, notes *string) error {
	if percentage <= 0 || percentage > 100 {
		return fmt.Errorf("%w: ownership_percentage must be greater than zero and at most 100", ErrInvalidInput)
	}
	if _, err := time.Parse("2006-01-02", strings.TrimSpace(validFrom)); err != nil {
		return fmt.Errorf("%w: valid_from is invalid", ErrInvalidInput)
	}
	if notes != nil && len(strings.TrimSpace(*notes)) > 1200 {
		return fmt.Errorf("%w: ownership notes are too long", ErrInvalidInput)
	}
	return nil
}

func (input *CreatePropertyAssetInput) Validate(organizationID string, propertyID string) error {
	input.AssetType = strings.ToLower(strings.TrimSpace(input.AssetType))
	input.Visibility = strings.ToLower(strings.TrimSpace(input.Visibility))
	if input.Visibility == "" {
		input.Visibility = "internal"
	}
	for _, field := range []struct {
		name  string
		value **string
		max   int
	}{
		{"storage_path", &input.StoragePath, 2000},
		{"external_url", &input.ExternalURL, 2000},
		{"title", &input.Title, 240},
		{"description", &input.Description, 2000},
		{"file_name", &input.FileName, 255},
		{"mime_type", &input.MIMEType, 160},
		{"document_category", &input.DocumentCategory, 120},
		{"expires_at", &input.ExpiresAt, 10},
	} {
		normalized, err := normalizePropertyAssetNullable(*field.value, field.name, field.max)
		if err != nil {
			return err
		}
		*field.value = normalized
	}
	if (input.StoragePath == nil) == (input.ExternalURL == nil) {
		return fmt.Errorf("%w: exactly one of storage_path or external_url is required", ErrInvalidInput)
	}
	if err := validatePropertyAssetState(*input, organizationID, propertyID); err != nil {
		return err
	}
	if input.Metadata == nil {
		input.Metadata = map[string]any{}
	}
	if err := validatePropertyAssetMetadata(input.Metadata); err != nil {
		return err
	}
	return nil
}

func (input *UpdatePropertyAssetInput) Validate() error {
	input.AssetType = strings.ToLower(strings.TrimSpace(input.AssetType))
	input.Visibility = strings.ToLower(strings.TrimSpace(input.Visibility))
	if _, ok := validPropertyAssetTypes[input.AssetType]; !ok {
		return fmt.Errorf("%w: asset_type is invalid", ErrInvalidInput)
	}
	if _, ok := validPropertyAssetVisibilities[input.Visibility]; !ok {
		return fmt.Errorf("%w: visibility is invalid", ErrInvalidInput)
	}
	for _, field := range []struct {
		name  string
		value *workspaceOptionalString
		max   int
	}{
		{"storage_path", &input.StoragePath, 2000},
		{"external_url", &input.ExternalURL, 2000},
		{"title", &input.Title, 240},
		{"description", &input.Description, 2000},
		{"file_name", &input.FileName, 255},
		{"mime_type", &input.MIMEType, 160},
		{"document_category", &input.DocumentCategory, 120},
		{"expires_at", &input.ExpiresAt, 10},
	} {
		if field.value.Set {
			normalized, err := normalizePropertyAssetNullable(field.value.Value, field.name, field.max)
			if err != nil {
				return err
			}
			field.value.Value = normalized
		}
	}
	if input.FileSizeBytes.Set && input.FileSizeBytes.Value != nil && *input.FileSizeBytes.Value < 0 {
		return fmt.Errorf("%w: file_size_bytes cannot be negative", ErrInvalidInput)
	}
	if input.Metadata == nil {
		input.Metadata = map[string]any{}
	}
	if err := validatePropertyAssetMetadata(input.Metadata); err != nil {
		return err
	}
	return validateRequiredWorkspaceTimestamp(input.ExpectedUpdatedAt, "expected_updated_at")
}

func validatePropertyAssetMetadata(metadata map[string]any) error {
	for key := range metadata {
		normalizedKey := strings.ToLower(strings.TrimSpace(key))
		if _, reserved := reservedPropertyAssetMetadataKeys[normalizedKey]; reserved {
			return fmt.Errorf("%w: metadata.%s is reserved for integration lifecycle management", ErrInvalidInput, normalizedKey)
		}
	}
	return nil
}

func (input *DeletePropertyAssetInput) Validate() error {
	return validateRequiredWorkspaceTimestamp(input.ExpectedUpdatedAt, "expected_updated_at")
}

func (input *ReorderPropertyAssetsInput) Validate() error {
	if len(input.Items) == 0 || len(input.Items) > 200 {
		return fmt.Errorf("%w: items must contain between 1 and 200 assets", ErrInvalidInput)
	}
	seen := make(map[string]struct{}, len(input.Items))
	seenSortOrders := make(map[int]struct{}, len(input.Items))
	for index := range input.Items {
		item := &input.Items[index]
		id, ok := normalizeUUID(item.ID)
		if !ok {
			return fmt.Errorf("%w: asset order id is invalid", ErrInvalidInput)
		}
		item.ID = id
		if _, duplicate := seen[id]; duplicate {
			return fmt.Errorf("%w: asset order cannot contain duplicate ids", ErrInvalidInput)
		}
		seen[id] = struct{}{}
		if item.SortOrder < 0 {
			return fmt.Errorf("%w: sort_order cannot be negative", ErrInvalidInput)
		}
		if _, duplicate := seenSortOrders[item.SortOrder]; duplicate {
			return fmt.Errorf("%w: asset order cannot contain duplicate sort_order values", ErrInvalidInput)
		}
		seenSortOrders[item.SortOrder] = struct{}{}
		if err := validateRequiredWorkspaceTimestamp(item.ExpectedUpdatedAt, "items.expected_updated_at"); err != nil {
			return err
		}
	}
	return nil
}

func (input *SetPrimaryPropertyAssetInput) Validate() error {
	return validateRequiredWorkspaceTimestamp(input.ExpectedUpdatedAt, "expected_updated_at")
}

func (input *CreatePropertyAssetUploadIntentInput) Validate() error {
	input.AssetType = strings.ToLower(strings.TrimSpace(input.AssetType))
	originalFileName := strings.TrimSpace(input.FileName)
	if utf8.RuneCountInString(originalFileName) > propertyAssetMaxUploadFileName {
		return fmt.Errorf("%w: file_name must contain at most %d characters", ErrInvalidInput, propertyAssetMaxUploadFileName)
	}
	input.FileName = sanitizePropertyAssetFileName(originalFileName)
	input.MIMEType = strings.ToLower(strings.TrimSpace(input.MIMEType))
	if _, ok := validPropertyUploadAssetTypes[input.AssetType]; !ok {
		return fmt.Errorf("%w: upload asset_type is invalid", ErrInvalidInput)
	}
	if input.FileName == "" {
		return fmt.Errorf("%w: file_name is invalid", ErrInvalidInput)
	}
	if _, ok := validPropertyPrivateMIMETypes[input.MIMEType]; !ok {
		return fmt.Errorf("%w: mime_type is not allowed", ErrInvalidInput)
	}
	if input.AssetType == "photo" && !strings.HasPrefix(input.MIMEType, "image/") {
		return fmt.Errorf("%w: photos require an image mime_type", ErrInvalidInput)
	}
	if input.AssetType == "document" && input.MIMEType != "application/pdf" {
		return fmt.Errorf("%w: documents require application/pdf", ErrInvalidInput)
	}
	if input.FileSizeBytes <= 0 || input.FileSizeBytes > propertyAssetMaxFileBytes {
		return fmt.Errorf("%w: file_size_bytes must be between 1 and 10485760", ErrInvalidInput)
	}
	return nil
}

func (input *DiscardPropertyAssetUploadInput) Validate(organizationID string, propertyID string) error {
	input.StoragePath = strings.TrimSpace(input.StoragePath)
	if !isCanonicalPropertyStoragePath(input.StoragePath, organizationID, propertyID) {
		return fmt.Errorf("%w: storage_path is outside the property namespace", ErrInvalidInput)
	}
	return nil
}

func validatePropertyAssetState(input CreatePropertyAssetInput, organizationID string, propertyID string) error {
	if _, ok := validPropertyAssetTypes[input.AssetType]; !ok {
		return fmt.Errorf("%w: asset_type is invalid", ErrInvalidInput)
	}
	if _, ok := validPropertyAssetVisibilities[input.Visibility]; !ok {
		return fmt.Errorf("%w: visibility is invalid", ErrInvalidInput)
	}
	if input.StoragePath != nil && !isCanonicalPropertyStoragePath(*input.StoragePath, organizationID, propertyID) {
		return fmt.Errorf("%w: storage_path is outside the property namespace", ErrInvalidInput)
	}
	if input.StoragePath != nil {
		if _, ok := validPropertyUploadAssetTypes[input.AssetType]; !ok {
			return fmt.Errorf("%w: videos and virtual tours require external_url", ErrInvalidInput)
		}
		if input.MIMEType == nil || input.FileSizeBytes == nil || *input.FileSizeBytes <= 0 || *input.FileSizeBytes > propertyAssetMaxFileBytes {
			return fmt.Errorf("%w: stored assets require verified mime_type and file_size_bytes", ErrInvalidInput)
		}
		mimeType := strings.ToLower(strings.TrimSpace(*input.MIMEType))
		if _, ok := validPropertyPrivateMIMETypes[mimeType]; !ok {
			return fmt.Errorf("%w: stored asset mime_type is invalid", ErrInvalidInput)
		}
		if input.AssetType == "photo" && !strings.HasPrefix(mimeType, "image/") {
			return fmt.Errorf("%w: photos require an image object", ErrInvalidInput)
		}
		if input.AssetType == "document" && mimeType != "application/pdf" {
			return fmt.Errorf("%w: documents require a PDF object", ErrInvalidInput)
		}
	}
	if input.ExternalURL != nil && !isSafePropertyAssetURL(*input.ExternalURL) {
		return fmt.Errorf("%w: external_url must use http or https", ErrInvalidInput)
	}
	if input.FileSizeBytes != nil && *input.FileSizeBytes < 0 {
		return fmt.Errorf("%w: file_size_bytes cannot be negative", ErrInvalidInput)
	}
	if input.IsPrimary && input.AssetType != "photo" {
		return fmt.Errorf("%w: only photos can be primary", ErrInvalidInput)
	}
	if input.IsPrimary && input.Visibility != "public" {
		return fmt.Errorf("%w: primary photos must be public", ErrInvalidInput)
	}
	if input.AssetType != "document" && (input.DocumentCategory != nil || input.ExpiresAt != nil) {
		return fmt.Errorf("%w: document_category and expires_at require a document", ErrInvalidInput)
	}
	if input.ExpiresAt != nil {
		if _, err := time.Parse("2006-01-02", *input.ExpiresAt); err != nil {
			return fmt.Errorf("%w: expires_at is invalid", ErrInvalidInput)
		}
	}
	return nil
}

func validateRequiredWorkspaceTimestamp(value string, field string) error {
	value = strings.TrimSpace(value)
	if value == "" {
		return fmt.Errorf("%w: %s is required", ErrInvalidInput, field)
	}
	if _, err := time.Parse(time.RFC3339Nano, value); err != nil {
		return fmt.Errorf("%w: %s is invalid", ErrInvalidInput, field)
	}
	return nil
}

func trimWorkspaceNullable(value *string, maxLength int) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if len(trimmed) > maxLength {
		trimmed = trimmed[:maxLength]
	}
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func normalizePropertyAssetNullable(value *string, field string, maxLength int) (*string, error) {
	if value == nil {
		return nil, nil
	}
	trimmed := strings.TrimSpace(*value)
	if utf8.RuneCountInString(trimmed) > maxLength {
		return nil, fmt.Errorf("%w: %s must contain at most %d characters", ErrInvalidInput, field, maxLength)
	}
	if trimmed == "" {
		return nil, nil
	}
	return &trimmed, nil
}

func isCanonicalPropertyStoragePath(value string, organizationID string, propertyID string) bool {
	value = strings.TrimSpace(value)
	if value == "" || strings.Contains(value, "\\") || strings.Contains(value, "//") || pathpkg.Clean(value) != value {
		return false
	}
	prefix := "orgs/" + organizationID + "/properties/" + propertyID + "/"
	if !strings.HasPrefix(value, prefix) {
		return false
	}
	parts := strings.Split(strings.TrimPrefix(value, prefix), "/")
	if len(parts) != 2 {
		return false
	}
	assetID, ok := normalizeUUID(parts[0])
	return ok && assetID == parts[0] && canonicalPropertyAssetFileName.MatchString(parts[1])
}

func propertyAssetIDFromStoragePath(value string, organizationID string, propertyID string) (string, bool) {
	if !isCanonicalPropertyStoragePath(value, organizationID, propertyID) {
		return "", false
	}
	prefix := "orgs/" + organizationID + "/properties/" + propertyID + "/"
	assetID := strings.SplitN(strings.TrimPrefix(value, prefix), "/", 2)[0]
	return normalizeUUID(assetID)
}

func isSafePropertyAssetURL(value string) bool {
	parsed, err := url.ParseRequestURI(strings.TrimSpace(value))
	if err != nil || parsed.Host == "" || parsed.User != nil {
		return false
	}
	return parsed.Scheme == "http" || parsed.Scheme == "https"
}

func sanitizePropertyAssetFileName(value string) string {
	value = pathpkg.Base(strings.ReplaceAll(strings.TrimSpace(value), "\\", "/"))
	if value == "." || value == ".." {
		return ""
	}
	var builder strings.Builder
	for _, character := range value {
		switch {
		case character >= 'a' && character <= 'z':
			builder.WriteRune(character)
		case character >= 'A' && character <= 'Z':
			builder.WriteRune(character)
		case character >= '0' && character <= '9':
			builder.WriteRune(character)
		case character == '.', character == '-', character == '_':
			builder.WriteRune(character)
		case character == ' ':
			builder.WriteByte('-')
		default:
			builder.WriteByte('-')
		}
	}
	result := strings.Trim(builder.String(), ".-_")
	return result
}
