package properties

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func portfolioSettingsResponse(raw string, revision int64, updatedAt *time.Time, updatedBy *string) PortfolioSettingsResponse {
	response := PortfolioSettingsResponse{
		Settings:  portfolioSettingsWithDefaults(decodeStoredPortfolioSettings(raw)),
		Revision:  revision,
		UpdatedBy: updatedBy,
	}
	if updatedAt != nil {
		formatted := updatedAt.UTC().Format(time.RFC3339Nano)
		response.UpdatedAt = &formatted
	}
	return response
}

// GetPortfolioSettings returns revision 0 and the defaults until the first save.
func (repo Repository) GetPortfolioSettings(ctx context.Context, tenantContext tenant.Context) (PortfolioSettingsResponse, error) {
	var raw string
	var revision int64
	var updatedAt time.Time
	var updatedBy *string
	err := repo.db.Pool().QueryRow(ctx, `
		select settings::text, revision::bigint, updated_at, updated_by::text
		from public.property_settings
		where organization_id = $1::uuid
	`, tenantContext.OrganizationID).Scan(&raw, &revision, &updatedAt, &updatedBy)
	if errors.Is(err, pgx.ErrNoRows) {
		return portfolioSettingsResponse("{}", 0, nil, nil), nil
	}
	if err != nil {
		return PortfolioSettingsResponse{}, err
	}
	return portfolioSettingsResponse(raw, revision, &updatedAt, updatedBy), nil
}

// UpdatePortfolioSettings merges by key: omitted groups and keys keep the stored
// value. The row lock and the revision comparison make a stale writer fail
// instead of overwriting a newer save. Revision 0 means "no saved settings yet".
func (repo Repository) UpdatePortfolioSettings(ctx context.Context, tenantContext tenant.Context, input UpdatePortfolioSettingsInput) (PortfolioSettingsResponse, error) {
	if input.Settings == nil {
		return PortfolioSettingsResponse{}, fmt.Errorf("%w: settings is required", ErrInvalidInput)
	}
	if input.Revision == nil || *input.Revision < 0 || *input.Revision > math.MaxInt32 {
		return PortfolioSettingsResponse{}, fmt.Errorf("%w: revision is required", ErrInvalidInput)
	}
	patch, err := validatePortfolioSettingsPatch(input.Settings)
	if err != nil {
		return PortfolioSettingsResponse{}, err
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return PortfolioSettingsResponse{}, err
	}
	defer tx.Rollback(ctx)

	var storedRaw string
	if *input.Revision == 0 {
		// A concurrent first save takes the conflict path below.
		storedRaw = "{}"
	} else {
		var storedRevision int64
		err = tx.QueryRow(ctx, `
			select settings::text, revision::bigint
			from public.property_settings
			where organization_id = $1::uuid
			for update
		`, tenantContext.OrganizationID).Scan(&storedRaw, &storedRevision)
		if errors.Is(err, pgx.ErrNoRows) {
			return PortfolioSettingsResponse{}, ErrPropertySettingsConflict
		}
		if err != nil {
			return PortfolioSettingsResponse{}, err
		}
		if storedRevision != *input.Revision {
			return PortfolioSettingsResponse{}, ErrPropertySettingsConflict
		}
	}

	encoded, err := json.Marshal(mergePortfolioSettings(decodeStoredPortfolioSettings(storedRaw), patch))
	if err != nil {
		return PortfolioSettingsResponse{}, err
	}

	var raw string
	var revision int64
	var updatedAt time.Time
	var updatedBy *string
	if *input.Revision == 0 {
		err = tx.QueryRow(ctx, `
			insert into public.property_settings (organization_id, settings, updated_by)
			values ($1::uuid, $2::jsonb, nullif($3, '')::uuid)
			on conflict (organization_id) do nothing
			returning settings::text, revision::bigint, updated_at, updated_by::text
		`, tenantContext.OrganizationID, string(encoded), tenantContext.UserID).Scan(&raw, &revision, &updatedAt, &updatedBy)
		if errors.Is(err, pgx.ErrNoRows) {
			return PortfolioSettingsResponse{}, ErrPropertySettingsConflict
		}
	} else {
		err = tx.QueryRow(ctx, `
			update public.property_settings
			set settings = $2::jsonb,
			    updated_by = nullif($3, '')::uuid,
			    updated_at = now(),
			    revision = revision + 1
			where organization_id = $1::uuid
			returning settings::text, revision::bigint, updated_at, updated_by::text
		`, tenantContext.OrganizationID, string(encoded), tenantContext.UserID).Scan(&raw, &revision, &updatedAt, &updatedBy)
	}
	if err != nil {
		return PortfolioSettingsResponse{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return PortfolioSettingsResponse{}, err
	}
	return portfolioSettingsResponse(raw, revision, &updatedAt, updatedBy), nil
}

func (handler Handler) ShowPortfolioSettings(w http.ResponseWriter, r *http.Request) {
	setPropertyWorkspacePrivateHeaders(w)
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}
	response, err := handler.repo.GetPortfolioSettings(r.Context(), tenantContext)
	if err != nil {
		writePropertyError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, map[string]PortfolioSettingsResponse{"data": response})
}

func (handler Handler) UpdatePortfolioSettings(w http.ResponseWriter, r *http.Request) {
	setPropertyWorkspacePrivateHeaders(w)
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return
	}
	defer r.Body.Close()
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, portfolioSettingsBodyLimit))
	decoder.UseNumber()
	decoder.DisallowUnknownFields()
	var input UpdatePortfolioSettingsInput
	if err := decoder.Decode(&input); err != nil {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
		return
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
		return
	}
	response, err := handler.repo.UpdatePortfolioSettings(r.Context(), tenantContext, input)
	if err != nil {
		writePropertyError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, map[string]PortfolioSettingsResponse{"data": response})
}
