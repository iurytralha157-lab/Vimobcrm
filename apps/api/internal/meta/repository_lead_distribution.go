package meta

import (
	"context"

	"github.com/jackc/pgx/v5/pgconn"
)

type metaRedistributionExecutor interface {
	Exec(ctx context.Context, sql string, arguments ...any) (pgconn.CommandTag, error)
}

func (repo Repository) insertLeadRedistributionJob(ctx context.Context, executor metaRedistributionExecutor, organizationID string, leadID string, destination resolvedDestination, change leadgenChange, distributionReason string) error {
	if destination.RoundRobinID == nil {
		return nil
	}
	if destination.AssignedUserID == nil {
		if distributionReason != "no_available_members" {
			return nil
		}
		return repo.insertMetaInitialDistributionJob(ctx, executor, organizationID, leadID, destination, change)
	}

	settings := destination.RedistributionSettings
	if !boolSetting(settings, "enable_redistribution") {
		return nil
	}

	timeoutMinutes := intSetting(settings, "redistribution_timeout_minutes", 0)
	if timeoutMinutes <= 0 {
		return nil
	}
	warningMinutes := intSetting(settings, "redistribution_warning_minutes", 5)
	if warningMinutes < 0 {
		warningMinutes = 0
	}
	maxAttempts := intSetting(settings, "redistribution_max_attempts", 1)
	if maxAttempts < 0 {
		maxAttempts = 0
	}

	_, err := executor.Exec(ctx, `
		insert into public.lead_redistribution_jobs (
			organization_id,
			lead_id,
			round_robin_id,
			original_assigned_user_id,
			current_assigned_user_id,
			max_attempts,
			timeout_minutes,
			warning_minutes,
			enrolled_at,
			due_at,
			warning_due_at,
			metadata
		)
		values (
			$1::uuid,
			$2::uuid,
			$3::uuid,
			$4::uuid,
			$4::uuid,
			$5,
			$6,
			$7,
			now(),
			now() + ($6 * interval '1 minute'),
			case
			  when $7::integer > 0 and $7::integer < $6::integer
			    then now() + (($6::integer - $7::integer) * interval '1 minute')
				else null
			end,
			$8::jsonb
		)
		on conflict do nothing
	`, organizationID, leadID, *destination.RoundRobinID, *destination.AssignedUserID, maxAttempts, timeoutMinutes, warningMinutes, jsonb(map[string]any{
		"source":     "meta_lead_ads",
		"leadgen_id": change.LeadgenID,
		"form_id":    change.FormID,
		"page_id":    change.PageID,
		"member_id":  nullablePointer(destination.RoundRobinMemberID),
	}))
	return err
}

func (repo Repository) insertMetaInitialDistributionJob(ctx context.Context, executor metaRedistributionExecutor, organizationID string, leadID string, destination resolvedDestination, change leadgenChange) error {
	if destination.RoundRobinID == nil {
		return nil
	}

	settings := destination.RedistributionSettings
	timeoutMinutes := min(10080, max(1, intSetting(settings, "redistribution_timeout_minutes", 20)))
	warningMinutes := max(0, intSetting(settings, "redistribution_warning_minutes", 5))
	warningMinutes = min(warningMinutes, timeoutMinutes-1)
	maxAttempts := min(1000, max(0, intSetting(settings, "redistribution_max_attempts", 10)))

	_, err := executor.Exec(ctx, `
		insert into public.lead_redistribution_jobs (
			organization_id,
			lead_id,
			round_robin_id,
			original_assigned_user_id,
			current_assigned_user_id,
			max_attempts,
			timeout_minutes,
			warning_minutes,
			enrolled_at,
			due_at,
			warning_due_at,
			metadata
		)
		values (
			$1::uuid,
			$2::uuid,
			$3::uuid,
			null,
			null,
			$4,
			$5,
			$6,
			now(),
			now(),
			null,
			$7::jsonb
		)
		on conflict do nothing
	`, organizationID, leadID, *destination.RoundRobinID, maxAttempts, timeoutMinutes, warningMinutes, jsonb(map[string]any{
		"source":                        "meta_lead_ads",
		"initial_distribution_pending":  true,
		"allow_assigned_redistribution": false,
		"leadgen_id":                    change.LeadgenID,
		"form_id":                       change.FormID,
		"page_id":                       change.PageID,
	}))
	return err
}
