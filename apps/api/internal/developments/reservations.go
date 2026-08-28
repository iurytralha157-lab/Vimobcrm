package developments

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/authorization"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type CreateReservationResult struct {
	Reservation Reservation
	Created     bool
}

type reservationFingerprintPayload struct {
	OrganizationID        string  `json:"organization_id"`
	DevelopmentID         string  `json:"development_id"`
	UnitID                string  `json:"unit_id"`
	LeadID                *string `json:"lead_id"`
	ExpiresAt             string  `json:"expires_at"`
	Notes                 *string `json:"notes"`
	ExpectedUnitUpdatedAt string  `json:"expected_unit_updated_at"`
}

type reservationLeadQueryer interface {
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

type reservationLeadScope struct {
	AssignedUserID string
	TeamID         string
}

func loadReservationLeadScope(
	ctx context.Context,
	queryer reservationLeadQueryer,
	organizationID string,
	leadID string,
) (reservationLeadScope, error) {
	var scope reservationLeadScope
	err := queryer.QueryRow(ctx, `
		select
			coalesce(lead.assigned_user_id::text, ''),
			coalesce(nullif(to_jsonb(lead) ->> 'team_id', ''), '')
		from public.leads as lead
		where lead.organization_id = $1::uuid
		  and lead.id = $2::uuid
		limit 1
		for share of lead
	`, organizationID, leadID).Scan(&scope.AssignedUserID, &scope.TeamID)
	return scope, err
}

func canViewReservationLead(tenantContext tenant.Context, scope reservationLeadScope) bool {
	return authorization.CanViewLead(tenantContext, authorization.LeadResource{
		AssignedUserID: scope.AssignedUserID,
		TeamID:         scope.TeamID,
	})
}

func canOperateReservation(
	tenantContext tenant.Context,
	scope reservationLeadScope,
	reservation Reservation,
) bool {
	return canManage(tenantContext) &&
		(reservation.LeadID == nil || canViewReservationLead(tenantContext, scope))
}

func redactReservationLead(tenantContext tenant.Context, scope reservationLeadScope, reservation *Reservation) {
	if reservation == nil || reservation.LeadID == nil || canViewReservationLead(tenantContext, scope) {
		return
	}
	reservation.LeadID = nil
	reservation.LeadName = nil
	reservation.CancellationReason = nil
}

func applyReservationLeadVisibility(
	ctx context.Context,
	queryer reservationLeadQueryer,
	tenantContext tenant.Context,
	reservation *Reservation,
) error {
	if reservation == nil || reservation.LeadID == nil {
		return nil
	}
	scope, err := loadReservationLeadScope(
		ctx,
		queryer,
		tenantContext.OrganizationID,
		*reservation.LeadID,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		reservation.LeadID = nil
		reservation.LeadName = nil
		return nil
	}
	if err != nil {
		return err
	}
	redactReservationLead(tenantContext, scope, reservation)
	return nil
}

func requireReservationLeadVisibility(
	ctx context.Context,
	queryer reservationLeadQueryer,
	tenantContext tenant.Context,
	reservation Reservation,
) error {
	if reservation.LeadID == nil {
		return nil
	}
	scope, err := loadReservationLeadScope(
		ctx,
		queryer,
		tenantContext.OrganizationID,
		*reservation.LeadID,
	)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && !canViewReservationLead(tenantContext, scope)) {
		// Match an unknown reservation so a cross-scope lead relationship is
		// never disclosed through mutation behavior.
		return ErrNotFound
	}
	return normalizeDBError(err)
}

func (repo Repository) ListReservations(
	ctx context.Context,
	tenantContext tenant.Context,
	developmentID string,
	filter ReservationListFilter,
) (ReservationListResponse, error) {
	organizationID := strings.TrimSpace(tenantContext.OrganizationID)
	developmentID = strings.TrimSpace(developmentID)
	if organizationID == "" || !uuidPattern.MatchString(developmentID) {
		return ReservationListResponse{}, ErrNotFound
	}

	var developmentExists bool
	if err := repo.db.Pool().QueryRow(ctx, `
		select exists (
			select 1
			from public.property_developments
			where organization_id = $1::uuid
			  and id = $2::uuid
		)
	`, organizationID, developmentID).Scan(&developmentExists); err != nil {
		return ReservationListResponse{}, err
	}
	if !developmentExists {
		return ReservationListResponse{}, ErrNotFound
	}
	if filter.LeadID != "" {
		leadScope, err := loadReservationLeadScope(
			ctx,
			repo.db.Pool(),
			organizationID,
			filter.LeadID,
		)
		if errors.Is(err, pgx.ErrNoRows) || (err == nil && !canViewReservationLead(tenantContext, leadScope)) {
			// A missing and a non-visible lead intentionally have the same result.
			return ReservationListResponse{}, ErrNotFound
		}
		if err != nil {
			return ReservationListResponse{}, err
		}
	}

	args := []any{organizationID, developmentID}
	where := []string{
		"reservation.organization_id = $1::uuid",
		"reservation.development_id = $2::uuid",
	}
	if filter.Status != "" {
		args = append(args, filter.Status)
		where = append(where, fmt.Sprintf("reservation.status = $%d", len(args)))
	}
	if filter.UnitID != "" {
		args = append(args, filter.UnitID)
		where = append(where, fmt.Sprintf("reservation.unit_id = $%d::uuid", len(args)))
	}
	if filter.LeadID != "" {
		args = append(args, filter.LeadID)
		where = append(where, fmt.Sprintf("reservation.lead_id = $%d::uuid", len(args)))
	}
	whereSQL := strings.Join(where, " and ")

	meta := ReservationListMeta{Limit: filter.Limit, Offset: filter.Offset}
	if err := repo.db.Pool().QueryRow(ctx, `
		select
			(select count(*)::integer
			 from public.property_development_reservations as reservation
			 where `+whereSQL+`),
			count(*) filter (where reservation.status = 'active')::integer,
			count(*) filter (
				where reservation.status = 'active'
				  and reservation.expires_at <= now() + interval '24 hours'
			)::integer,
			count(*) filter (where reservation.status = 'expired')::integer
		from public.property_development_reservations as reservation
		where reservation.organization_id = $1::uuid
		  and reservation.development_id = $2::uuid
	`, args...).Scan(&meta.Total, &meta.Active, &meta.ExpiringSoon, &meta.Expired); err != nil {
		return ReservationListResponse{}, err
	}

	listArgs := append(append([]any{}, args...), filter.Limit, filter.Offset)
	limitIndex := len(listArgs) - 1
	offsetIndex := len(listArgs)
	rows, err := repo.db.Pool().Query(ctx, `
		select jsonb_build_object(
			'id', reservation.id,
			'organization_id', reservation.organization_id,
			'development_id', reservation.development_id,
			'unit_id', reservation.unit_id,
			'unit_number', unit.unit_number,
			'unit_code', unit.code,
			'building_name', building.name,
			'lead_id', reservation.lead_id,
			'lead_name', lead.name,
			'price_table_id', reservation.price_table_id,
			'status', reservation.status,
			'reserved_by', reservation.reserved_by,
			'updated_by', reservation.updated_by,
			'expires_at', reservation.expires_at,
			'converted_at', reservation.converted_at,
			'cancelled_at', reservation.cancelled_at,
			'cancellation_reason', reservation.cancellation_reason,
			'list_price_snapshot', reservation.list_price_snapshot,
			'currency', reservation.currency,
			'created_at', reservation.created_at,
			'updated_at', reservation.updated_at
		),
		coalesce(lead.assigned_user_id::text, ''),
		coalesce(nullif(to_jsonb(lead) ->> 'team_id', ''), '')
		from public.property_development_reservations as reservation
		join public.property_development_units as unit
		  on unit.organization_id = reservation.organization_id
		 and unit.development_id = reservation.development_id
		 and unit.id = reservation.unit_id
		join public.property_development_buildings as building
		  on building.organization_id = unit.organization_id
		 and building.development_id = unit.development_id
		 and building.id = unit.building_id
		left join public.leads as lead
		  on lead.organization_id = reservation.organization_id
		 and lead.id = reservation.lead_id
		where `+whereSQL+`
		order by reservation.created_at desc, reservation.id desc
		limit $`+fmt.Sprint(limitIndex)+` offset $`+fmt.Sprint(offsetIndex), listArgs...)
	if err != nil {
		return ReservationListResponse{}, err
	}
	defer rows.Close()

	reservations := make([]Reservation, 0)
	for rows.Next() {
		var rawReservation []byte
		var leadScope reservationLeadScope
		if err := rows.Scan(
			&rawReservation,
			&leadScope.AssignedUserID,
			&leadScope.TeamID,
		); err != nil {
			return ReservationListResponse{}, err
		}
		var reservation Reservation
		if err := json.Unmarshal(rawReservation, &reservation); err != nil {
			return ReservationListResponse{}, err
		}
		canOperate := canOperateReservation(tenantContext, leadScope, reservation)
		reservation.CanOperate = &canOperate
		redactReservationLead(tenantContext, leadScope, &reservation)
		if !canManage(tenantContext) && reservation.LeadID == nil {
			reservation.CancellationReason = nil
		}
		reservations = append(reservations, reservation)
	}
	if err := rows.Err(); err != nil {
		return ReservationListResponse{}, err
	}
	return ReservationListResponse{Data: reservations, Meta: meta}, nil
}

func (repo Repository) CreateReservation(
	ctx context.Context,
	tenantContext tenant.Context,
	developmentID string,
	unitID string,
	idempotencyKey string,
	input CreateReservationInput,
) (CreateReservationResult, error) {
	if !canManage(tenantContext) {
		return CreateReservationResult{}, tenant.ErrOrganizationAccessDenied
	}
	developmentID = strings.TrimSpace(developmentID)
	unitID = strings.TrimSpace(unitID)
	if !uuidPattern.MatchString(developmentID) || !uuidPattern.MatchString(unitID) {
		return CreateReservationResult{}, ErrNotFound
	}
	idempotencyKey = strings.ToLower(strings.TrimSpace(idempotencyKey))
	if !uuidPattern.MatchString(idempotencyKey) {
		return CreateReservationResult{}, fmt.Errorf("%w: Idempotency-Key must be a canonical UUID", ErrInvalidInput)
	}
	now := time.Now().UTC()
	if err := input.Validate(now); err != nil {
		return CreateReservationResult{}, err
	}
	fingerprint := reservationFingerprint(tenantContext.OrganizationID, developmentID, unitID, input)

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return CreateReservationResult{}, err
	}
	defer tx.Rollback(ctx)

	// Serialize only equal organization/key pairs. This makes concurrent retries
	// deterministic without serializing unrelated reservations in a development.
	if _, err := tx.Exec(ctx, `
		select pg_advisory_xact_lock(hashtext($1), hashtext($2))
	`, tenantContext.OrganizationID, idempotencyKey); err != nil {
		return CreateReservationResult{}, err
	}
	if existing, existingFingerprint, err := findReservationByIdempotencyKeyTx(
		ctx,
		tx,
		tenantContext.OrganizationID,
		idempotencyKey,
	); err == nil {
		if err := requireReservationLeadVisibility(ctx, tx, tenantContext, existing); err != nil {
			if errors.Is(err, ErrNotFound) {
				return CreateReservationResult{}, fmt.Errorf("%w: lead_id is invalid", ErrInvalidInput)
			}
			return CreateReservationResult{}, err
		}
		if existingFingerprint != fingerprint {
			return CreateReservationResult{}, fmt.Errorf("%w: Idempotency-Key was reused with a different request", ErrConflict)
		}
		if err := tx.Commit(ctx); err != nil {
			return CreateReservationResult{}, err
		}
		return CreateReservationResult{Reservation: existing, Created: false}, nil
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return CreateReservationResult{}, err
	}

	if input.LeadID != nil {
		leadScope, err := loadReservationLeadScope(
			ctx,
			tx,
			tenantContext.OrganizationID,
			*input.LeadID,
		)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return CreateReservationResult{}, err
		}
		if errors.Is(err, pgx.ErrNoRows) || !canViewReservationLead(tenantContext, leadScope) {
			// Do not disclose whether the lead exists outside the caller's
			// canonical own/team/all visibility scope.
			return CreateReservationResult{}, fmt.Errorf("%w: lead_id is invalid", ErrInvalidInput)
		}
	}

	var priceTableID, currency string
	var listPrice float64
	var paymentSnapshot []byte
	if err := tx.QueryRow(ctx, `
		select
			price_table.id::text,
			price_table.currency,
			unit_price.list_price::float8,
			unit_price.payment_terms
		from public.property_development_price_tables as price_table
		join public.property_development_unit_prices as unit_price
		  on unit_price.organization_id = price_table.organization_id
		 and unit_price.development_id = price_table.development_id
		 and unit_price.price_table_id = price_table.id
		where price_table.organization_id = $1::uuid
		  and price_table.development_id = $2::uuid
		  and price_table.status = 'active'
		  and unit_price.unit_id = $3::uuid
		order by price_table.version desc
		limit 1
		-- Compatible shared locks let distinct units reserve concurrently while
		-- still conflicting with activation/archive updates to this table.
		for share of price_table
	`, tenantContext.OrganizationID, developmentID, unitID).Scan(
		&priceTableID,
		&currency,
		&listPrice,
		&paymentSnapshot,
	); errors.Is(err, pgx.ErrNoRows) {
		return CreateReservationResult{}, fmt.Errorf("%w: unit requires a price in the active price table", ErrConflict)
	} else if err != nil {
		return CreateReservationResult{}, err
	}

	var unitStatus string
	var unitUpdatedAt time.Time
	if err := tx.QueryRow(ctx, `
		select status, updated_at
		from public.property_development_units
		where organization_id = $1::uuid
		  and development_id = $2::uuid
		  and id = $3::uuid
		for update
	`, tenantContext.OrganizationID, developmentID, unitID).Scan(&unitStatus, &unitUpdatedAt); errors.Is(err, pgx.ErrNoRows) {
		return CreateReservationResult{}, ErrNotFound
	} else if err != nil {
		return CreateReservationResult{}, err
	}
	expectedUnitUpdatedAt, _ := time.Parse(time.RFC3339Nano, input.ExpectedUnitUpdatedAt)
	if !unitUpdatedAt.Equal(expectedUnitUpdatedAt) {
		return CreateReservationResult{}, fmt.Errorf("%w: unit changed before reservation", ErrConflict)
	}
	if unitStatus != "available" && unitStatus != "negotiation" {
		return CreateReservationResult{}, fmt.Errorf("%w: unit is not available for reservation", ErrConflict)
	}

	metadata := map[string]any{
		"request_fingerprint": fingerprint,
		"created_via":         "development_reservation_api",
	}
	reservation, err := scanJSON[Reservation](tx.QueryRow(ctx, `
		insert into public.property_development_reservations (
			organization_id,
			development_id,
			unit_id,
			lead_id,
			price_table_id,
			status,
			reserved_by,
			updated_by,
			expires_at,
			list_price_snapshot,
			currency,
			payment_snapshot,
			idempotency_key,
			notes,
			metadata
		)
		select
			$1::uuid,
			$2::uuid,
			$3::uuid,
			$4::uuid,
			$5::uuid,
			'active',
			$6::uuid,
			$6::uuid,
			$7::timestamptz,
			$8::numeric,
			$9,
			$10::jsonb,
			$11,
			$12,
			$13::jsonb
		where $7::timestamptz > clock_timestamp()
		  and $7::timestamptz <= clock_timestamp() + interval '30 days'
		returning to_jsonb(property_development_reservations)
	`, tenantContext.OrganizationID, developmentID, unitID, input.LeadID,
		priceTableID, tenantContext.UserID, input.ExpiresAt, listPrice,
		currency, string(paymentSnapshot), idempotencyKey, input.Notes,
		jsonValue(metadata)))
	if errors.Is(err, pgx.ErrNoRows) {
		return CreateReservationResult{}, fmt.Errorf("%w: reservation expiration window elapsed", ErrConflict)
	}
	if err != nil {
		return CreateReservationResult{}, normalizeDBError(err)
	}
	if err := applyReservationLeadVisibility(ctx, tx, tenantContext, &reservation); err != nil {
		return CreateReservationResult{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return CreateReservationResult{}, err
	}
	return CreateReservationResult{Reservation: reservation, Created: true}, nil
}

func (repo Repository) CancelReservation(
	ctx context.Context,
	tenantContext tenant.Context,
	developmentID string,
	reservationID string,
	input CancelReservationInput,
) (Reservation, error) {
	if err := input.Validate(); err != nil {
		return Reservation{}, err
	}
	return repo.transitionReservation(
		ctx,
		tenantContext,
		developmentID,
		reservationID,
		input.ExpectedUpdatedAt,
		"cancelled",
		input.CancellationReason,
	)
}

func (repo Repository) ConvertReservation(
	ctx context.Context,
	tenantContext tenant.Context,
	developmentID string,
	reservationID string,
	input ReservationTransitionInput,
) (Reservation, error) {
	if err := input.Validate(); err != nil {
		return Reservation{}, err
	}
	return repo.transitionReservation(
		ctx,
		tenantContext,
		developmentID,
		reservationID,
		input.ExpectedUpdatedAt,
		"converted",
		"",
	)
}

func (repo Repository) ExtendReservation(
	ctx context.Context,
	tenantContext tenant.Context,
	developmentID string,
	reservationID string,
	input ExtendReservationInput,
) (Reservation, error) {
	if !canManage(tenantContext) {
		return Reservation{}, tenant.ErrOrganizationAccessDenied
	}
	developmentID = strings.TrimSpace(developmentID)
	reservationID = strings.TrimSpace(reservationID)
	if !uuidPattern.MatchString(developmentID) || !uuidPattern.MatchString(reservationID) {
		return Reservation{}, ErrNotFound
	}
	if err := input.Validate(time.Now().UTC()); err != nil {
		return Reservation{}, err
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return Reservation{}, err
	}
	defer tx.Rollback(ctx)
	current, err := lockReservationTx(ctx, tx, tenantContext.OrganizationID, developmentID, reservationID)
	if err != nil {
		return Reservation{}, err
	}
	if err := requireReservationLeadVisibility(ctx, tx, tenantContext, current); err != nil {
		return Reservation{}, err
	}
	if err := ensureActiveReservationDeadline(current, input.ExpectedUpdatedAt); err != nil {
		return Reservation{}, err
	}
	currentExpiration, _ := time.Parse(time.RFC3339Nano, current.ExpiresAt)
	newExpiration, _ := time.Parse(time.RFC3339Nano, input.ExpiresAt)
	if !newExpiration.After(currentExpiration) {
		return Reservation{}, fmt.Errorf("%w: extension must move expires_at forward", ErrConflict)
	}

	reservation, err := scanJSON[Reservation](tx.QueryRow(ctx, `
		update public.property_development_reservations
		set expires_at = $5::timestamptz,
		    updated_by = $6::uuid,
		    updated_at = now()
		where organization_id = $1::uuid
		  and development_id = $2::uuid
		  and id = $3::uuid
		  and status = 'active'
		  and updated_at = $4::timestamptz
		  and expires_at > clock_timestamp()
		  and $5::timestamptz > expires_at
		  and $5::timestamptz > clock_timestamp()
		  and $5::timestamptz <= clock_timestamp() + interval '30 days'
		returning to_jsonb(property_development_reservations)
	`, tenantContext.OrganizationID, developmentID, reservationID,
		input.ExpectedUpdatedAt, input.ExpiresAt, tenantContext.UserID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Reservation{}, fmt.Errorf("%w: reservation changed or its deadline elapsed", ErrConflict)
	}
	if err != nil {
		return Reservation{}, normalizeDBError(err)
	}
	if err := applyReservationLeadVisibility(ctx, tx, tenantContext, &reservation); err != nil {
		return Reservation{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Reservation{}, err
	}
	return reservation, nil
}

func (repo Repository) transitionReservation(
	ctx context.Context,
	tenantContext tenant.Context,
	developmentID string,
	reservationID string,
	expectedUpdatedAt string,
	targetStatus string,
	cancellationReason string,
) (Reservation, error) {
	if !canManage(tenantContext) {
		return Reservation{}, tenant.ErrOrganizationAccessDenied
	}
	developmentID = strings.TrimSpace(developmentID)
	reservationID = strings.TrimSpace(reservationID)
	if !uuidPattern.MatchString(developmentID) || !uuidPattern.MatchString(reservationID) {
		return Reservation{}, ErrNotFound
	}

	tx, err := repo.db.Pool().Begin(ctx)
	if err != nil {
		return Reservation{}, err
	}
	defer tx.Rollback(ctx)
	current, err := lockReservationTx(ctx, tx, tenantContext.OrganizationID, developmentID, reservationID)
	if err != nil {
		return Reservation{}, err
	}
	if err := requireReservationLeadVisibility(ctx, tx, tenantContext, current); err != nil {
		return Reservation{}, err
	}
	if err := ensureActiveReservationDeadline(current, expectedUpdatedAt); err != nil {
		return Reservation{}, err
	}

	reservation, err := scanJSON[Reservation](tx.QueryRow(ctx, `
		update public.property_development_reservations
		set status = $5,
		    cancellation_reason = case when $5 = 'cancelled' then $6 else null end,
		    updated_by = $7::uuid,
		    updated_at = now()
		where organization_id = $1::uuid
		  and development_id = $2::uuid
		  and id = $3::uuid
		  and status = 'active'
		  and updated_at = $4::timestamptz
		  and expires_at > clock_timestamp()
		  and $5 in ('cancelled', 'converted')
		returning to_jsonb(property_development_reservations)
	`, tenantContext.OrganizationID, developmentID, reservationID,
		expectedUpdatedAt, targetStatus, cancellationReason, tenantContext.UserID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Reservation{}, fmt.Errorf("%w: reservation changed or its deadline elapsed", ErrConflict)
	}
	if err != nil {
		return Reservation{}, normalizeDBError(err)
	}
	if err := applyReservationLeadVisibility(ctx, tx, tenantContext, &reservation); err != nil {
		return Reservation{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return Reservation{}, err
	}
	return reservation, nil
}

func findReservationByIdempotencyKeyTx(
	ctx context.Context,
	tx pgx.Tx,
	organizationID string,
	idempotencyKey string,
) (Reservation, string, error) {
	var raw []byte
	var fingerprint *string
	err := tx.QueryRow(ctx, `
		select
			to_jsonb(reservation),
			reservation.metadata ->> 'request_fingerprint'
		from public.property_development_reservations as reservation
		where reservation.organization_id = $1::uuid
		  and reservation.idempotency_key = $2
		limit 1
	`, organizationID, idempotencyKey).Scan(&raw, &fingerprint)
	if err != nil {
		return Reservation{}, "", err
	}
	var reservation Reservation
	if err := json.Unmarshal(raw, &reservation); err != nil {
		return Reservation{}, "", err
	}
	if fingerprint == nil {
		return reservation, "", nil
	}
	return reservation, *fingerprint, nil
}

func lockReservationTx(
	ctx context.Context,
	tx pgx.Tx,
	organizationID string,
	developmentID string,
	reservationID string,
) (Reservation, error) {
	reservation, err := scanJSON[Reservation](tx.QueryRow(ctx, `
		select to_jsonb(reservation)
		from public.property_development_reservations as reservation
		where reservation.organization_id = $1::uuid
		  and reservation.development_id = $2::uuid
		  and reservation.id = $3::uuid
		for update
	`, organizationID, developmentID, reservationID))
	if errors.Is(err, pgx.ErrNoRows) {
		return Reservation{}, ErrNotFound
	}
	return reservation, err
}

func ensureActiveReservationDeadline(current Reservation, expectedUpdatedAt string) error {
	if current.Status != "active" {
		return fmt.Errorf("%w: reservation is no longer active", ErrConflict)
	}
	expiresAt, err := time.Parse(time.RFC3339Nano, current.ExpiresAt)
	if err != nil || !expiresAt.After(time.Now().UTC()) {
		return fmt.Errorf("%w: reservation deadline elapsed", ErrConflict)
	}
	currentUpdatedAt, err := time.Parse(time.RFC3339Nano, current.UpdatedAt)
	if err != nil {
		return err
	}
	expected, _ := time.Parse(time.RFC3339Nano, expectedUpdatedAt)
	if !currentUpdatedAt.Equal(expected) {
		return fmt.Errorf("%w: reservation changed", ErrConflict)
	}
	return nil
}

func reservationFingerprint(
	organizationID string,
	developmentID string,
	unitID string,
	input CreateReservationInput,
) string {
	leadID := input.LeadID
	if leadID != nil {
		canonicalLeadID := strings.ToLower(strings.TrimSpace(*leadID))
		leadID = &canonicalLeadID
	}
	payload, _ := json.Marshal(reservationFingerprintPayload{
		OrganizationID:        strings.ToLower(strings.TrimSpace(organizationID)),
		DevelopmentID:         strings.ToLower(strings.TrimSpace(developmentID)),
		UnitID:                strings.ToLower(strings.TrimSpace(unitID)),
		LeadID:                leadID,
		ExpiresAt:             input.ExpiresAt,
		Notes:                 input.Notes,
		ExpectedUnitUpdatedAt: input.ExpectedUnitUpdatedAt,
	})
	sum := sha256.Sum256(payload)
	return hex.EncodeToString(sum[:])
}
