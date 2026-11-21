package settings

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type organizationModuleScanner interface {
	Scan(dest ...any) error
}

func (repo Repository) ListOrganizationModules(ctx context.Context, tenantContext tenant.Context) ([]OrganizationModule, error) {
	rows, err := repo.db.Pool().Query(ctx, `
		select
			id::text,
			organization_id::text,
			module_name,
			coalesce(is_enabled, false),
			created_at::text,
			updated_at::text
		from public.organization_modules
		where organization_id = $1::uuid
		order by module_name asc
	`, tenantContext.OrganizationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []OrganizationModule{}
	for rows.Next() {
		item, err := scanOrganizationModule(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}

	return items, rows.Err()
}

func (repo Repository) GetSetupGuideProgress(ctx context.Context, tenantContext tenant.Context) (SetupGuideProgress, error) {
	var completedRaw []byte
	var skipped pgtype.Bool

	err := repo.db.Pool().QueryRow(ctx, `
		select coalesce(completed_steps, '{}'::jsonb), skipped
		from public.setup_guide_progress
		where user_id = $1::uuid
	`, tenantContext.UserID).Scan(&completedRaw, &skipped)
	if errors.Is(err, pgx.ErrNoRows) || isUndefinedTableError(err) {
		return SetupGuideProgress{
			CompletedSteps: map[string]bool{},
			Skipped:        false,
		}, nil
	}
	if err != nil {
		return SetupGuideProgress{}, err
	}

	completed := map[string]bool{}
	if len(completedRaw) > 0 {
		if err := json.Unmarshal(completedRaw, &completed); err != nil {
			return SetupGuideProgress{}, err
		}
	}

	return SetupGuideProgress{
		CompletedSteps: completed,
		Skipped:        skipped.Valid && skipped.Bool,
	}, nil
}

func (repo Repository) UpdateSetupGuideProgress(ctx context.Context, tenantContext tenant.Context, request UpdateSetupGuideProgressRequest) (SetupGuideProgress, error) {
	completed := request.CompletedSteps
	if completed == nil {
		current, err := repo.GetSetupGuideProgress(ctx, tenantContext)
		if err != nil {
			return SetupGuideProgress{}, err
		}
		completed = current.CompletedSteps
	}
	if completed == nil {
		completed = map[string]bool{}
	}
	skipped := false
	if request.Skipped != nil {
		skipped = *request.Skipped
	} else {
		current, err := repo.GetSetupGuideProgress(ctx, tenantContext)
		if err != nil {
			return SetupGuideProgress{}, err
		}
		skipped = current.Skipped
	}

	completedRaw, err := json.Marshal(completed)
	if err != nil {
		return SetupGuideProgress{}, ErrInvalidInput
	}

	_, err = repo.db.Pool().Exec(ctx, `
		insert into public.setup_guide_progress (user_id, completed_steps, skipped)
		values ($1::uuid, $2::jsonb, $3)
		on conflict (user_id) do update
		set completed_steps = excluded.completed_steps,
		    skipped = excluded.skipped,
		    updated_at = now()
	`, tenantContext.UserID, string(completedRaw), skipped)
	if isUndefinedTableError(err) {
		return SetupGuideProgress{CompletedSteps: completed, Skipped: skipped}, nil
	}
	if err != nil {
		return SetupGuideProgress{}, err
	}

	return SetupGuideProgress{CompletedSteps: completed, Skipped: skipped}, nil
}

func scanOrganizationModule(row organizationModuleScanner) (OrganizationModule, error) {
	var item OrganizationModule
	err := row.Scan(
		&item.ID,
		&item.OrganizationID,
		&item.ModuleName,
		&item.IsEnabled,
		&item.CreatedAt,
		&item.UpdatedAt,
	)
	return item, err
}
