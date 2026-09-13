package properties

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type activePropertyOwnership struct {
	ID         string
	OwnerID    string
	Percentage float64
	IsPrimary  bool
	ValidFrom  string
}

var manualPropertyOwnerFields = []string{
	"owner_name",
	"owner_phone_residential",
	"owner_phone_commercial",
	"owner_cellphone",
	"owner_email",
	"origin_media",
	"owner_notify_email",
}

// resolvePropertyOwnerForMutation turns the legacy inline-owner fields into a
// normalized owner reference. Reuse is deliberately limited to an exact
// identity match; a same-name row alone is never enough to attach a property.
func resolvePropertyOwnerForMutation(
	ctx context.Context,
	tx pgx.Tx,
	tenantContext tenant.Context,
	input propertyRequest,
	current *propertySnapshot,
) (string, bool, error) {
	currentOwnerID := ""
	currentOwner := OwnerInput{}
	if current != nil {
		currentOwnerID = current.OwnerID
		currentOwner = OwnerInput{
			Name:             current.OwnerName,
			PhoneResidential: current.OwnerPhoneHome,
			PhoneCommercial:  current.OwnerPhoneWork,
			Cellphone:        current.OwnerCellphone,
			Email:            current.OwnerEmail,
			MediaSource:      current.OwnerMediaSource,
			NotifyEmail:      current.OwnerNotifyEmail,
		}
	}
	ownerID := currentOwnerID
	rawOwnerID, ownerIDTouched := input["owner_id"]
	if ownerIDTouched {
		ownerID = optionalReferenceID(rawOwnerID)
	}

	manualTouched := false
	for _, field := range manualPropertyOwnerFields {
		if _, touched := input[field]; touched {
			manualTouched = true
			break
		}
	}
	nextInlineOwner := currentOwner
	applyInlineOwnerMutation(&nextInlineOwner, input)

	if ownerID != "" {
		if current == nil || ownerID != currentOwnerID {
			if err := lockActivePropertyOwnerForAssignment(
				ctx,
				tx,
				tenantContext.OrganizationID,
				ownerID,
			); err != nil {
				return "", false, err
			}
			return ownerID, true, nil
		}
		if manualTouched && !sameInlineOwner(currentOwner, nextInlineOwner) {
			return "", false, ErrPropertyOwnerIdentityConflict
		}
		// A full-form PATCH commonly echoes the selected owner. Removing an
		// unchanged reference avoids taking owner and property locks in opposite
		// order while another request updates the owner catalog.
		if ownerIDTouched {
			delete(input, "owner_id")
		}
		return ownerID, false, nil
	}
	if !manualTouched {
		return "", currentOwnerID != "" && ownerIDTouched, nil
	}

	if strings.TrimSpace(nextInlineOwner.Name) == "" && !hasPropertyOwnerContact(nextInlineOwner) {
		return "", currentOwnerID != "", nil
	}
	if err := validateOwnerInput(&nextInlineOwner); err != nil {
		return "", false, err
	}
	if !hasPropertyOwnerContact(nextInlineOwner) {
		return "", false, fmt.Errorf("%w: at least one owner contact is required for an inline owner", ErrInvalidInput)
	}

	ownerID, err := resolveOrCreateInlinePropertyOwner(ctx, tx, tenantContext, nextInlineOwner)
	if err != nil {
		return "", false, err
	}
	input["owner_id"] = ownerID
	return ownerID, ownerID != currentOwnerID, nil
}

func applyInlineOwnerMutation(owner *OwnerInput, input propertyRequest) {
	stringFields := []struct {
		key    string
		target *string
	}{
		{key: "owner_name", target: &owner.Name},
		{key: "owner_phone_residential", target: &owner.PhoneResidential},
		{key: "owner_phone_commercial", target: &owner.PhoneCommercial},
		{key: "owner_cellphone", target: &owner.Cellphone},
		{key: "owner_email", target: &owner.Email},
		{key: "origin_media", target: &owner.MediaSource},
	}
	for _, field := range stringFields {
		value, touched := input[field.key]
		if !touched {
			continue
		}
		if value == nil {
			*field.target = ""
			continue
		}
		*field.target, _ = value.(string)
	}
	if value, touched := input["owner_notify_email"]; touched {
		owner.NotifyEmail, _ = value.(bool)
	}
}

func hasPropertyOwnerContact(owner OwnerInput) bool {
	return strings.TrimSpace(owner.PhoneResidential) != "" ||
		strings.TrimSpace(owner.PhoneCommercial) != "" ||
		strings.TrimSpace(owner.Cellphone) != "" ||
		strings.TrimSpace(owner.Email) != ""
}

func resolveOrCreateInlinePropertyOwner(
	ctx context.Context,
	tx pgx.Tx,
	tenantContext tenant.Context,
	owner OwnerInput,
) (string, error) {
	lockKey := strings.Join([]string{
		"inline-owner",
		strings.ToLower(owner.Name),
		owner.Cellphone,
		owner.Email,
	}, ":")
	if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtext($1), hashtext($2))`, tenantContext.OrganizationID, lockKey); err != nil {
		return "", err
	}

	var existingID string
	var existing OwnerInput
	var active bool
	err := tx.QueryRow(ctx, `
		select id::text, name, coalesce(phone_residential, ''),
			coalesce(phone_commercial, ''), coalesce(cellphone, ''),
			coalesce(email, ''), coalesce(media_source, ''), notify_email,
			coalesce(is_active, true)
		from public.property_owners
		where organization_id = $1::uuid
		  and lower(btrim(name)) = lower(btrim($2))
		  and coalesce(cellphone, '') = $3
		  and coalesce(email, '') = $4
		limit 1
		for update nowait
	`, tenantContext.OrganizationID, owner.Name, owner.Cellphone, owner.Email).Scan(
		&existingID,
		&existing.Name,
		&existing.PhoneResidential,
		&existing.PhoneCommercial,
		&existing.Cellphone,
		&existing.Email,
		&existing.MediaSource,
		&existing.NotifyEmail,
		&active,
	)
	if err == nil {
		if !active {
			return "", ErrPropertyOwnerAssignmentInvalid
		}
		if !sameInlineOwner(existing, owner) {
			return "", ErrPropertyOwnerIdentityConflict
		}
		return existingID, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return "", normalizeWorkspaceDatabaseError(err)
	}

	err = tx.QueryRow(ctx, `
		insert into public.property_owners (
			organization_id, name, phone_residential, phone_commercial,
			cellphone, email, media_source, notify_email, notes, created_by
		)
		values (
			$1::uuid, $2, nullif($3, ''), nullif($4, ''), nullif($5, ''),
			nullif($6, ''), nullif($7, ''), $8, nullif($9, ''), nullif($10, '')::uuid
		)
		returning id::text
	`, tenantContext.OrganizationID, owner.Name, owner.PhoneResidential,
		owner.PhoneCommercial, owner.Cellphone, owner.Email, owner.MediaSource,
		owner.NotifyEmail, owner.Notes, tenantContext.UserID).Scan(&existingID)
	if err != nil {
		return "", normalizeWorkspaceDatabaseError(err)
	}
	return existingID, nil
}

func lockActivePropertyOwnerForAssignment(
	ctx context.Context,
	tx pgx.Tx,
	organizationID string,
	ownerID string,
) error {
	var active bool
	err := tx.QueryRow(ctx, `
		select coalesce(owner.is_active, true)
		from public.property_owners owner
		where owner.organization_id = $1::uuid
		  and owner.id = $2::uuid
		for share nowait
	`, organizationID, ownerID).Scan(&active)
	if errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("%w: owner_id is not available in the organization", ErrPropertyOwnerAssignmentInvalid)
	}
	if err != nil {
		return normalizeWorkspaceDatabaseError(err)
	}
	if !active {
		return fmt.Errorf("%w: owner_id is not available in the organization", ErrPropertyOwnerAssignmentInvalid)
	}
	return nil
}

func sameInlineOwner(left OwnerInput, right OwnerInput) bool {
	return strings.EqualFold(strings.TrimSpace(left.Name), strings.TrimSpace(right.Name)) &&
		strings.TrimSpace(left.PhoneResidential) == strings.TrimSpace(right.PhoneResidential) &&
		strings.TrimSpace(left.PhoneCommercial) == strings.TrimSpace(right.PhoneCommercial) &&
		strings.TrimSpace(left.Cellphone) == strings.TrimSpace(right.Cellphone) &&
		strings.EqualFold(strings.TrimSpace(left.Email), strings.TrimSpace(right.Email)) &&
		strings.TrimSpace(left.MediaSource) == strings.TrimSpace(right.MediaSource) &&
		left.NotifyEmail == right.NotifyEmail
}

// syncPropertyOwnerIDToOwnerships projects the legacy single-owner selector
// into the normalized ownership ledger without destroying co-ownership data.
// Multi-owner or partial allocations must be edited through the workspace.
func syncPropertyOwnerIDToOwnerships(
	ctx context.Context,
	tx pgx.Tx,
	tenantContext tenant.Context,
	propertyID string,
	ownerID string,
) error {
	rows, err := tx.Query(ctx, `
		select id::text, owner_id::text, ownership_percentage::float8,
			is_primary, valid_from::text
		from public.property_ownerships
		where organization_id = $1::uuid
		  and property_id = $2::uuid
		  and valid_from <= current_date
		  and (valid_to is null or current_date < valid_to)
		order by is_primary desc, valid_from desc, id
		for update
	`, tenantContext.OrganizationID, propertyID)
	if err != nil {
		return err
	}
	active := []activePropertyOwnership{}
	for rows.Next() {
		var ownership activePropertyOwnership
		if err := rows.Scan(
			&ownership.ID,
			&ownership.OwnerID,
			&ownership.Percentage,
			&ownership.IsPrimary,
			&ownership.ValidFrom,
		); err != nil {
			rows.Close()
			return err
		}
		active = append(active, ownership)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}

	if len(active) > 1 || (len(active) == 1 && (!active[0].IsPrimary || active[0].Percentage != 100)) {
		return ErrPropertyOwnershipConflict
	}
	if len(active) == 1 && active[0].OwnerID == ownerID {
		return nil
	}

	if len(active) == 1 {
		if _, err := tx.Exec(ctx, `
			with ended as (
				update public.property_ownerships
				set valid_to = current_date, updated_at = now()
				where organization_id = $1::uuid
				  and id = $2::uuid
				  and valid_from < current_date
				returning id
			)
			delete from public.property_ownerships
			where organization_id = $1::uuid
			  and id = $2::uuid
			  and not exists (select 1 from ended)
		`, tenantContext.OrganizationID, active[0].ID); err != nil {
			return normalizeWorkspaceDatabaseError(err)
		}
	}

	if ownerID == "" {
		return nil
	}
	var nextOwnershipStart string
	if err := tx.QueryRow(ctx, `
		select coalesce(min(valid_from)::text, '')
		from public.property_ownerships
		where organization_id = $1::uuid
		  and property_id = $2::uuid
		  and valid_from > current_date
	`, tenantContext.OrganizationID, propertyID).Scan(&nextOwnershipStart); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		insert into public.property_ownerships (
			organization_id, property_id, owner_id, ownership_percentage,
			is_primary, valid_from, valid_to, created_by
		)
		values (
			$1::uuid, $2::uuid, $3::uuid, 100, true, current_date,
			nullif($5, '')::date, nullif($4, '')::uuid
		)
	`, tenantContext.OrganizationID, propertyID, ownerID, tenantContext.UserID, nextOwnershipStart); err != nil {
		return normalizeWorkspaceDatabaseError(err)
	}
	return nil
}

func reloadPropertyForMutation(
	ctx context.Context,
	tx pgx.Tx,
	organizationID string,
	propertyID string,
) (Property, error) {
	property, err := scanProperty(tx.QueryRow(ctx, `
		select to_jsonb(property)::text
		from public.properties property
		where property.organization_id = $1::uuid and property.id = $2::uuid
	`, organizationID, propertyID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrPropertyNotFound
	}
	return property, err
}
