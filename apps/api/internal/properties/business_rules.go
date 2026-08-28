package properties

import "fmt"

var nonNegativePropertyFields = []string{
	"area_total",
	"area_util",
	"banheiros",
	"commission_percentage",
	"comissao_locacao",
	"comissao_venda",
	"condominio",
	"iptu",
	"preco",
	"quartos",
	"renda_familiar",
	"seguro_incendio",
	"suites",
	"taxa_de_servico",
	"vagas",
	"valor_itr",
	"valor_locacao",
	"valor_locacao_avaliado",
	"valor_seguro_fianca",
	"valor_venda_avaliado",
}

func validatePropertyBusinessRules(input propertyRequest) error {
	for _, field := range nonNegativePropertyFields {
		if value, exists := numericPropertyValue(input[field]); exists && value < 0 {
			return fmt.Errorf("%w: %s cannot be negative", ErrInvalidInput, field)
		}
	}

	if latitude, exists := numericPropertyValue(input["latitude"]); exists && (latitude < -90 || latitude > 90) {
		return fmt.Errorf("%w: latitude must be between -90 and 90", ErrInvalidInput)
	}
	if longitude, exists := numericPropertyValue(input["longitude"]); exists && (longitude < -180 || longitude > 180) {
		return fmt.Errorf("%w: longitude must be between -180 and 180", ErrInvalidInput)
	}
	if commission, exists := numericPropertyValue(input["commission_percentage"]); exists && commission > 100 {
		return fmt.Errorf("%w: commission_percentage must be at most 100", ErrInvalidInput)
	}

	return nil
}

func numericPropertyValue(value any) (float64, bool) {
	switch typed := value.(type) {
	case float64:
		return typed, true
	case int64:
		return float64(typed), true
	case int:
		return float64(typed), true
	default:
		return 0, false
	}
}
