package attention

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func (repo Repository) GetSettings(ctx context.Context, tenantContext tenant.Context) (Settings, error) {
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return Settings{}, err
	}
	defer tx.Rollback(ctx)
	if err := repo.ensureOrganizationSettings(ctx, tx, tenantContext); err != nil {
		return Settings{}, err
	}
	settings, err := scanSettings(tx.QueryRow(ctx, settingsSelectSQL(), tenantContext.OrganizationID))
	if err != nil {
		return Settings{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Settings{}, err
	}
	return settings, nil
}

func (repo Repository) UpdateSettings(ctx context.Context, tenantContext tenant.Context, request SettingsRequest) (Settings, error) {
	if !canManagePolicies(tenantContext) {
		return Settings{}, ErrForbidden
	}
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return Settings{}, err
	}
	defer tx.Rollback(ctx)
	if err := repo.ensureOrganizationSettings(ctx, tx, tenantContext); err != nil {
		return Settings{}, err
	}
	current, err := scanSettings(tx.QueryRow(ctx, settingsSelectSQL()+" for update", tenantContext.OrganizationID))
	if err != nil {
		return Settings{}, err
	}

	engineMode := current.EngineMode
	if request.EngineMode != nil {
		engineMode = strings.ToLower(strings.TrimSpace(*request.EngineMode))
		if engineMode != "disabled" && engineMode != "shadow" && engineMode != "enabled" {
			return Settings{}, fmt.Errorf("%w: engineMode is invalid", ErrInvalidInput)
		}
	}
	notificationsEnabled := current.NotificationsEnabled
	if request.NotificationsEnabled != nil {
		notificationsEnabled = *request.NotificationsEnabled
	}
	redistributionEnabled := current.RedistributionEnabled
	if request.RedistributionEnabled != nil {
		redistributionEnabled = *request.RedistributionEnabled
	}
	timezone := current.Timezone
	if request.Timezone != nil {
		timezone = strings.TrimSpace(*request.Timezone)
		if _, err := time.LoadLocation(timezone); err != nil {
			return Settings{}, fmt.Errorf("%w: timezone is invalid", ErrInvalidInput)
		}
	}
	businessHours := current.BusinessHours
	if request.BusinessHours != nil {
		parsed, err := ParseBusinessHours(*request.BusinessHours)
		if err != nil {
			return Settings{}, fmt.Errorf("%w: businessHours is invalid: %v", ErrInvalidInput, err)
		}
		businessHours, _ = json.Marshal(parsed)
	}
	defaultRepeat := current.DefaultRepeatMinutes
	if request.DefaultRepeatMinutes != nil {
		defaultRepeat = *request.DefaultRepeatMinutes
		if defaultRepeat <= 0 {
			return Settings{}, fmt.Errorf("%w: defaultRepeatMinutes must be positive", ErrInvalidInput)
		}
	}
	maxReminders := current.MaxReminders
	if request.MaxReminders != nil {
		maxReminders = *request.MaxReminders
		if maxReminders < 0 {
			return Settings{}, fmt.Errorf("%w: maxReminders must be non-negative", ErrInvalidInput)
		}
	}

	_, err = tx.Exec(ctx, `
		update public.organization_attention_settings
		set engine_mode = $2, notifications_enabled = $3,
		    redistribution_enabled = $4, timezone = $5,
		    business_hours = $6::jsonb, default_repeat_minutes = $7,
		    max_reminders = $8, updated_at = now()
		where organization_id = $1::uuid
	`, tenantContext.OrganizationID, engineMode, notificationsEnabled,
		redistributionEnabled, timezone, string(businessHours), defaultRepeat, maxReminders)
	if err != nil {
		return Settings{}, err
	}
	updated, err := scanSettings(tx.QueryRow(ctx, settingsSelectSQL(), tenantContext.OrganizationID))
	if err != nil {
		return Settings{}, err
	}
	_, err = tx.Exec(ctx, `
		insert into public.audit_logs (
			organization_id, user_id, action, entity_type, entity_id, old_data, new_data
		) values ($1::uuid, $2::uuid, 'attention_settings_updated', 'organization_attention_settings', ($1::uuid)::text, $3::jsonb, $4::jsonb)
	`, tenantContext.OrganizationID, tenantContext.UserID, jsonValue(current), jsonValue(updated))
	if err != nil {
		return Settings{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Settings{}, err
	}
	return updated, nil
}

func (repo Repository) ensureOrganizationSettings(ctx context.Context, tx pgx.Tx, tenantContext tenant.Context) error {
	_, err := tx.Exec(ctx, `
		insert into public.organization_attention_settings (organization_id, created_by)
		values ($1::uuid, $2::uuid)
		on conflict (organization_id) do nothing
	`, tenantContext.OrganizationID, tenantContext.UserID)
	if err != nil {
		return err
	}
	// Organizations created after the migration get the same conservative shadow
	// starters. The unique current-scope index makes this idempotent.
	_, err = tx.Exec(ctx, `
		insert into public.lead_attention_policies (
			organization_id, name, policy_type, status,
			threshold_minutes, warning_minutes, repeat_minutes, escalation_minutes,
			redistribute_before_contact_only, config, created_by
		)
		select $1::uuid, seeded.name, seeded.policy_type, 'shadow',
		       seeded.threshold_minutes, seeded.warning_minutes, 1440, seeded.escalation_minutes,
		       true, jsonb_build_object('seeded', true, 'source', 'settings_lazy_seed'), $2::uuid
		from (values
			('Primeiro contato em ate 1 hora'::text, 'first_contact'::text, 60, 15, 1440),
			('Lead sem responsavel'::text, 'unassigned'::text, 15, 5, 60)
		) seeded(name, policy_type, threshold_minutes, warning_minutes, escalation_minutes)
		where not exists (
			select 1 from public.lead_attention_policies p
			where p.organization_id = $1::uuid
			  and p.policy_type = seeded.policy_type
			  and p.pipeline_id is null and p.stage_id is null
			  and p.status <> 'archived'
		)
		on conflict do nothing
	`, tenantContext.OrganizationID, tenantContext.UserID)
	return err
}

func settingsSelectSQL() string {
	return `
		select organization_id::text, engine_mode, notifications_enabled,
		       redistribution_enabled, timezone, business_hours,
		       default_repeat_minutes, max_reminders,
		       created_by::text, created_at, updated_at
		from public.organization_attention_settings
		where organization_id = $1::uuid
	`
}

func scanSettings(row scanner) (Settings, error) {
	var settings Settings
	var businessHours []byte
	var createdBy pgtype.Text
	err := row.Scan(
		&settings.OrganizationID, &settings.EngineMode,
		&settings.NotificationsEnabled, &settings.RedistributionEnabled,
		&settings.Timezone, &businessHours,
		&settings.DefaultRepeatMinutes, &settings.MaxReminders,
		&createdBy, &settings.CreatedAt, &settings.UpdatedAt,
	)
	if err != nil {
		return Settings{}, err
	}
	settings.BusinessHours = append(json.RawMessage(nil), businessHours...)
	settings.CreatedBy = textPointer(createdBy)
	return settings, nil
}
