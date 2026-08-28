package leads

import "testing"

func TestTagMutationRequestValidateColor(t *testing.T) {
	valid, err := (TagMutationRequest{Name: "Investidor", Color: " #3b82F6 "}).Validate()
	if err != nil {
		t.Fatalf("valid tag color was rejected: %v", err)
	}
	if valid.Color != "#3b82F6" {
		t.Fatalf("color = %q, want trimmed hexadecimal value", valid.Color)
	}

	for _, color := range []string{"#", "#fff", "#11223344", "red", "112233"} {
		t.Run(color, func(t *testing.T) {
			if _, err := (TagMutationRequest{Name: "Investidor", Color: color}).Validate(); err == nil {
				t.Fatalf("invalid tag color %q was accepted", color)
			}
		})
	}
}

func TestTagMutationRequestValidateUsesSafeDefaultColor(t *testing.T) {
	input, err := (TagMutationRequest{Name: "Investidor"}).Validate()
	if err != nil {
		t.Fatalf("default tag color was rejected: %v", err)
	}
	if input.Color != "#64748b" {
		t.Fatalf("color = %q, want default #64748b", input.Color)
	}
}
