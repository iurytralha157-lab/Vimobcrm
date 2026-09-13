package properties

import (
	"errors"
	"strings"
	"testing"
)

func TestValidateOwnerInputRejectsInvalidFieldsWithoutTruncation(t *testing.T) {
	tooLongName := strings.Repeat("á", 161)
	input := OwnerInput{Name: tooLongName}
	if err := validateOwnerInput(&input); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("overlong name error = %v, want ErrInvalidInput", err)
	}
	if input.Name != tooLongName {
		t.Fatalf("overlong owner name was mutated to %q", input.Name)
	}

	for _, invalid := range []OwnerInput{
		{Name: "Maria", Email: "Maria <maria@example.com>"},
		{Name: "Maria", Email: "invalido"},
		{Name: "Maria", NotifyEmail: true},
		{Name: "Maria", Cellphone: strings.Repeat("1", 41)},
		{Name: "Maria", Notes: strings.Repeat("n", 1_201)},
	} {
		candidate := invalid
		if err := validateOwnerInput(&candidate); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("validateOwnerInput(%#v) error = %v, want ErrInvalidInput", invalid, err)
		}
	}
}

func TestValidateOwnerInputNormalizesSafeValues(t *testing.T) {
	input := OwnerInput{
		Name:        "  Maria da Silva  ",
		Email:       "  MARIA@example.com  ",
		NotifyEmail: true,
	}
	if err := validateOwnerInput(&input); err != nil {
		t.Fatalf("validateOwnerInput returned error: %v", err)
	}
	if input.Name != "Maria da Silva" || input.Email != "maria@example.com" {
		t.Fatalf("normalized owner = %#v", input)
	}
}

func TestEmbeddedOwnerValidationMatchesOwnerContract(t *testing.T) {
	if _, err := sanitizePayload(propertyRequest{
		"owner_name": strings.Repeat("a", 161),
	}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("embedded owner length error = %v, want ErrInvalidInput", err)
	}
	if _, err := sanitizePayload(propertyRequest{
		"owner_email": "invalido",
	}); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("embedded owner email error = %v, want ErrInvalidInput", err)
	}
	if err := validateEmbeddedOwnerNotification(propertyRequest{
		"owner_notify_email": true,
	}, "", false); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("embedded notification error = %v, want ErrInvalidInput", err)
	}
}

func TestWorkspaceOwnerValidationMatchesOwnerContract(t *testing.T) {
	tooLong := strings.Repeat("x", 41)
	email := "owner@example.com"
	input := PropertyOwnerDetailsInput{
		Name:        "Maria",
		Cellphone:   &tooLong,
		Email:       &email,
		NotifyEmail: true,
	}
	if err := input.Validate(); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("workspace owner length error = %v, want ErrInvalidInput", err)
	}

	input = PropertyOwnerDetailsInput{Name: "Maria", NotifyEmail: true}
	if err := input.Validate(); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("workspace owner notification error = %v, want ErrInvalidInput", err)
	}
}
