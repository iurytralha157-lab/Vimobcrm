package grupoolx

import (
	"strings"
	"unicode"

	"golang.org/x/text/unicode/norm"
)

type RoomRequirements struct {
	MinimumBedrooms  int
	MinimumBathrooms int
}

func NormalizePropertyType(value string) string {
	normalized := normalizeText(value)
	switch {
	case strings.Contains(normalized, "fazenda") && strings.Contains(normalized, "sitio") && strings.Contains(normalized, "chacara"):
		return "Residential / Agricultural"
	case strings.Contains(normalized, "condominio") && strings.Contains(normalized, "casa"):
		return "Residential / Condo"
	case strings.Contains(normalized, "casa de vila"), strings.Contains(normalized, "village house"):
		return "Residential / Village House"
	case strings.Contains(normalized, "sobrado"):
		return "Residential / Sobrado"
	case strings.Contains(normalized, "casa"):
		return "Residential / Home"
	case strings.Contains(normalized, "cobertura"):
		return "Residential / Penthouse"
	case strings.Contains(normalized, "flat"):
		return "Residential / Flat"
	case strings.Contains(normalized, "kitnet"), strings.Contains(normalized, "conjugado"):
		return "Residential / Kitnet"
	case strings.Contains(normalized, "studio"):
		return "Residential / Studio"
	case strings.Contains(normalized, "loft"):
		return "Residential / Loft"
	case strings.Contains(normalized, "apart"):
		return "Residential / Apartment"
	case strings.Contains(normalized, "edificio residencial"), strings.Contains(normalized, "predio residencial"):
		return "Commercial / Edificio Residencial"
	case (strings.Contains(normalized, "terreno") || strings.Contains(normalized, "lote")) && strings.Contains(normalized, "comercial"):
		return "Commercial / Land Lot"
	case strings.Contains(normalized, "terreno"), strings.Contains(normalized, "lote"):
		return "Residential / Land Lot"
	case strings.Contains(normalized, "consultorio"):
		return "Commercial / Consultorio"
	case strings.Contains(normalized, "laje corporativa"), strings.Contains(normalized, "andar corporativo"), normalized == "andar", strings.Contains(normalized, "corporate floor"):
		return "Commercial / Corporate Floor"
	case strings.Contains(normalized, "inteiro") && (strings.Contains(normalized, "edificio") || strings.Contains(normalized, "predio")):
		return "Commercial / Edificio Comercial"
	case strings.Contains(normalized, "edificio comercial"), strings.Contains(normalized, "predio comercial"):
		return "Commercial / Edificio Comercial"
	case strings.Contains(normalized, "garagem"), strings.Contains(normalized, "garage"):
		return "Commercial / Garage"
	case strings.Contains(normalized, "hotel"), strings.Contains(normalized, "pousada"), strings.Contains(normalized, "motel"):
		return "Commercial / Hotel"
	case strings.Contains(normalized, "salao"):
		return "Commercial / Business"
	case strings.Contains(normalized, "sala"), strings.Contains(normalized, "conjunto"):
		return "Commercial / Office"
	case strings.Contains(normalized, "loja"), strings.Contains(normalized, "ponto comercial"), strings.Contains(normalized, "box"):
		return "Commercial / Business"
	case strings.Contains(normalized, "galpao"), strings.Contains(normalized, "deposito"), strings.Contains(normalized, "armazem"):
		return "Commercial / Industrial"
	case strings.Contains(normalized, "chacara"), strings.Contains(normalized, "farm ranch"), strings.Contains(normalized, "ranch"):
		return "Residential / Farm Ranch"
	case strings.Contains(normalized, "fazenda"), strings.Contains(normalized, "sitio"), strings.Contains(normalized, "agricola"), strings.Contains(normalized, "agricultural"):
		return "Residential / Agricultural"
	case strings.Contains(normalized, "imovel comercial"):
		return "Commercial / Building"
	case strings.Contains(normalized, "edificio"), strings.Contains(normalized, "predio"), strings.Contains(normalized, "building"):
		return "Commercial / Building"
	default:
		return ""
	}
}

func RequiresLotArea(propertyType string) bool {
	return strings.Contains(propertyType, "Land Lot") ||
		strings.Contains(propertyType, "Farm Ranch") ||
		strings.Contains(propertyType, "Agricultural") ||
		strings.Contains(propertyType, "Industrial")
}

func RoomRequirementsFor(propertyType string) RoomRequirements {
	residentialBedrooms := map[string]bool{
		"Residential / Apartment": true, "Residential / Home": true,
		"Residential / Condo": true, "Residential / Village House": true,
		"Residential / Farm Ranch": true, "Residential / Penthouse": true,
		"Residential / Flat": true, "Residential / Loft": true,
		"Residential / Sobrado": true, "Residential / Studio": true,
		"Residential / Agricultural": true,
	}
	residentialBathrooms := map[string]bool{
		"Residential / Apartment": true, "Residential / Home": true,
		"Residential / Condo": true, "Residential / Village House": true,
		"Residential / Farm Ranch": true, "Residential / Penthouse": true,
		"Residential / Flat": true, "Residential / Kitnet": true,
		"Residential / Loft": true, "Residential / Sobrado": true,
		"Residential / Agricultural": true,
	}
	requirements := RoomRequirements{}
	if residentialBedrooms[propertyType] || propertyType == "Commercial / Edificio Residencial" {
		requirements.MinimumBedrooms = 1
	}
	if residentialBathrooms[propertyType] || propertyType == "Commercial / Consultorio" ||
		propertyType == "Commercial / Edificio Residencial" || propertyType == "Commercial / Office" {
		requirements.MinimumBathrooms = 1
	}
	return requirements
}

func normalizeText(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	decomposed := norm.NFD.String(value)
	var builder strings.Builder
	for _, character := range decomposed {
		if unicode.Is(unicode.Mn, character) {
			continue
		}
		builder.WriteRune(character)
	}
	return strings.Join(strings.Fields(builder.String()), " ")
}
