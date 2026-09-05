package whatsapp

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

type whatsappMediaPrivilegeQuerier interface {
	QueryRow(context.Context, string, ...any) pgx.Row
}

type whatsappMediaDatabasePrivileges struct {
	principal              string
	privateSchemaUsage     bool
	mediaJobsSelect        bool
	mediaJobsInsert        bool
	mediaJobsUpdate        bool
	workerStateSelect      bool
	workerStateInsert      bool
	workerStateUpdate      bool
	claimExecute           bool
	renewExecute           bool
	mediaJobsRowSecurityOn bool
	mediaJobsRLSActive     bool
}

// ValidateMediaWorkerDatabasePrivileges checks the exact database principal
// behind DATABASE_URL before app.New starts any background worker. It never
// grants privileges: a misconfigured principal keeps the API fail-closed.
func ValidateMediaWorkerDatabasePrivileges(ctx context.Context, database *dbpkg.Postgres) error {
	if database == nil || database.Pool() == nil {
		return fmt.Errorf("WhatsApp media worker database is unavailable")
	}
	return validateMediaWorkerDatabasePrivileges(ctx, database.Pool())
}

func validateMediaWorkerDatabasePrivileges(ctx context.Context, querier whatsappMediaPrivilegeQuerier) error {
	var privileges whatsappMediaDatabasePrivileges
	err := querier.QueryRow(ctx, `
		select
			current_user::text,
			coalesce(pg_catalog.has_schema_privilege(current_user, 'private', 'usage'), false),
			coalesce(pg_catalog.has_table_privilege(current_user, pg_catalog.to_regclass('public.media_jobs'), 'select'), false),
			coalesce(pg_catalog.has_table_privilege(current_user, pg_catalog.to_regclass('public.media_jobs'), 'insert'), false),
			coalesce(pg_catalog.has_table_privilege(current_user, pg_catalog.to_regclass('public.media_jobs'), 'update'), false),
			coalesce(pg_catalog.has_table_privilege(current_user, pg_catalog.to_regclass('private.whatsapp_media_worker_state'), 'select'), false),
			coalesce(pg_catalog.has_table_privilege(current_user, pg_catalog.to_regclass('private.whatsapp_media_worker_state'), 'insert'), false),
			coalesce(pg_catalog.has_table_privilege(current_user, pg_catalog.to_regclass('private.whatsapp_media_worker_state'), 'update'), false),
			coalesce(pg_catalog.has_function_privilege(current_user, pg_catalog.to_regprocedure('private.claim_whatsapp_media_job(text,interval,uuid[])'), 'execute'), false),
			coalesce(pg_catalog.has_function_privilege(current_user, pg_catalog.to_regprocedure('private.renew_whatsapp_media_job(uuid,text,uuid)'), 'execute'), false),
			coalesce((
				select relation.relrowsecurity
				from pg_catalog.pg_class as relation
				where relation.oid = pg_catalog.to_regclass('public.media_jobs')
			), false),
			case
				when pg_catalog.to_regclass('public.media_jobs') is null then true
				else pg_catalog.row_security_active(pg_catalog.to_regclass('public.media_jobs'))
			end
	`).Scan(
		&privileges.principal,
		&privileges.privateSchemaUsage,
		&privileges.mediaJobsSelect,
		&privileges.mediaJobsInsert,
		&privileges.mediaJobsUpdate,
		&privileges.workerStateSelect,
		&privileges.workerStateInsert,
		&privileges.workerStateUpdate,
		&privileges.claimExecute,
		&privileges.renewExecute,
		&privileges.mediaJobsRowSecurityOn,
		&privileges.mediaJobsRLSActive,
	)
	if err != nil {
		return fmt.Errorf("inspect WhatsApp media worker database privileges: %w", err)
	}

	missing := make([]string, 0, 11)
	for _, requirement := range []struct {
		name    string
		granted bool
	}{
		{name: "USAGE private schema", granted: privileges.privateSchemaUsage},
		{name: "SELECT public.media_jobs", granted: privileges.mediaJobsSelect},
		{name: "INSERT public.media_jobs", granted: privileges.mediaJobsInsert},
		{name: "UPDATE public.media_jobs", granted: privileges.mediaJobsUpdate},
		{name: "SELECT private.whatsapp_media_worker_state", granted: privileges.workerStateSelect},
		{name: "INSERT private.whatsapp_media_worker_state", granted: privileges.workerStateInsert},
		{name: "UPDATE private.whatsapp_media_worker_state", granted: privileges.workerStateUpdate},
		{name: "EXECUTE private.claim_whatsapp_media_job", granted: privileges.claimExecute},
		{name: "EXECUTE private.renew_whatsapp_media_job", granted: privileges.renewExecute},
		{name: "RLS enabled on public.media_jobs", granted: privileges.mediaJobsRowSecurityOn},
		{name: "row_security_active(public.media_jobs) = false", granted: !privileges.mediaJobsRLSActive},
	} {
		if !requirement.granted {
			missing = append(missing, requirement.name)
		}
	}
	if len(missing) > 0 {
		return fmt.Errorf(
			"database principal %q cannot start the WhatsApp media worker; missing: %s",
			privileges.principal,
			strings.Join(missing, ", "),
		)
	}
	return nil
}
