package leads

import (
	"fmt"
	"math"
	"math/big"
	"regexp"
	"strconv"
	"strings"
)

const leadFinancialWireMaxLength = 40

var ErrLeadFinancialValuesInvalid = fmt.Errorf("%w: lead financial values are invalid", ErrInvalidInput)

var leadFinancialDecimalPattern = regexp.MustCompile(`^[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$`)

// Keep decimal text exact for PostgreSQL. The float check only establishes the
// supported finite, non-underflowing transport range, never percentage bounds.
func normalizeLeadFinancialNumber(raw string, percentage bool, maxLength int) (string, error) {
	value := strings.TrimSpace(raw)
	invalid := func() (string, error) {
		return "", ErrLeadFinancialValuesInvalid
	}
	if maxLength > 0 && len(value) > maxLength || !leadFinancialDecimalPattern.MatchString(value) {
		return invalid()
	}
	mantissa := value
	if exponent := strings.IndexAny(mantissa, "eE"); exponent >= 0 {
		mantissa = mantissa[:exponent]
	}
	if !strings.ContainsAny(mantissa, "123456789") {
		// Avoid parsing an unbounded exponent (or constructing a huge Rat) for
		// signed/exponential zero. The normalized DB value is simply zero.
		return "0", nil
	}
	if strings.HasPrefix(value, "-") {
		return invalid()
	}
	number, err := strconv.ParseFloat(value, 64)
	if err != nil || math.IsNaN(number) || math.IsInf(number, 0) || number == 0 {
		return invalid()
	}
	if percentage {
		// Finite/nonzero checks bound the exponent before exact parsing. Float
		// comparison alone would accept 100.0000000000000000001 as 100.
		exact, valid := new(big.Rat).SetString(value)
		if !valid || exact.Cmp(big.NewRat(100, 1)) > 0 {
			return invalid()
		}
	}
	return value, nil
}

func normalizeLeadFinancialOptional(raw *string, percentage bool, maxLength int, allowBlank bool) (*string, error) {
	if raw == nil || allowBlank && strings.TrimSpace(*raw) == "" {
		return nil, nil
	}
	value, err := normalizeLeadFinancialNumber(*raw, percentage, maxLength)
	if err != nil {
		return nil, err
	}
	return &value, nil
}

func normalizeLeadCreateFinancialInput(input *createInput) error {
	value, err := normalizeLeadFinancialOptional(input.InterestValue, false, leadFinancialWireMaxLength, true)
	if err != nil {
		return err
	}
	input.InterestValue = value
	return nil
}

// A zero maxLength is reserved for canonical numeric text read from PostgreSQL,
// which can legitimately have more precision than a new wire field permits.
func normalizeLeadUpdateFinancialInput(input *updateInput, maxLength int) error {
	nextValue, nextPercentage := input.InterestValue, input.CommissionPercentage
	for _, item := range []struct {
		field      *patchString
		percentage bool
	}{
		{&nextValue, false},
		{&nextPercentage, true},
	} {
		if !item.field.Set {
			continue
		}
		normalized, err := normalizeLeadFinancialOptional(item.field.Value, item.percentage, maxLength, false)
		if err != nil {
			return err
		}
		item.field.Value = normalized
	}
	input.InterestValue, input.CommissionPercentage = nextValue, nextPercentage
	return nil
}
