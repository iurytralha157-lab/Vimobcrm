package properties

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func (repo Repository) Create(ctx context.Context, tenantContext tenant.Context, input propertyRequest) (Property, error) {
	if !canCreateProperties(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)

	property, err := repo.createPropertyTx(ctx, tx, tenantContext, input)
	if err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	return property, nil
}

// createPropertyTx is the single transactional property-creation path. Domain
// workflows that must atomically create and relate a property (for example a
// development unit promotion) use this helper so code generation, tenant
// references, audit activity and demo cleanup cannot drift from the regular
// property endpoint.
func (repo Repository) createPropertyTx(
	ctx context.Context,
	tx pgx.Tx,
	tenantContext tenant.Context,
	input propertyRequest,
) (Property, error) {
	if !canCreateProperties(tenantContext) {
		return nil, tenant.ErrOrganizationAccessDenied
	}

	if !canAssignProperties(tenantContext) {
		input["created_by"] = tenantContext.UserID
		input["responsible_user_id"] = tenantContext.UserID
		input["cadastrado_por"] = tenantContext.UserID
	} else if input["created_by"] == nil {
		input["created_by"] = tenantContext.UserID
	}
	if input["responsible_user_id"] == nil {
		input["responsible_user_id"] = tenantContext.UserID
	}
	if input["cadastrado_por"] == nil {
		input["cadastrado_por"] = input["responsible_user_id"]
	}
	if err := enforcePropertyManagedTerms(input, propertySnapshot{
		DealType:         anyString(input["finalidade"]),
		AcceptsFinancing: anyBool(input["aceita_financiamento"]),
		Metadata:         map[string]any{},
	}, true); err != nil {
		return nil, err
	}
	ownerID, ownerChanged, err := resolvePropertyOwnerForMutation(ctx, tx, tenantContext, input, nil)
	if err != nil {
		return nil, err
	}
	if err := repo.validatePropertyReferences(ctx, tx, tenantContext.OrganizationID, "", input); err != nil {
		return nil, err
	}

	propertyType, _ := input["tipo"].(string)
	if strings.TrimSpace(propertyType) == "" {
		return nil, fmt.Errorf("%w: tipo_de_imovel is required", ErrInvalidInput)
	}
	code, err := repo.generatePropertyCode(ctx, tx, tenantContext.OrganizationID, propertyType)
	if err != nil {
		return nil, err
	}

	columns, placeholders, args := mutationParts(input, 3)
	columns = append([]string{"organization_id", "code"}, columns...)
	placeholders = append([]string{"$1::uuid", "$2"}, placeholders...)
	args = append([]any{tenantContext.OrganizationID, code}, args...)

	var property Property
	err = tx.QueryRow(ctx, `
		insert into public.properties (`+strings.Join(columns, ", ")+`)
		values (`+strings.Join(placeholders, ", ")+`)
		returning to_jsonb(properties)::text
	`, args...).Scan((*jsonTextProperty)(&property))
	if err != nil {
		return nil, normalizeWorkspaceDatabaseError(err)
	}
	propertyID := anyString(property["id"])
	if ownerChanged && ownerID != "" {
		if err := syncPropertyOwnerIDToOwnerships(ctx, tx, tenantContext, propertyID, ownerID); err != nil {
			return nil, err
		}
		if err := syncLegacyPropertyOwnerProjection(ctx, tx, tenantContext.OrganizationID, propertyID); err != nil {
			return nil, err
		}
	}
	// AFTER INSERT compatibility triggers can create normalized offers and touch
	// the property revision. Return the committed row version, not the stale
	// INSERT ... RETURNING snapshot, so the first optimistic PATCH can succeed.
	property, err = reloadPropertyForMutation(ctx, tx, tenantContext.OrganizationID, propertyID)
	if err != nil {
		return nil, err
	}
	property = normalizePropertyOutput(property)

	if err := optionalPropertyTransaction(ctx, tx, func(optional pgx.Tx) error {
		return repo.insertPropertyCreatedActivity(ctx, optional, tenantContext, property)
	}); err != nil {
		if errors.Is(err, errPropertySavepointFailed) {
			return nil, err
		}
		slog.Warn("property activity insert skipped", "error", err)
	}

	if shouldCleanupDemoPropertiesAfterCreate(property) {
		if err := optionalPropertyTransaction(ctx, tx, func(optional pgx.Tx) error {
			return repo.removeDemoProperties(ctx, optional, tenantContext.OrganizationID, propertyID)
		}); err != nil {
			if errors.Is(err, errPropertySavepointFailed) {
				return nil, err
			}
			slog.Warn("demo property cleanup skipped", "error", err)
		}
	}

	return property, nil
}

func shouldCleanupDemoPropertiesAfterCreate(created Property) bool {
	return !anyBool(created["is_demo"])
}

func (repo Repository) removeDemoProperties(ctx context.Context, tx pgx.Tx, organizationID string, createdPropertyID string) error {
	_, err := tx.Exec(ctx, `
		delete from public.properties
		where organization_id = $1::uuid
		  and id <> $2::uuid
		  and (
			coalesce(is_demo, false) = true
			or lower(trim(coalesce(metadata ->> 'is_demo', ''))) = 'true'
		  )
	`, organizationID, createdPropertyID)
	return err
}

func mutationParts(input propertyRequest, firstPlaceholder int) ([]string, []string, []any) {
	keys := sortedMutationKeys(input)
	columns := make([]string, 0, len(keys))
	placeholders := make([]string, 0, len(keys))
	args := make([]any, 0, len(keys))

	for _, key := range keys {
		def := writableColumns[key]
		args = append(args, input[key])
		columns = append(columns, def.column)
		placeholders = append(placeholders, typedPlaceholder(firstPlaceholder+len(args)-1, def.kind))
	}

	return columns, placeholders, args
}
