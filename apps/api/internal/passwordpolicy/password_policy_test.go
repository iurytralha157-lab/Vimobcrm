package passwordpolicy

import (
	"strings"
	"testing"
)

func TestIsStrong(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name     string
		password string
		want     bool
	}{
		{name: "valid", password: "SenhaForte1!", want: true},
		{name: "valid unicode", password: "SenhaÓtima2#", want: true},
		{name: "too short", password: "Ab1!", want: false},
		{name: "maximum bytes", password: "Aa1!" + strings.Repeat("x", MaxBytes-4), want: true},
		{name: "too many ascii bytes", password: "Aa1!" + strings.Repeat("x", MaxBytes-3), want: false},
		{name: "too many unicode bytes", password: "Aa1!" + strings.Repeat("á", 35), want: false},
		{name: "missing uppercase", password: "senhaforte1!", want: false},
		{name: "missing lowercase", password: "SENHAFORTE1!", want: false},
		{name: "missing number", password: "SenhaForte!", want: false},
		{name: "missing symbol", password: "SenhaForte1", want: false},
		{name: "space is not a symbol", password: "Senha Forte1", want: false},
	}

	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			if got := IsStrong(testCase.password); got != testCase.want {
				t.Fatalf("IsStrong(%q) = %t, want %t", testCase.password, got, testCase.want)
			}
		})
	}
}
