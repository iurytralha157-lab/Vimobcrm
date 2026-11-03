package admin

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type homePublicationImageVariant uint8

const (
	homePublicationDesktopImage homePublicationImageVariant = iota
	homePublicationMobileImage
)

type homePublicationImageColumns struct {
	urlColumn     string
	storageColumn string
	directory     string
}

// SQL identifiers are selected only from this closed enum, never from a request.
func (variant homePublicationImageVariant) columns() (homePublicationImageColumns, error) {
	switch variant {
	case homePublicationDesktopImage:
		return homePublicationImageColumns{"image_url", "image_storage_path", ""}, nil
	case homePublicationMobileImage:
		return homePublicationImageColumns{"mobile_image_url", "mobile_image_storage_path", "mobile/"}, nil
	default:
		return homePublicationImageColumns{}, ErrInvalidInput
	}
}

func (variant homePublicationImageVariant) storagePath(record homePublicationRecord) string {
	if variant == homePublicationMobileImage {
		return record.MobileImageStoragePath
	}
	if variant == homePublicationDesktopImage {
		return record.ImageStoragePath
	}
	return ""
}

func (handler Handler) UploadHomePublicationImageAdmin(w http.ResponseWriter, r *http.Request) {
	handler.uploadHomePublicationImage(w, r, homePublicationDesktopImage)
}

func (handler Handler) UploadHomePublicationMobileImageAdmin(w http.ResponseWriter, r *http.Request) {
	handler.uploadHomePublicationImage(w, r, homePublicationMobileImage)
}

func (handler Handler) uploadHomePublicationImage(w http.ResponseWriter, r *http.Request, variant homePublicationImageVariant) {
	tenantContext, ok := adminContext(w, r)
	if !ok {
		return
	}
	id, valid := normalizeUUID(r.PathValue("id"))
	if !valid {
		writeHomePublicationError(w, r, ErrInvalidInput)
		return
	}
	contentType, body, cleanup, err := parseHomePublicationImage(w, r)
	if cleanup != nil {
		defer cleanup()
	}
	if err != nil {
		writeHomePublicationError(w, r, err)
		return
	}
	updated, previousPath, err := handler.repo.uploadHomePublicationImage(r.Context(), tenantContext, id, contentType, body, variant)
	if err != nil {
		writeHomePublicationError(w, r, err)
		return
	}
	response := homePublicationImageResponse{Data: updated.HomePublication}
	if previousPath != variant.storagePath(updated) && !handler.repo.cleanupHomePublicationObjects([]string{previousPath}) {
		response.CleanupWarning = "Image was replaced, but the previous object could not be removed."
	}
	httpserver.WriteJSON(w, http.StatusCreated, response)
}

func (handler Handler) DeleteHomePublicationImageAdmin(w http.ResponseWriter, r *http.Request) {
	handler.deleteHomePublicationImage(w, r, homePublicationDesktopImage)
}

func (handler Handler) DeleteHomePublicationMobileImageAdmin(w http.ResponseWriter, r *http.Request) {
	handler.deleteHomePublicationImage(w, r, homePublicationMobileImage)
}

func (handler Handler) deleteHomePublicationImage(w http.ResponseWriter, r *http.Request, variant homePublicationImageVariant) {
	tenantContext, ok := adminContext(w, r)
	if !ok {
		return
	}
	id, valid := normalizeUUID(r.PathValue("id"))
	if !valid {
		writeHomePublicationError(w, r, ErrInvalidInput)
		return
	}
	updated, previousPath, err := handler.repo.clearHomePublicationImage(r.Context(), tenantContext, id, variant)
	if err != nil {
		writeHomePublicationError(w, r, err)
		return
	}
	response := homePublicationImageResponse{Data: updated.HomePublication}
	if !handler.repo.cleanupHomePublicationObjects([]string{previousPath}) {
		response.CleanupWarning = "Image was detached, but the previous object could not be removed."
	}
	httpserver.WriteJSON(w, http.StatusOK, response)
}

type homePublicationImageResponse struct {
	Data           HomePublication `json:"data"`
	CleanupWarning string          `json:"cleanupWarning,omitempty"`
}

func (repo Repository) UploadHomePublicationImage(ctx context.Context, tenantContext tenant.Context, id, contentType string, body io.Reader) (homePublicationRecord, string, error) {
	return repo.uploadHomePublicationImage(ctx, tenantContext, id, contentType, body, homePublicationDesktopImage)
}

func (repo Repository) uploadHomePublicationImage(ctx context.Context, tenantContext tenant.Context, id, contentType string, body io.Reader, variant homePublicationImageVariant) (homePublicationRecord, string, error) {
	if !tenantContext.IsSuperAdmin {
		return homePublicationRecord{}, "", tenant.ErrOrganizationAccessDenied
	}
	columns, err := variant.columns()
	if err != nil || !isHomePublicationImageType(contentType) {
		return homePublicationRecord{}, "", ErrInvalidInput
	}
	current, err := repo.GetHomePublicationAdmin(ctx, tenantContext, id)
	if err != nil {
		return homePublicationRecord{}, "", err
	}
	token, err := randomInvitationToken()
	if err != nil {
		return homePublicationRecord{}, "", err
	}
	objectPath := fmt.Sprintf("platform/home/%s/%s%d-%s%s", id, columns.directory, time.Now().UTC().UnixMilli(), token[:16], homeImageExtension(contentType))
	if err := repo.uploadHomePublicationObject(ctx, objectPath, contentType, body); err != nil {
		return homePublicationRecord{}, "", err
	}
	imageURL := repo.homePublicationPublicURL(objectPath)
	query := fmt.Sprintf(`
		update public.home_publications
		set %s = $2, %s = $3, updated_by = $4::uuid
		where id = $1::uuid
		returning %s
	`, columns.urlColumn, columns.storageColumn, homePublicationSelectColumnsWithoutAlias)
	updated, err := scanHomePublication(repo.db.Pool().QueryRow(ctx, query, id, imageURL, objectPath, tenantContext.UserID))
	if err != nil {
		repo.cleanupHomePublicationObjects([]string{objectPath})
		if errors.Is(err, pgx.ErrNoRows) {
			return homePublicationRecord{}, "", ErrNotFound
		}
		return homePublicationRecord{}, "", err
	}
	return updated, variant.storagePath(current), nil
}

func (repo Repository) ClearHomePublicationImage(ctx context.Context, tenantContext tenant.Context, id string) (homePublicationRecord, string, error) {
	return repo.clearHomePublicationImage(ctx, tenantContext, id, homePublicationDesktopImage)
}

func (repo Repository) clearHomePublicationImage(ctx context.Context, tenantContext tenant.Context, id string, variant homePublicationImageVariant) (homePublicationRecord, string, error) {
	if !tenantContext.IsSuperAdmin {
		return homePublicationRecord{}, "", tenant.ErrOrganizationAccessDenied
	}
	columns, err := variant.columns()
	if err != nil {
		return homePublicationRecord{}, "", err
	}
	current, err := repo.GetHomePublicationAdmin(ctx, tenantContext, id)
	if err != nil {
		return homePublicationRecord{}, "", err
	}
	query := fmt.Sprintf(`
		update public.home_publications
		set %s = null, %s = null, updated_by = $2::uuid
		where id = $1::uuid
		returning %s
	`, columns.urlColumn, columns.storageColumn, homePublicationSelectColumnsWithoutAlias)
	updated, err := scanHomePublication(repo.db.Pool().QueryRow(ctx, query, id, tenantContext.UserID))
	if errors.Is(err, pgx.ErrNoRows) {
		return homePublicationRecord{}, "", ErrNotFound
	}
	if err != nil {
		return homePublicationRecord{}, "", err
	}
	return updated, variant.storagePath(current), nil
}

// Cleanup is best-effort after the DB change. Each owned object is attempted,
// even if deleting the other variant fails. Paths never enter API responses.
func (repo Repository) cleanupHomePublicationObjects(paths []string) bool {
	ok := true
	seen := make(map[string]bool, len(paths))
	for _, objectPath := range paths {
		if objectPath == "" || seen[objectPath] {
			continue
		}
		seen[objectPath] = true
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		err := repo.deleteHomePublicationObject(ctx, objectPath)
		cancel()
		if err != nil {
			ok = false
		}
	}
	return ok
}
