package properties

import (
	"encoding/json"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
)

func TestLocationJSONIsStrict(t *testing.T) {
	tests := []string{
		`{"name":"Centro","unknown":true}`,
		`{"name":"Centro"}{"name":"Jardins"}`,
	}

	for _, body := range tests {
		request := httptest.NewRequest("POST", "/v1/property-cities", strings.NewReader(body))
		response := httptest.NewRecorder()
		var input cityRequest
		if err := httpserver.DecodeJSON(response, request, &input, propertyLocationBodyLimit); err == nil {
			t.Fatalf("expected strict decoder to reject %q", body)
		}
	}
}

func TestCondominiumPatchDistinguishesOmittedAndNull(t *testing.T) {
	var omitted CondominiumUpdateInput
	if err := json.Unmarshal([]byte(`{}`), &omitted); err != nil {
		t.Fatal(err)
	}
	if !condominiumPatchIsEmpty(omitted) {
		t.Fatal("omitted fields must leave the PATCH empty")
	}

	var clear CondominiumUpdateInput
	if err := json.Unmarshal([]byte(`{"default_condominium_fee":null,"latitude":null,"longitude":null,"photo_url":null}`), &clear); err != nil {
		t.Fatal(err)
	}
	if condominiumPatchIsEmpty(clear) || !clear.DefaultCondominiumFee.Set || clear.DefaultCondominiumFee.Value != nil ||
		!clear.Latitude.Set || clear.Latitude.Value != nil || !clear.Longitude.Set || clear.Longitude.Value != nil ||
		!clear.PhotoURL.Set || clear.PhotoURL.Value != nil {
		t.Fatalf("explicit null was not preserved: %#v", clear)
	}
	fee, latitude, longitude := 900.0, -22.9, -43.2
	target := CondominiumInput{
		Name: "Condominio", PhotoURL: "https://example.test/photo.jpg",
		DefaultCondominiumFee: &fee, Latitude: &latitude, Longitude: &longitude,
	}
	if err := applyCondominiumPatch(&target, clear); err != nil {
		t.Fatal(err)
	}
	if target.DefaultCondominiumFee != nil || target.Latitude != nil || target.Longitude != nil || target.PhotoURL != "" {
		t.Fatalf("nullable values were not cleared: %#v", target)
	}
}

func TestLocationValidationRejectsOverlongInputWithoutTruncating(t *testing.T) {
	name := strings.Repeat("a", 121)
	validated, err := validateLocationText(name, "name", 120, true)
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("error = %v, want ErrInvalidInput", err)
	}
	if validated != "" || len(name) != 121 {
		t.Fatal("invalid location text must be rejected, not truncated")
	}

	input := CondominiumInput{Name: "Condominio", Address: strings.Repeat("b", 301)}
	if err := validateCondominiumInput(&input); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("error = %v, want ErrInvalidInput", err)
	}
	if len(input.Address) != 301 {
		t.Fatal("overlong condominium address was silently mutated")
	}
}

func TestCondominiumPatchRejectsNullRequiredFields(t *testing.T) {
	var patch CondominiumUpdateInput
	if err := json.Unmarshal([]byte(`{"name":null}`), &patch); err != nil {
		t.Fatal(err)
	}
	if err := applyCondominiumPatch(&CondominiumInput{Name: "Atual"}, patch); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("error = %v, want ErrInvalidInput", err)
	}
}

func TestParseOptionalLocationUUIDRejectsInvalidIdentifiers(t *testing.T) {
	const validID = "11111111-1111-4111-8111-111111111111"

	if value, present, err := parseOptionalLocationUUID(""); err != nil || present || value != "" {
		t.Fatalf("empty identifier = (%q, %v, %v)", value, present, err)
	}
	if value, present, err := parseOptionalLocationUUID(validID); err != nil || !present || value != validID {
		t.Fatalf("valid identifier = (%q, %v, %v)", value, present, err)
	}
	if _, _, err := parseOptionalLocationUUID("not-a-uuid"); err == nil {
		t.Fatal("expected invalid identifier to be rejected")
	}
}

func TestSafeLocationURL(t *testing.T) {
	for _, value := range []string{"https://cdn.example.com/condominio.jpg", "http://localhost/photo.png"} {
		if !isSafeLocationURL(value) {
			t.Fatalf("expected %q to be accepted", value)
		}
	}
	for _, value := range []string{"javascript:alert(1)", "ftp://example.com/photo.png", "https://user:password@example.com/photo.png"} {
		if isSafeLocationURL(value) {
			t.Fatalf("expected %q to be rejected", value)
		}
	}
}

func TestLocationStateCode(t *testing.T) {
	for _, value := range []string{"RJ", "SP"} {
		if !isLocationStateCode(value) {
			t.Fatalf("expected %q to be accepted", value)
		}
	}
	for _, value := range []string{"", "R", "rj", "R1", "RIO"} {
		if isLocationStateCode(value) {
			t.Fatalf("expected %q to be rejected", value)
		}
	}
}
