package stageconfig

import (
	"context"
	"errors"
)

var ErrInactivityRuntimeNotReady = errors.New("stage inactivity database prerequisites are not ready")

// A missing, invalid or differently shaped index must not fall back to a broad
// scan on the hot leads table. The future startup/writer must call this gate;
// the candidate cycle also checks it before acquiring any business row locks.
func (repo Repository) VerifyStageInactivityRuntime(ctx context.Context) error {
	var ready bool
	err := repo.db.Pool().QueryRow(ctx, inactivityRuntimeReadySQL).Scan(&ready)
	if err != nil {
		return err
	}
	if !ready {
		return ErrInactivityRuntimeNotReady
	}
	return nil
}

const inactivityRuntimeReadySQL = `select
 to_regclass('private.stage_inactivity_policies') is not null
 and to_regclass('private.stage_inactivity_jobs') is not null
 and to_regclass('private.stage_inactivity_lead_scopes') is not null
 and exists (
 select 1 from pg_catalog.pg_index definition
 join pg_catalog.pg_class index_relation on index_relation.oid=definition.indexrelid
 join pg_catalog.pg_am access_method on access_method.oid=index_relation.relam
 where definition.indrelid='public.leads'::regclass
   and index_relation.relname='idx_leads_simple_stage_inactivity_scan'
   and definition.indisvalid and definition.indisready
   and access_method.amname='btree' and definition.indnkeyatts=3
   and definition.indexprs is null
   and pg_catalog.pg_get_indexdef(definition.indexrelid,1,true)='organization_id'
   and pg_catalog.pg_get_indexdef(definition.indexrelid,2,true)='stage_id'
   and pg_catalog.pg_get_indexdef(definition.indexrelid,3,true)='id'
   and regexp_replace(pg_catalog.pg_get_expr(definition.indpred,definition.indrelid),
     '[[:space:]()]','','g')='deal_status=''open''::textANDoperational_effects_suppressed=false'
 )`
