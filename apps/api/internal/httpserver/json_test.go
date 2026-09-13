package httpserver

import (
	"net/http/httptest"
	"strings"
	"testing"
)

type strictJSONFixture struct {
	Name string `json:"name"`
}

func TestDecodeJSONAcceptsOneStrictValue(t *testing.T) {
	request := httptest.NewRequest("POST", "/", strings.NewReader("{\"name\":\"Vimob\"}  \n\t"))
	response := httptest.NewRecorder()
	var payload strictJSONFixture

	if err := DecodeJSON(response, request, &payload, DefaultJSONBodyLimit); err != nil {
		t.Fatalf("DecodeJSON() error = %v", err)
	}
	if payload.Name != "Vimob" {
		t.Fatalf("Name = %q, want Vimob", payload.Name)
	}
	if response.Code != 200 {
		t.Fatalf("status = %d, want 200", response.Code)
	}
}

func TestDecodeJSONRejectsUnknownFieldsAndTrailingValues(t *testing.T) {
	for name, body := range map[string]string{
		"unknown field":  `{"name":"Vimob","admin":true}`,
		"trailing value": `{"name":"Vimob"}{"name":"Outra"}`,
	} {
		t.Run(name, func(t *testing.T) {
			request := httptest.NewRequest("POST", "/", strings.NewReader(body))
			response := httptest.NewRecorder()
			var payload strictJSONFixture

			if err := DecodeJSON(response, request, &payload, DefaultJSONBodyLimit); err == nil {
				t.Fatal("DecodeJSON() error = nil, want invalid JSON error")
			}
			if response.Code != 400 {
				t.Fatalf("status = %d, want 400", response.Code)
			}
			if !strings.Contains(response.Body.String(), `"code":"invalid_json"`) {
				t.Fatalf("response = %s, want invalid_json", response.Body.String())
			}
		})
	}
}

func TestDecodeJSONEnforcesBodyLimit(t *testing.T) {
	request := httptest.NewRequest("POST", "/", strings.NewReader(`{"name":"Vimob"}`))
	response := httptest.NewRecorder()
	var payload strictJSONFixture

	if err := DecodeJSON(response, request, &payload, 8); err == nil {
		t.Fatal("DecodeJSON() error = nil, want body limit error")
	}
	if response.Code != 400 {
		t.Fatalf("status = %d, want 400", response.Code)
	}
}
