package numericinput

import (
	"math"
	"testing"
)

func TestParseNonNegativeDecimal(t *testing.T) {
	tests := []struct {
		input string
		want  float64
	}{
		{input: "500000", want: 500000},
		{input: "500.000", want: 500000},
		{input: "500.000,00", want: 500000},
		{input: "R$ 500.000,00", want: 500000},
		{input: "1.234.567,89", want: 1234567.89},
		{input: "1,234,567.89", want: 1234567.89},
		{input: "12,50", want: 12.5},
		{input: "12.50", want: 12.5},
		{input: "0", want: 0},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got, ok := ParseNonNegativeDecimal(tt.input)
			if !ok || math.Abs(got-tt.want) > 0.000001 {
				t.Fatalf("ParseNonNegativeDecimal(%q) = %v, %v; want %v, true", tt.input, got, ok, tt.want)
			}
		})
	}
}

func TestParseNonNegativeDecimalRejectsInvalidInput(t *testing.T) {
	for _, input := range []string{"", "R$", "-1", "1e3", "1.23.45", "abc500"} {
		t.Run(input, func(t *testing.T) {
			if got, ok := ParseNonNegativeDecimal(input); ok {
				t.Fatalf("ParseNonNegativeDecimal(%q) = %v, true; want invalid", input, got)
			}
		})
	}
}
