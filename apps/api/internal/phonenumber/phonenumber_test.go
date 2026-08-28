package phonenumber

import (
	"errors"
	"testing"
)

func TestCanonicalize(t *testing.T) {
	tests := []struct {
		name  string
		value string
		want  string
	}{
		{name: "empty optional value", value: "  ", want: ""},
		{name: "Brazilian local mobile", value: "(11) 99999-9999", want: "+5511999999999"},
		{name: "Brazilian local landline", value: "11 3333-4444", want: "+551133334444"},
		{name: "explicit NANP", value: "+1 (415) 555-2671", want: "+14155552671"},
		{name: "international access prefix", value: "00 351 912 345 678", want: "+351912345678"},
		{name: "bare country-inclusive value", value: "351912345678", want: "+351912345678"},
		{name: "minimum structural length", value: "+80012345", want: "+80012345"},
		{name: "maximum structural length", value: "+123456789012345", want: "+123456789012345"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := Canonicalize(test.value)
			if err != nil {
				t.Fatalf("Canonicalize(%q) returned error: %v", test.value, err)
			}
			if got != test.want {
				t.Fatalf("Canonicalize(%q) = %q, want %q", test.value, got, test.want)
			}
		})
	}
}

func TestCanonicalizeRejectsInvalidStructure(t *testing.T) {
	values := []string{
		"+1234567",
		"+1234567890123456",
		"12345678",
		"912345678",
		"+0123456789",
		"+55 11 99999-9999 ramal 2",
		"55+11 99999-9999",
		"+55 (11 99999-9999",
		"+55 ((11)) 99999-9999",
		"+55 11 99999/9999",
	}

	for _, value := range values {
		t.Run(value, func(t *testing.T) {
			if _, err := Canonicalize(value); !errors.Is(err, ErrInvalid) {
				t.Fatalf("Canonicalize(%q) error = %v, want ErrInvalid", value, err)
			}
		})
	}
}
