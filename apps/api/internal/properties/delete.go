package properties

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const deletionInterestArraySQL = `case when jsonb_typeof(lead.metadata->'interestPropertyIds') = 'array'
	then lead.metadata->'interestPropertyIds' else '[]'::jsonb end`

const deletionInterestMatchSQL = `jsonb_typeof(interest.value) = 'string'
	and lower(btrim(interest.value #>> '{}')) = $2::uuid::text`

const directLeadPropertyLinksSQL = `(lead.property_id = $2::uuid or lead.interest_property_id = $2::uuid or exists (
	select 1 from jsonb_array_elements(` + deletionInterestArraySQL + `) as interest(value)
	where ` + deletionInterestMatchSQL + `
))`

const deletionLinkedLeadCountSQL = `(
	select count(*) from public.leads as lead
	where lead.organization_id = $1::uuid and (` + directLeadPropertyLinksSQL + ` or exists (
		select 1 from public.lead_property_interests as portal_interest
		where portal_interest.lead_id = lead.id and portal_interest.property_id = $2::uuid
	))
)`

func (repo Repository) DeletionImpact(ctx context.Context, actor tenant.Context, propertyID string) (PropertyDeletionImpact, error) {
	propertyID, ok := normalizeUUID(propertyID)
	if !ok {
		return PropertyDeletionImpact{}, ErrPropertyNotFound
	}
	if !canDeleteProperties(actor) {
		return PropertyDeletionImpact{}, tenant.ErrOrganizationAccessDenied
	}
	var impact PropertyDeletionImpact
	err := repo.db.Pool().QueryRow(ctx, `
		select `+deletionLinkedLeadCountSQL+`
		from public.properties
		where organization_id = $1::uuid and id = $2::uuid
	`, actor.OrganizationID, propertyID).Scan(&impact.LinkedLeadsCount)
	if errors.Is(err, pgx.ErrNoRows) {
		return PropertyDeletionImpact{}, ErrPropertyNotFound
	}
	return impact, err
}

func (repo Repository) Delete(ctx context.Context, actor tenant.Context, propertyID string, input DeletePropertyInput) error {
	propertyID, ok := normalizeUUID(propertyID)
	if !ok {
		return ErrPropertyNotFound
	}
	if !canDeleteProperties(actor) {
		return tenant.ErrOrganizationAccessDenied
	}
	if err := input.Validate(); err != nil {
		return err
	}
	expectedUpdatedAt, err := time.Parse(time.RFC3339Nano, strings.TrimSpace(input.ExpectedUpdatedAt))
	if err != nil {
		return fmt.Errorf("%w: expected_updated_at must be an RFC3339 timestamp", ErrInvalidInput)
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	var currentUpdatedAt time.Time
	var currentCode string
	err = tx.QueryRow(ctx, `
		select updated_at, coalesce(code, '')
		from public.properties
		where organization_id = $1::uuid and id = $2::uuid
		for update
	`, actor.OrganizationID, propertyID).Scan(&currentUpdatedAt, &currentCode)
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrPropertyNotFound
	}
	if err != nil {
		return err
	}
	if !currentUpdatedAt.Equal(expectedUpdatedAt) {
		return ErrPropertyWorkspaceConflict
	}

	var linkedLeadsCount int64
	var hasForeignLeadLinks bool
	// The older lead foreign keys do not include organization_id. Avoid a
	// cascading update or removal of an inconsistent cross-tenant relationship.
	err = tx.QueryRow(ctx, `select `+deletionLinkedLeadCountSQL+`, exists (
		select 1 from public.leads as lead
		where lead.organization_id is distinct from $1::uuid
		  and (lead.property_id = $2::uuid or lead.interest_property_id = $2::uuid)
		union all
		select 1 from public.lead_property_interests as interest
		join public.leads as lead on lead.id = interest.lead_id
		where interest.property_id = $2::uuid and lead.organization_id is distinct from $1::uuid
	)`, actor.OrganizationID, propertyID).Scan(&linkedLeadsCount, &hasForeignLeadLinks)
	if err != nil {
		return err
	}
	if hasForeignLeadLinks {
		return ErrPropertyHasDependencies
	}
	if input.ExpectedLinkedLeadsCount == nil && linkedLeadsCount > 0 {
		return ErrPropertyHasLinkedLeads
	}
	if input.ExpectedLinkedLeadsCount != nil && *input.ExpectedLinkedLeadsCount != linkedLeadsCount {
		return ErrPropertyDeleteImpactChanged
	}
	if linkedLeadsCount > 0 {
		// Lead updates can take their row lock before a property lock. Fail fast
		// when a linked lead is busy, letting the whole deletion be retried.
		_, err := tx.Exec(ctx, `
			with linked as materialized (
				select lead.id from public.leads as lead
				where lead.organization_id = $1::uuid and `+directLeadPropertyLinksSQL+`
				for no key update nowait
			)
			update public.leads as lead
			set property_id = nullif(lead.property_id, $2::uuid),
			    interest_property_id = nullif(lead.interest_property_id, $2::uuid),
			    property_code = case
			      when coalesce(lead.interest_property_id, lead.property_id) = $2::uuid
			        and lead.property_code = $3 then null else lead.property_code end,
			    metadata = case when jsonb_typeof(lead.metadata->'interestPropertyIds') = 'array'
			      then jsonb_set(lead.metadata, '{interestPropertyIds}', (
			        select coalesce(jsonb_agg(interest.value order by interest.ordinality), '[]'::jsonb)
			        from jsonb_array_elements(`+deletionInterestArraySQL+`) with ordinality as interest(value, ordinality)
			        where not (`+deletionInterestMatchSQL+`)
			      ), false) else lead.metadata end
			from linked
			where lead.organization_id = $1::uuid and lead.id = linked.id
		`, actor.OrganizationID, propertyID, currentCode)
		if err != nil {
			var databaseError *pgconn.PgError
			if errors.As(err, &databaseError) && databaseError.Code == "55P03" {
				return ErrPropertyWorkspaceConflict
			}
			return err
		}
	}

	tag, err := tx.Exec(ctx, `
		delete from public.properties
		where organization_id = $1::uuid and id = $2::uuid
	`, actor.OrganizationID, propertyID)
	if err != nil {
		if isPropertyHasLinkedLeadsForeignKeyViolation(err) {
			return ErrPropertyHasLinkedLeads
		}
		if isPropertyDependencyForeignKeyViolation(err) {
			return ErrPropertyHasDependencies
		}
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrPropertyNotFound
	}

	return tx.Commit(ctx)
}

func isPropertyDependencyForeignKeyViolation(err error) bool {
	var databaseError *pgconn.PgError
	return errors.As(err, &databaseError) && databaseError.Code == "23503"
}

func isPropertyHasLinkedLeadsForeignKeyViolation(err error) bool {
	var databaseError *pgconn.PgError
	return errors.As(err, &databaseError) && databaseError.Code == "23503" &&
		databaseError.ConstraintName == "leads_property_id_fkey"
}
