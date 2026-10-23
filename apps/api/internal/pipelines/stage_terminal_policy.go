package pipelines

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// Automations are written under the same stage lock. Only native-flag edits
// invoke this inverse validation, so unrelated edits preserve legacy behavior.
func ensureNativeStageStatusCompatible(ctx context.Context, tx pgx.Tx, organizationID, stageID string, won, lost bool) error {
	if !won && !lost {
		return nil
	}
	nativeStatus := "lost"
	if won {
		nativeStatus = "won"
	}
	var conflict bool
	err := tx.QueryRow(ctx, `select exists (
 select 1 from public.stage_automations automation
 cross join lateral (select to_jsonb(automation) as data) raw
 cross join lateral (select
   case when raw.data ? 'action_config' then raw.data else coalesce(raw.data->'config','{}'::jsonb) end as config
 ) resolved
 where automation.organization_id=$1::uuid and automation.stage_id=$2::uuid
   and automation.trigger_type='on_enter' and coalesce(automation.is_active,false)
   and coalesce(resolved.config->>'automation_type',resolved.config->>'action_type','')='change_deal_status_on_enter'
   and lower(btrim(resolved.config#>>'{action_config,deal_status}')) in ('open','won','lost')
   and lower(btrim(resolved.config#>>'{action_config,deal_status}')) <> $3
)`, organizationID, stageID, nativeStatus).Scan(&conflict)
	if err != nil {
		return err
	}
	if conflict {
		return fmt.Errorf("%w: native stage status conflicts with an active on-enter status automation", ErrInvalidInput)
	}
	return nil
}
