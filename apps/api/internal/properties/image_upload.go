package properties

import (
	"context"
	"errors"
	"io"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

var ErrLegacyPropertyImageUploadRetired = errors.New("legacy property image upload endpoint retired")

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
	return PropertyImageUploadResponse{}, ErrLegacyPropertyImageUploadRetired
}
