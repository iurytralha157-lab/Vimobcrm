package properties

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const propertyImagesBucket = "properties"

type PropertyImageUploadResponse struct {
	Data PropertyImageUpload `json:"data"`
}

type PropertyImageUpload struct {
	URL         string `json:"url"`
	Path        string `json:"path"`
	Bucket      string `json:"bucket"`
	ContentType string `json:"contentType"`
	Size        int64  `json:"size"`
}

type propertyImageUploadInput struct {
	PropertyID       string
	OriginalFileName string
	ContentType      string
	Size             int64
	Body             io.Reader
}

func (repo Repository) UploadImage(ctx context.Context, tenantContext tenant.Context, input propertyImageUploadInput) (PropertyImageUploadResponse, error) {
	propertyFolder := "temp"
	propertyID := strings.TrimSpace(input.PropertyID)
	if propertyID == "" {
		if !canManageProperties(tenantContext) {
			return PropertyImageUploadResponse{}, tenant.ErrOrganizationAccessDenied
		}
	} else {
		normalizedPropertyID, ok := normalizeUUID(propertyID)
		if !ok {
			return PropertyImageUploadResponse{}, ErrPropertyNotFound
		}
		propertyID = normalizedPropertyID
		if err := repo.ensureCanUploadImage(ctx, tenantContext, propertyID); err != nil {
			return PropertyImageUploadResponse{}, err
		}
		propertyFolder = propertyID
	}

	objectPath, err := newPropertyImageObjectPath(tenantContext.OrganizationID, propertyFolder, input.ContentType)
	if err != nil {
		return PropertyImageUploadResponse{}, err
	}

	if err := repo.storage.upload(ctx, propertyImagesBucket, objectPath, input.ContentType, input.Body); err != nil {
		return PropertyImageUploadResponse{}, err
	}

	return PropertyImageUploadResponse{
		Data: PropertyImageUpload{
			URL:         repo.storage.publicURL(propertyImagesBucket, objectPath),
			Path:        objectPath,
			Bucket:      propertyImagesBucket,
			ContentType: input.ContentType,
			Size:        input.Size,
		},
	}, nil
}

func (repo Repository) ensureCanUploadImage(ctx context.Context, tenantContext tenant.Context, propertyID string) error {
	var creatorID pgtype.Text
	err := repo.db.Pool().QueryRow(ctx, `
		select coalesce(responsible_user_id::text, created_by::text, '')
		from public.properties
		where organization_id = $1::uuid
		  and id = $2::uuid
		limit 1
	`, tenantContext.OrganizationID, propertyID).Scan(&creatorID)
	if err == pgx.ErrNoRows {
		return ErrPropertyNotFound
	}
	if err != nil {
		return err
	}
	if !canEditProperty(tenantContext, textValue(creatorID)) {
		return tenant.ErrOrganizationAccessDenied
	}

	return nil
}

func newPropertyImageObjectPath(organizationID string, propertyFolder string, contentType string) (string, error) {
	token, err := randomImageToken()
	if err != nil {
		return "", err
	}

	return fmt.Sprintf(
		"orgs/%s/properties/%s/%d-%s%s",
		organizationID,
		propertyFolder,
		time.Now().UTC().UnixMilli(),
		token,
		imageExtension(contentType),
	), nil
}

func randomImageToken() (string, error) {
	var bytes [8]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "", err
	}

	return hex.EncodeToString(bytes[:]), nil
}

func imageExtension(contentType string) string {
	switch strings.ToLower(strings.TrimSpace(contentType)) {
	case "image/jpeg":
		return ".jpg"
	case "image/png":
		return ".png"
	case "image/webp":
		return ".webp"
	case "image/gif":
		return ".gif"
	default:
		return ".bin"
	}
}
