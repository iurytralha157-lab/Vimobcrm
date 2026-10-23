package developments

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type MaintenanceInput struct {
	ExpectedUpdatedAt string                     `json:"expected_updated_at"`
	Changes           map[string]json.RawMessage `json:"changes"`
}

type maintenanceKind string

const (
	maintenanceDevelopment maintenanceKind = "development"
	maintenancePhase       maintenanceKind = "phase"
	maintenanceBuilding    maintenanceKind = "building"
	maintenanceFloorPlan   maintenanceKind = "floor_plan"
)

type maintenanceDefinition struct {
	table      string
	fields     map[string]bool
	archive    map[string]bool
	structural map[string]bool
}

func maintenanceDefinitionFor(kind maintenanceKind) (maintenanceDefinition, error) {
	common := "code name status metadata"
	switch kind {
	case maintenanceDevelopment:
		return maintenanceDefinition{"property_developments", maintenanceFields(common + " developer_id development_type commercial_status construction_progress registration_number summary description address address_number complement neighborhood city state postal_code launch_date construction_started_at expected_delivery_date main_image_url responsible_user_id"), stringSet("archived", "cancelled", "suspended"), maintenanceFields("development_type")}, nil
	case maintenancePhase:
		return maintenanceDefinition{"property_development_phases", maintenanceFields(common + " sort_order launch_date construction_started_at expected_delivery_date"), stringSet("cancelled", "suspended"), nil}, nil
	case maintenanceBuilding:
		return maintenanceDefinition{"property_development_buildings", maintenanceFields(common + " phase_id building_type floor_count sort_order"), stringSet("inactive"), maintenanceFields("phase_id building_type floor_count")}, nil
	case maintenanceFloorPlan:
		return maintenanceDefinition{"property_development_floor_plans", maintenanceFields(common + " property_type bedrooms suites bathrooms parking_spaces private_area total_area balcony_area garden_area description image_url"), stringSet("inactive", "archived"), maintenanceFields("property_type bedrooms suites bathrooms parking_spaces private_area total_area balcony_area garden_area")}, nil
	default:
		return maintenanceDefinition{}, ErrInvalidInput
	}
}

func maintenanceFields(fields string) map[string]bool {
	result := map[string]bool{}
	for _, field := range strings.Fields(fields) {
		result[field] = true
	}
	return result
}

func validateMaintenanceInput(kind maintenanceKind, input MaintenanceInput) (maintenanceDefinition, error) {
	definition, err := maintenanceDefinitionFor(kind)
	if err != nil {
		return definition, err
	}
	if _, err := requiredTimestamp(input.ExpectedUpdatedAt); err != nil {
		return definition, fmt.Errorf("%w: expected_updated_at is required and must be a timestamp", ErrInvalidInput)
	}
	if len(input.Changes) == 0 {
		return definition, fmt.Errorf("%w: at least one change is required", ErrInvalidInput)
	}
	for key, value := range input.Changes {
		if !definition.fields[key] || !json.Valid(value) {
			return definition, fmt.Errorf("%w: unsupported development field %s", ErrInvalidInput, key)
		}
		if string(bytes.TrimSpace(value)) == "null" && maintenanceFields("code name status development_type commercial_status construction_progress sort_order phase_id building_type metadata")[key] {
			return definition, fmt.Errorf("%w: %s cannot be null", ErrInvalidInput, key)
		}
	}
	return definition, nil
}

func normalizedMaintenanceChanges(kind maintenanceKind, snapshot []byte, input MaintenanceInput) (map[string]json.RawMessage, error) {
	merged := map[string]json.RawMessage{}
	if err := json.Unmarshal(snapshot, &merged); err != nil {
		return nil, err
	}
	for field, value := range input.Changes {
		merged[field] = value
	}
	encoded, err := json.Marshal(merged)
	if err != nil {
		return nil, err
	}
	var validated any
	switch kind {
	case maintenanceDevelopment:
		var value CreateDevelopmentInput
		if err = json.Unmarshal(encoded, &value); err != nil {
			break
		}
		value.PublishedOnSite = false // This endpoint never changes publication.
		err, validated = value.Validate(), value
	case maintenancePhase:
		var value CreatePhaseInput
		if err = json.Unmarshal(encoded, &value); err != nil {
			break
		}
		err, validated = value.Validate(), value
	case maintenanceBuilding:
		var value CreateBuildingInput
		if err = json.Unmarshal(encoded, &value); err != nil {
			break
		}
		err, validated = value.Validate(), value
	case maintenanceFloorPlan:
		var value CreateFloorPlanInput
		if err = json.Unmarshal(encoded, &value); err != nil {
			break
		}
		err, validated = value.Validate(), value
	}
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidInput, err)
	}
	encoded, err = json.Marshal(validated)
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(encoded, &merged); err != nil {
		return nil, err
	}
	changes := map[string]json.RawMessage{}
	for field := range input.Changes {
		changes[field] = merged[field]
	}
	return changes, nil
}

// UpdateMaintenance preserves IDs and history. Only a source-code whitelist
// selects table/columns. A scoped row lock and CAS protect every entity.
func (repo Repository) UpdateMaintenance(ctx context.Context, actor tenant.Context, developmentID, entityID string, kind maintenanceKind, input MaintenanceInput) (json.RawMessage, error) {
	if !canManage(actor) {
		return nil, tenant.ErrOrganizationAccessDenied
	}
	if !uuidPattern.MatchString(developmentID) || !uuidPattern.MatchString(entityID) {
		return nil, ErrNotFound
	}
	definition, err := validateMaintenanceInput(kind, input)
	if err != nil {
		return nil, err
	}
	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback(ctx)
	if err := lockDevelopment(ctx, tx, actor.OrganizationID, developmentID); err != nil {
		return nil, err
	}
	developmentScope := " and development_id = $3::uuid"
	if kind == maintenanceDevelopment {
		developmentScope = " and id = $3::uuid"
	}
	var snapshot []byte
	var current time.Time
	err = tx.QueryRow(ctx, `select to_jsonb(record), updated_at from public.`+definition.table+` record
		where organization_id = $1::uuid and id = $2::uuid`+developmentScope+` for update`, actor.OrganizationID, entityID, developmentID).Scan(&snapshot, &current)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, ErrNotFound
	}
	if err != nil {
		return nil, err
	}
	expected, _ := time.Parse(time.RFC3339Nano, strings.TrimSpace(input.ExpectedUpdatedAt))
	if !current.Equal(expected) {
		return nil, ErrConflict
	}
	changes, err := normalizedMaintenanceChanges(kind, snapshot, input)
	if err != nil {
		return nil, err
	}
	if value, supplied := changes["responsible_user_id"]; supplied {
		var responsibleUserID *string
		if err := json.Unmarshal(value, &responsibleUserID); err != nil {
			return nil, ErrInvalidInput
		}
		if err := requireDevelopmentResponsibleMember(ctx, tx, actor.OrganizationID, responsibleUserID); err != nil {
			return nil, err
		}
	}
	if err := guardMaintenanceDependencies(ctx, tx, actor.OrganizationID, developmentID, entityID, kind, definition, snapshot, changes); err != nil {
		return nil, err
	}
	keys := make([]string, 0, len(changes))
	for key := range changes {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	assignments := make([]string, 0, len(keys)+2)
	for _, key := range keys {
		assignments = append(assignments, key+" = changed."+key)
	}
	assignments = append(assignments, "updated_at = now()", "updated_by = $5::uuid")
	if kind == maintenanceDevelopment {
		status, commercial := "", ""
		_ = json.Unmarshal(changes["status"], &status)
		_ = json.Unmarshal(changes["commercial_status"], &commercial)
		if definition.archive[status] || commercial == "closed" || commercial == "sold_out" {
			assignments = append(assignments, "published_on_site = false")
		}
	}
	encoded, _ := json.Marshal(changes)
	var updated json.RawMessage
	err = tx.QueryRow(ctx, `update public.`+definition.table+` record set `+strings.Join(assignments, ", ")+`
		from jsonb_populate_record(null::public.`+definition.table+`, $4::jsonb) changed
		where record.organization_id = $1::uuid and record.id = $2::uuid`+strings.ReplaceAll(developmentScope, " and ", " and record.")+`
		returning to_jsonb(record)`, actor.OrganizationID, entityID, developmentID, string(encoded), actor.UserID).Scan(&updated)
	if err != nil {
		return nil, normalizeDBError(err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return updated, nil
}

func guardMaintenanceDependencies(ctx context.Context, tx pgx.Tx, organizationID, developmentID, entityID string, kind maintenanceKind, definition maintenanceDefinition, snapshot []byte, changes map[string]json.RawMessage) error {
	previous := map[string]json.RawMessage{}
	_ = json.Unmarshal(snapshot, &previous)
	status := ""
	_ = json.Unmarshal(changes["status"], &status)
	archive := definition.archive[status]
	commercialStatus := ""
	_ = json.Unmarshal(changes["commercial_status"], &commercialStatus)
	archive = archive || (kind == maintenanceDevelopment && (commercialStatus == "closed" || commercialStatus == "sold_out"))
	structural := false
	for field := range definition.structural {
		if value, supplied := changes[field]; supplied && string(value) != string(previous[field]) {
			structural = true
		}
	}
	if !archive && !structural {
		return nil
	}
	scope := ""
	switch kind {
	case maintenancePhase:
		scope = " and exists (select 1 from public.property_development_buildings phase_building where phase_building.organization_id = unit.organization_id and phase_building.id = unit.building_id and phase_building.phase_id = $3::uuid)"
	case maintenanceBuilding:
		scope = " and unit.building_id = $3::uuid"
	case maintenanceFloorPlan:
		scope = " and unit.floor_plan_id = $3::uuid"
	case maintenanceDevelopment:
		scope = " and unit.development_id = $3::uuid"
	}
	var blocked bool
	err := tx.QueryRow(ctx, `select exists (
		select 1 from public.property_development_units unit
		where unit.organization_id = $1::uuid and unit.development_id = $2::uuid`+scope+`
		and (($4::boolean and (unit.published or unit.publication_pending or unit.status = 'reserved'
		  or exists (select 1 from public.properties legacy_property
		    where legacy_property.organization_id = unit.organization_id and legacy_property.id = unit.property_id
		      and legacy_property.published_on_site)
		  or exists (select 1 from public.property_development_reservations reservation
		    where reservation.organization_id = unit.organization_id and reservation.unit_id = unit.id and reservation.status = 'active')
		  or exists (select 1 from public.property_channel_publications publication
		    where publication.organization_id = unit.organization_id and publication.property_id = unit.property_id
		      and (publication.desired_state = 'published' or publication.published_version is not null))))
		 or ($5::boolean and (unit.property_id is not null or unit.status in ('reserved', 'sold') or $6::boolean)))
	)`, organizationID, developmentID, entityID, archive, structural, kind == maintenanceBuilding || kind == maintenanceFloorPlan).Scan(&blocked)
	if err != nil {
		return err
	}
	if blocked {
		return fmt.Errorf("%w: encerre as reservas e publicações ativas antes de desativar este cadastro; mudanças de estrutura exigem um cadastro sem unidades vinculadas", ErrConflict)
	}
	return nil
}
