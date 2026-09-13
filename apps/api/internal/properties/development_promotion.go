package properties

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

// DevelopmentUnitPropertyInput is intentionally server-owned. The
// developments domain derives it from rows already constrained to the active
// organization; browser payloads never choose organization_id, code,
// publication state or audit actors.
type DevelopmentUnitPropertyInput struct {
	Title                   string
	PropertyType            string
	DealType                string
	Purpose                 string
	Status                  string
	Description             *string
	Address                 *string
	AddressNumber           *string
	Complement              *string
	Neighborhood            *string
	City                    *string
	State                   *string
	PostalCode              *string
	Price                   *float64
	Bedrooms                *int
	Suites                  *int
	Bathrooms               *int
	ParkingSpaces           *int
	UsableArea              *float64
	TotalArea               *float64
	FloorNumber             *int
	MainImageURL            *string
	ImageURLs               []string
	ResponsibleUserID       *string
	PublicAddressVisibility string
	Metadata                map[string]any
}

// CreateFromDevelopmentUnitTx creates a standard property using the canonical
// property contract while leaving transaction ownership with the developments
// workflow. This guarantees that the property insert and unit.property_id link
// either commit together or both roll back.
func (repo Repository) CreateFromDevelopmentUnitTx(
	ctx context.Context,
	tx pgx.Tx,
	tenantContext tenant.Context,
	input DevelopmentUnitPropertyInput,
) (Property, error) {
	validated, err := developmentUnitPropertyRequest(input)
	if err != nil {
		return nil, err
	}

	return repo.createPropertyTx(ctx, tx, tenantContext, validated)
}

func developmentUnitPropertyRequest(input DevelopmentUnitPropertyInput) (propertyRequest, error) {
	if strings.TrimSpace(input.PropertyType) == "" {
		return nil, fmt.Errorf("%w: tipo_de_imovel is required", ErrInvalidInput)
	}
	request := propertyRequest{
		"title":                     input.Title,
		"tipo_de_imovel":            input.PropertyType,
		"tipo_de_negocio":           input.DealType,
		"finalidade":                input.Purpose,
		"status":                    input.Status,
		"image_urls":                input.ImageURLs,
		"public_address_visibility": input.PublicAddressVisibility,
		"metadata":                  input.Metadata,
	}
	optionalTextFields := map[string]*string{
		"descricao":           input.Description,
		"endereco":            input.Address,
		"numero":              input.AddressNumber,
		"complemento":         input.Complement,
		"bairro":              input.Neighborhood,
		"cidade":              input.City,
		"uf":                  input.State,
		"cep":                 input.PostalCode,
		"imagem_principal":    input.MainImageURL,
		"responsible_user_id": input.ResponsibleUserID,
	}
	for field, value := range optionalTextFields {
		if value != nil {
			request[field] = *value
		}
	}
	optionalNumericFields := map[string]*float64{
		"preco":      input.Price,
		"area_util":  input.UsableArea,
		"area_total": input.TotalArea,
	}
	for field, value := range optionalNumericFields {
		if value != nil {
			request[field] = *value
		}
	}
	optionalIntegerFields := map[string]*int{
		"quartos":   input.Bedrooms,
		"suites":    input.Suites,
		"banheiros": input.Bathrooms,
		"vagas":     input.ParkingSpaces,
		"andar":     input.FloorNumber,
	}
	for field, value := range optionalIntegerFields {
		if value != nil {
			// propertyRequest uses the same number representation produced by its
			// strict JSON decoder. Keep internal promotion on that canonical path.
			request[field] = float64(*value)
		}
	}

	validated, err := request.ValidateCreate()
	if err != nil {
		return nil, err
	}
	// A promoted unit always starts unpublished. Publication remains an
	// explicit Property Publication Center workflow.
	validated["published_on_site"] = false
	validated["is_demo"] = false

	return validated, nil
}
