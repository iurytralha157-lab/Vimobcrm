package leads

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgconn"
)

type importReentryExecutor interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
}

// applyImportReentry records an imported return without moving an existing
// business or bypassing its stage, reservation and assignment workflows.
// A missing optional contact field is not a request to erase its stored value.
// Authorization and the organization/queue identity lock belong to the caller.
func applyImportReentry(ctx context.Context, executor importReentryExecutor, organizationID, leadID string, input createInput) error {
	if !input.ImportMode {
		return fmt.Errorf("%w: import reentry requires importMode", ErrInvalidInput)
	}
	return applyConservativeLeadReentry(ctx, executor, organizationID, leadID, input)
}

// An implicit duplicate from either create flow records the return and optional
// contact data. Commercial and assignment changes use their explicit workflows.
func applyConservativeLeadReentry(ctx context.Context, executor importReentryExecutor, organizationID, leadID string, input createInput) error {

	result, err := executor.Exec(ctx, `
		update public.leads
		set name = $3,
		    email = coalesce($4, email),
		    message = coalesce($5, message),
		    source = coalesce(source, $6),
		    last_entry_at = now(),
		    reentry_count = coalesce(reentry_count, 0) + 1,
		    updated_at = now()
		where organization_id = $1::uuid
		  and id = $2::uuid
	`, organizationID, leadID, input.Name, nullable(input.Email), nullable(input.Message), input.Source)
	if err != nil {
		return err
	}
	if result.RowsAffected() == 0 {
		return ErrLeadNotFound
	}
	return nil
}
