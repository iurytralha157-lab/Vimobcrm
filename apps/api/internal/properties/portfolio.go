package properties

import (
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const (
	propertyPortfolioReady      = "ready"
	propertyPortfolioLaunch     = "launch"
	propertyPortfolioThirdParty = "third_party"

	propertyThirdPartyPartner      = "partner"
	propertyThirdPartyPrivateOwner = "private_owner"

	propertyPartnerNameMaxLength    = 160
	propertyPartnerContactMaxLength = 200

	propertyDealTypeLaunch = "lancamento"
)

// Partner contact is a separate list from propertyOwnerContactFields because
// the owner list also drives "clear contacts when the owner is removed". A
// partner is not an owner, so that flow must not erase this column.
var propertyPartnerContactFields = []string{"partner_contact"}

var propertyThirdPartyFields = []string{
	"third_party_kind",
	"partner_name",
	"partner_contact",
	"commission_split_percent",
	"third_party_authorized_until",
}

func normalizePropertyPortfolioType(value any) (any, error) {
	text, ok := value.(string)
	if !ok {
		return nil, fmt.Errorf("expected portfolio type string")
	}
	normalized := strings.ToLower(strings.TrimSpace(text))
	switch normalized {
	case propertyPortfolioReady, propertyPortfolioLaunch, propertyPortfolioThirdParty:
		return normalized, nil
	default:
		return nil, fmt.Errorf("invalid portfolio type")
	}
}

func normalizePropertyThirdPartyKind(value any) (any, error) {
	if value == nil {
		return nil, nil
	}
	text, ok := value.(string)
	if !ok {
		return nil, fmt.Errorf("expected third party kind string")
	}
	normalized := strings.ToLower(strings.TrimSpace(text))
	switch normalized {
	case "":
		return nil, nil
	case propertyThirdPartyPartner, propertyThirdPartyPrivateOwner:
		return normalized, nil
	default:
		return nil, fmt.Errorf("invalid third party kind")
	}
}

// normalizePropertyPortfolioFields validates each supplied field on its own and
// turns empty form values into null. Rules that depend on the stored row are in
// reconcilePropertyPortfolioUpdate.
func normalizePropertyPortfolioFields(input propertyRequest) error {
	if value, supplied := input["portfolio_type"]; supplied && value == nil {
		return fmt.Errorf("%w: portfolio_type cannot be null", ErrInvalidInput)
	}
	for _, field := range []struct {
		name  string
		limit int
	}{
		{"partner_name", propertyPartnerNameMaxLength},
		{"partner_contact", propertyPartnerContactMaxLength},
	} {
		value, supplied := input[field.name]
		if !supplied {
			continue
		}
		if text, ok := value.(string); ok {
			if text == "" {
				input[field.name] = nil
			} else if len([]rune(text)) > field.limit {
				return fmt.Errorf("%w: %s must have at most %d characters", ErrInvalidInput, field.name, field.limit)
			}
		}
	}
	if value, supplied := input["commission_split_percent"]; supplied && value != nil {
		percent, ok := value.(float64)
		if !ok || math.IsNaN(percent) || percent < 0 || percent > 100 {
			return fmt.Errorf("%w: commission_split_percent must be between 0 and 100", ErrInvalidInput)
		}
	}
	if value, supplied := input["third_party_authorized_until"]; supplied && value != nil {
		text, _ := value.(string)
		if text == "" {
			input["third_party_authorized_until"] = nil
		} else if _, err := time.Parse("2006-01-02", text); err != nil {
			return fmt.Errorf("%w: third_party_authorized_until must use YYYY-MM-DD", ErrInvalidInput)
		}
	}
	return nil
}

func propertyPortfolioFieldValue(input propertyRequest, field string, current string) string {
	if value, supplied := input[field]; supplied {
		text, _ := value.(string)
		return strings.TrimSpace(text)
	}
	return current
}

func validatePropertyPortfolioDealType(portfolioType string, dealType string) error {
	isLaunchDeal := normalizeASCII(dealType) == propertyDealTypeLaunch
	if portfolioType == propertyPortfolioLaunch && !isLaunchDeal {
		return fmt.Errorf("%w: portfolio_type launch requires tipo_de_negocio Lancamento", ErrInvalidInput)
	}
	if portfolioType == propertyPortfolioReady && isLaunchDeal {
		return fmt.Errorf("%w: portfolio_type ready cannot use tipo_de_negocio Lancamento", ErrInvalidInput)
	}
	return nil
}

func rejectSuppliedPropertyFields(input propertyRequest, fields []string, reason string) error {
	for _, field := range fields {
		if value, supplied := input[field]; supplied && value != nil {
			return fmt.Errorf("%w: %s %s", ErrInvalidInput, field, reason)
		}
	}
	return nil
}

func validateThirdPartyDetails(input propertyRequest, kind string, partnerName string) error {
	switch kind {
	case "":
		return fmt.Errorf("%w: third_party_kind is required for third_party properties", ErrInvalidInput)
	case propertyThirdPartyPartner:
		if partnerName == "" {
			return fmt.Errorf("%w: partner_name is required for partner properties", ErrInvalidInput)
		}
	case propertyThirdPartyPrivateOwner:
		return rejectSuppliedPropertyFields(input, []string{"partner_name", "partner_contact"},
			"is only valid for partner properties; private owners use the owner fields")
	}
	return nil
}

// validatePropertyPortfolioCreate checks a complete new row. An omitted
// portfolio_type stays omitted so existing clients keep their request
// fingerprint: the column default and the deal-type trigger classify the row.
func validatePropertyPortfolioCreate(input propertyRequest) error {
	portfolioType, supplied := input["portfolio_type"].(string)
	dealType, _ := input["finalidade"].(string)
	if supplied {
		if err := validatePropertyPortfolioDealType(portfolioType, dealType); err != nil {
			return err
		}
	}
	if portfolioType != propertyPortfolioThirdParty {
		return rejectSuppliedPropertyFields(input, propertyThirdPartyFields, "requires portfolio_type third_party")
	}
	return validateThirdPartyDetails(
		input,
		propertyPortfolioFieldValue(input, "third_party_kind", ""),
		propertyPortfolioFieldValue(input, "partner_name", ""),
	)
}

func propertyPortfolioFieldsTouched(input propertyRequest) bool {
	if _, supplied := input["portfolio_type"]; supplied {
		return true
	}
	return hasAnyPropertyUpdateField(input, propertyThirdPartyFields)
}

// reconcilePropertyPortfolioUpdate validates the row that will exist after a
// partial update and clears third-party data the new classification cannot
// hold. Requests that touch none of these fields are left untouched, so clients
// that do not know them can never reset stored values.
func reconcilePropertyPortfolioUpdate(input propertyRequest, current propertySnapshot, canViewContacts, canManage bool) error {
	if !propertyPortfolioFieldsTouched(input) {
		return nil
	}
	nextType := propertyPortfolioFieldValue(input, "portfolio_type", current.PortfolioType)
	if _, supplied := input["portfolio_type"]; supplied {
		dealType := current.DealType
		if next, changes := input["finalidade"].(string); changes {
			dealType = next
		}
		if err := validatePropertyPortfolioDealType(nextType, dealType); err != nil {
			return err
		}
	}

	if nextType != propertyPortfolioThirdParty {
		if err := rejectSuppliedPropertyFields(input, propertyThirdPartyFields, "requires portfolio_type third_party"); err != nil {
			return err
		}
		if current.PortfolioType != propertyPortfolioThirdParty {
			// Explicit nulls on a row that has none are not a change.
			for _, field := range propertyThirdPartyFields {
				delete(input, field)
			}
			return nil
		}
		if !canViewContacts && current.PartnerContact != "" {
			return errPropertyPartnerContactProtected()
		}
		// Leaving third party clears these too, and whoever cannot set them must
		// not be able to erase them by reclassifying the property.
		if !canManage && (current.HasCommissionSplit || current.HasThirdPartyAuthorization) {
			return tenant.ErrOrganizationAccessDenied
		}
		for _, field := range propertyThirdPartyFields {
			input[field] = nil
		}
		return nil
	}

	kind := propertyPortfolioFieldValue(input, "third_party_kind", current.ThirdPartyKind)
	partnerName := propertyPortfolioFieldValue(input, "partner_name", current.PartnerName)
	if kind == propertyThirdPartyPrivateOwner {
		partnerName = ""
		if !canViewContacts && current.PartnerContact != "" {
			return errPropertyPartnerContactProtected()
		}
	}
	if err := validateThirdPartyDetails(input, kind, partnerName); err != nil {
		return err
	}
	if kind == propertyThirdPartyPrivateOwner {
		input["partner_name"] = nil
		input["partner_contact"] = nil
	}
	return nil
}

func propertyPortfolioChanges(input propertyRequest, current propertySnapshot) bool {
	value, supplied := input["portfolio_type"].(string)
	return supplied && value != current.PortfolioType
}

// A viewer who cannot read the partner contact cannot erase it either.
func errPropertyPartnerContactProtected() error {
	return tenant.ErrOrganizationAccessDenied
}
