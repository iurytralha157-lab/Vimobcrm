package properties

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDecodeLocationJSONIsStrict(t *testing.T) {
	tests := []string{
		`{"name":"Centro","unknown":true}`,
		`{"name":"Centro"}{"name":"Jardins"}`,
	}

	for _, body := range tests {
		request := httptest.NewRequest("POST", "/v1/property-cities", strings.NewReader(body))
		response := httptest.NewRecorder()
		var input cityRequest
		if err := decodeLocationJSON(response, request, &input); err == nil {
			t.Fatalf("expected strict decoder to reject %q", body)
		}
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
