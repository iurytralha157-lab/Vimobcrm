package properties

import (
	"encoding/json"
	"fmt"
	"strings"
)

const propertyManagedTermsField = "managed_terms"

type propertyManagedTerms struct {
	CondominiumExempt bool   `json:"condominium_exempt"`
	PropertyTaxExempt bool   `json:"property_tax_exempt"`
	FinancingMode     string `json:"financing_mode"`
}

func propertyMetadataMap(value any) map[string]any {
	metadata := map[string]any{}
	switch typed := value.(type) {
	case map[string]any:
		for key, item := range typed {
			metadata[key] = item
		}
	case string:
		if strings.TrimSpace(typed) != "" {
			_ = json.Unmarshal([]byte(typed), &metadata)
		}
	}
	return metadata
}

func mergePropertyMetadata(current map[string]any, supplied map[string]any) map[string]any {
	merged := map[string]any{}
	for key, value := range current {
		merged[key] = value
	}
	for key, value := range supplied {
		merged[key] = value
	}
	return merged
}

func parseSuppliedPropertyMetadata(value any) (map[string]any, error) {
	switch typed := value.(type) {
	case map[string]any:
		return propertyMetadataMap(typed), nil
	case string:
		var decoded any
		if err := json.Unmarshal([]byte(typed), &decoded); err != nil {
			return nil, fmt.Errorf("%w: metadata must be a JSON object", ErrInvalidInput)
		}
		metadata, ok := decoded.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("%w: metadata must be a JSON object", ErrInvalidInput)
		}
		return metadata, nil
	default:
		return nil, fmt.Errorf("%w: metadata must be a JSON object", ErrInvalidInput)
	}
}

func propertyManagedBoolean(metadata map[string]any, key string) bool {
	value, _ := metadata[key].(bool)
	return value
}

func normalizePropertyFinancingMode(value any, acceptsFinancing bool) string {
	mode, _ := value.(string)
	switch strings.ToLower(strings.TrimSpace(mode)) {
	case "sim", "nao", "mcmv":
		return strings.ToLower(strings.TrimSpace(mode))
	default:
		if acceptsFinancing {
			return "sim"
		}
		return "nao"
	}
}

func derivePropertyManagedTerms(metadata map[string]any, dealType string, acceptsFinancing bool) propertyManagedTerms {
	return propertyManagedTerms{
		CondominiumExempt: propertyManagedBoolean(metadata, "condominio_isento"),
		PropertyTaxExempt: propertyManagedBoolean(metadata, "iptu_isento") || normalizedDealTypeForFilter(dealType) == "temporada",
		FinancingMode:     normalizePropertyFinancingMode(metadata["financing_mode"], acceptsFinancing),
	}
}

func attachPropertyManagedTerms(property Property) {
	if property == nil {
		return
	}
	property[propertyManagedTermsField] = derivePropertyManagedTerms(
		propertyMetadataMap(property["metadata"]),
		anyString(property["tipo_de_negocio"]),
		anyBool(property["aceita_financiamento"]),
	)
}

func validateManagedMetadataInput(metadata map[string]any) error {
	for _, key := range []string{"condominio_isento", "iptu_isento"} {
		if value, supplied := metadata[key]; supplied {
			if _, ok := value.(bool); !ok {
				return fmt.Errorf("%w: metadata.%s must be boolean", ErrInvalidInput, key)
			}
		}
	}
	if value, supplied := metadata["financing_mode"]; supplied {
		mode, ok := value.(string)
		if !ok {
			return fmt.Errorf("%w: metadata.financing_mode must be sim, nao or mcmv", ErrInvalidInput)
		}
		switch strings.ToLower(strings.TrimSpace(mode)) {
		case "sim", "nao", "mcmv":
		default:
			return fmt.Errorf("%w: metadata.financing_mode must be sim, nao or mcmv", ErrInvalidInput)
		}
	}
	return nil
}

// enforcePropertyManagedTerms runs after authorization and the optimistic lock.
// It preserves hidden manager metadata while making the canonical value columns
// consistent for every caller, including clients that bypass the React form.
func enforcePropertyManagedTerms(input propertyRequest, current propertySnapshot, canManage bool) error {
	currentMetadata := propertyMetadataMap(current.Metadata)
	metadataValue, metadataSupplied := input["metadata"]
	suppliedMetadata := map[string]any{}
	if metadataSupplied {
		var err error
		suppliedMetadata, err = parseSuppliedPropertyMetadata(metadataValue)
		if err != nil {
			return err
		}
	}
	if canManage && metadataSupplied {
		if err := validateManagedMetadataInput(suppliedMetadata); err != nil {
			return err
		}
	}
	metadata := mergePropertyMetadata(currentMetadata, suppliedMetadata)

	dealType := current.DealType
	if supplied, ok := input["finalidade"].(string); ok {
		dealType = supplied
	}
	financingValue, financingFieldSupplied := input["aceita_financiamento"]
	acceptsFinancing, financingBooleanSupplied := financingValue.(bool)
	if !financingBooleanSupplied {
		acceptsFinancing = current.AcceptsFinancing
	}

	mode := normalizePropertyFinancingMode(metadata["financing_mode"], acceptsFinancing)
	_, managerSuppliedMode := suppliedMetadata["financing_mode"]
	managerSuppliedMode = canManage && metadataSupplied && managerSuppliedMode
	metadataModePatched := false
	if !managerSuppliedMode && financingBooleanSupplied && mode != "mcmv" {
		if acceptsFinancing {
			mode = "sim"
		} else {
			mode = "nao"
		}
		metadata["financing_mode"] = mode
		suppliedMetadata["financing_mode"] = mode
		metadataModePatched = true
	}
	if metadataModePatched {
		encoded, err := json.Marshal(suppliedMetadata)
		if err != nil {
			return fmt.Errorf("%w: metadata is invalid", ErrInvalidInput)
		}
		input["metadata"] = string(encoded)
	}

	expectedAcceptsFinancing := mode != "nao"
	if financingFieldSupplied || managerSuppliedMode || expectedAcceptsFinancing != current.AcceptsFinancing {
		input["aceita_financiamento"] = expectedAcceptsFinancing
	}
	terms := derivePropertyManagedTerms(metadata, dealType, mode != "nao")
	_, condominiumSupplied := input["condominio"]
	if terms.CondominiumExempt && (condominiumSupplied || current.HasCondominiumCharge) {
		input["condominio"] = nil
	}
	_, propertyTaxSupplied := input["iptu"]
	if terms.PropertyTaxExempt && (propertyTaxSupplied || current.HasPropertyTaxCharge) {
		input["iptu"] = nil
	}
	return nil
}
