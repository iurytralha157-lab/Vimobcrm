package developments

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const developmentBodyLimit = 2 << 20

type Handler struct {
	repo Repository
}

func NewHandler(repo Repository) Handler {
	return Handler{repo: repo}
}

func (handler Handler) List(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := developmentTenant(w, r)
	if !ok {
		return
	}
	filter, err := ParseListFilter(r.URL.Query())
	if err != nil {
		writeDevelopmentError(w, r, err)
		return
	}
	response, err := handler.repo.List(r.Context(), tenantContext, filter)
	if err != nil {
		writeDevelopmentError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, response)
}

func (handler Handler) Create(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := developmentTenant(w, r)
	if !ok {
		return
	}
	var input CreateDevelopmentInput
	if err := decodeDevelopmentJSON(w, r, &input); err != nil {
		writeInvalidDevelopmentJSON(w, r)
		return
	}
	response, err := handler.repo.Create(r.Context(), tenantContext, input)
	if err != nil {
		writeDevelopmentError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusCreated, response)
}

func (handler Handler) ShowWorkspace(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := developmentTenant(w, r)
	if !ok {
		return
	}
	response, err := handler.repo.GetWorkspace(r.Context(), tenantContext, r.PathValue("id"))
	if err != nil {
		writeDevelopmentError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, response)
}

func (handler Handler) ListUnits(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := developmentTenant(w, r)
	if !ok {
		return
	}
	filter, err := ParseUnitListFilter(r.URL.Query())
	if err != nil {
		writeDevelopmentError(w, r, err)
		return
	}
	response, err := handler.repo.ListUnits(r.Context(), tenantContext, r.PathValue("id"), filter)
	if err != nil {
		writeDevelopmentError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, response)
}

func (handler Handler) CreatePhase(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := developmentTenant(w, r)
	if !ok {
		return
	}
	var input CreatePhaseInput
	if err := decodeDevelopmentJSON(w, r, &input); err != nil {
		writeInvalidDevelopmentJSON(w, r)
		return
	}
	phase, err := handler.repo.CreatePhase(r.Context(), tenantContext, r.PathValue("id"), input)
	if err != nil {
		writeDevelopmentError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusCreated, map[string]Phase{"data": phase})
}

func (handler Handler) CreateBuilding(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := developmentTenant(w, r)
	if !ok {
		return
	}
	var input CreateBuildingInput
	if err := decodeDevelopmentJSON(w, r, &input); err != nil {
		writeInvalidDevelopmentJSON(w, r)
		return
	}
	building, err := handler.repo.CreateBuilding(r.Context(), tenantContext, r.PathValue("id"), input)
	if err != nil {
		writeDevelopmentError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusCreated, map[string]Building{"data": building})
}

func (handler Handler) CreateFloorPlan(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := developmentTenant(w, r)
	if !ok {
		return
	}
	var input CreateFloorPlanInput
	if err := decodeDevelopmentJSON(w, r, &input); err != nil {
		writeInvalidDevelopmentJSON(w, r)
		return
	}
	floorPlan, err := handler.repo.CreateFloorPlan(r.Context(), tenantContext, r.PathValue("id"), input)
	if err != nil {
		writeDevelopmentError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusCreated, map[string]FloorPlan{"data": floorPlan})
}

func (handler Handler) BulkCreateUnits(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := developmentTenant(w, r)
	if !ok {
		return
	}
	var input BulkCreateUnitsInput
	if err := decodeDevelopmentJSON(w, r, &input); err != nil {
		writeInvalidDevelopmentJSON(w, r)
		return
	}
	result, err := handler.repo.BulkCreateUnits(r.Context(), tenantContext, r.PathValue("id"), input)
	if err != nil {
		writeDevelopmentError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusCreated, map[string]BulkCreateUnitsResult{"data": result})
}

func (handler Handler) UpdateUnit(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := developmentTenant(w, r)
	if !ok {
		return
	}
	var input UpdateUnitInput
	if err := decodeDevelopmentJSON(w, r, &input); err != nil {
		writeInvalidDevelopmentJSON(w, r)
		return
	}
	unit, err := handler.repo.UpdateUnit(
		r.Context(),
		tenantContext,
		r.PathValue("id"),
		r.PathValue("unitId"),
		input,
	)
	if err != nil {
		writeDevelopmentError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, map[string]Unit{"data": unit})
}

func (handler Handler) ActivatePriceTable(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := developmentTenant(w, r)
	if !ok {
		return
	}
	var input ActivatePriceTableInput
	if err := decodeDevelopmentJSON(w, r, &input); err != nil {
		writeInvalidDevelopmentJSON(w, r)
		return
	}
	priceTable, err := handler.repo.ActivatePriceTable(
		r.Context(),
		tenantContext,
		r.PathValue("id"),
		r.PathValue("priceTableId"),
		input,
	)
	if err != nil {
		writeDevelopmentError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, map[string]PriceTable{"data": priceTable})
}

func (handler Handler) ListReservations(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := developmentTenant(w, r)
	if !ok {
		return
	}
	filter, err := ParseReservationListFilter(r.URL.Query())
	if err != nil {
		writeDevelopmentError(w, r, err)
		return
	}
	response, err := handler.repo.ListReservations(r.Context(), tenantContext, r.PathValue("id"), filter)
	if err != nil {
		writeDevelopmentError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, response)
}

func (handler Handler) CreateReservation(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := developmentTenant(w, r)
	if !ok {
		return
	}
	idempotencyKey := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if idempotencyKey == "" {
		writeDevelopmentError(w, r, fmt.Errorf("%w: Idempotency-Key is required", ErrInvalidInput))
		return
	}
	var input CreateReservationInput
	if err := decodeDevelopmentJSON(w, r, &input); err != nil {
		writeInvalidDevelopmentJSON(w, r)
		return
	}
	result, err := handler.repo.CreateReservation(
		r.Context(),
		tenantContext,
		r.PathValue("id"),
		r.PathValue("unitId"),
		idempotencyKey,
		input,
	)
	if err != nil {
		writeDevelopmentError(w, r, err)
		return
	}
	status := http.StatusCreated
	if !result.Created {
		status = http.StatusOK
	}
	httpserver.WriteJSON(w, status, map[string]Reservation{"data": result.Reservation})
}

func (handler Handler) CancelReservation(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := developmentTenant(w, r)
	if !ok {
		return
	}
	var input CancelReservationInput
	if err := decodeDevelopmentJSON(w, r, &input); err != nil {
		writeInvalidDevelopmentJSON(w, r)
		return
	}
	reservation, err := handler.repo.CancelReservation(
		r.Context(), tenantContext, r.PathValue("id"), r.PathValue("reservationId"), input,
	)
	if err != nil {
		writeDevelopmentError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, map[string]Reservation{"data": reservation})
}

func (handler Handler) ConvertReservation(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := developmentTenant(w, r)
	if !ok {
		return
	}
	var input ReservationTransitionInput
	if err := decodeDevelopmentJSON(w, r, &input); err != nil {
		writeInvalidDevelopmentJSON(w, r)
		return
	}
	reservation, err := handler.repo.ConvertReservation(
		r.Context(), tenantContext, r.PathValue("id"), r.PathValue("reservationId"), input,
	)
	if err != nil {
		writeDevelopmentError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, map[string]Reservation{"data": reservation})
}

func (handler Handler) ExtendReservation(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := developmentTenant(w, r)
	if !ok {
		return
	}
	var input ExtendReservationInput
	if err := decodeDevelopmentJSON(w, r, &input); err != nil {
		writeInvalidDevelopmentJSON(w, r)
		return
	}
	reservation, err := handler.repo.ExtendReservation(
		r.Context(), tenantContext, r.PathValue("id"), r.PathValue("reservationId"), input,
	)
	if err != nil {
		writeDevelopmentError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, map[string]Reservation{"data": reservation})
}

func (handler Handler) UpdateUnitPrice(w http.ResponseWriter, r *http.Request) {
	tenantContext, ok := developmentTenant(w, r)
	if !ok {
		return
	}
	var input UpdateUnitPriceInput
	if err := decodeDevelopmentJSON(w, r, &input); err != nil {
		writeInvalidDevelopmentJSON(w, r)
		return
	}
	result, err := handler.repo.UpdateUnitPrice(
		r.Context(), tenantContext, r.PathValue("id"), r.PathValue("unitId"), input,
	)
	if err != nil {
		writeDevelopmentError(w, r, err)
		return
	}
	httpserver.WriteJSON(w, http.StatusOK, map[string]UpdateUnitPriceResult{"data": result})
}

func developmentTenant(w http.ResponseWriter, r *http.Request) (tenant.Context, bool) {
	tenantContext, ok := tenant.FromContext(r.Context())
	if !ok || tenantContext.OrganizationID == "" {
		httpserver.WriteError(w, r, http.StatusForbidden, "organization_required", "Organization context is required.")
		return tenant.Context{}, false
	}
	return tenantContext, true
}

func decodeDevelopmentJSON(w http.ResponseWriter, r *http.Request, destination any) error {
	defer r.Body.Close()
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, developmentBodyLimit))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("request body must contain one JSON value")
		}
		return err
	}
	return nil
}

func writeInvalidDevelopmentJSON(w http.ResponseWriter, r *http.Request) {
	httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
}

func writeDevelopmentError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, ErrInvalidInput):
		httpserver.WriteError(w, r, http.StatusBadRequest, "invalid_development_input", err.Error())
	case errors.Is(err, ErrNotFound):
		httpserver.WriteError(w, r, http.StatusNotFound, "development_not_found", "Development was not found.")
	case errors.Is(err, ErrConflict):
		httpserver.WriteError(w, r, http.StatusConflict, "development_conflict", "The development changed or the requested operation conflicts with its current state.")
	case errors.Is(err, tenant.ErrOrganizationAccessDenied):
		httpserver.WriteError(w, r, http.StatusForbidden, "permission_denied", "You do not have permission to perform this action.")
	default:
		slog.Error("development operation failed", "error", err)
		httpserver.WriteError(w, r, http.StatusInternalServerError, "development_operation_failed", "Unable to complete development operation.")
	}
}
