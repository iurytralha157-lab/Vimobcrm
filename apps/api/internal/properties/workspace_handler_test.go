package properties

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDecodePropertyWorkspaceJSONRejectsUnknownAndConcatenatedValues(t *testing.T) {
	tests := []struct {
		name string
		body string
	}{
		{name: "unknown field", body: `{"label":"Chave","unexpected":true}`},
		{name: "concatenated JSON", body: `{"label":"Chave"}{"label":"Outra"}`},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest("POST", "/v1/properties/example/keys", strings.NewReader(test.body))
			response := httptest.NewRecorder()
			var input CreatePropertyKeyInput
			if err := decodePropertyWorkspaceJSON(response, request, &input); err == nil {
				t.Fatal("expected invalid JSON contract to be rejected")
			}
		})
	}
}

func TestPropertyWorkspaceHandlersDisableSharedCachingAndVaryByIdentity(t *testing.T) {
	handler := Handler{}
	tests := []struct {
		name   string
		method string
		path   string
		handle http.HandlerFunc
	}{
		{name: "workspace", method: http.MethodGet, path: "/v1/properties/example/workspace", handle: handler.ShowWorkspace},
		{name: "history", method: http.MethodGet, path: "/v1/properties/example/history", handle: handler.History},
		{name: "offer", method: http.MethodPut, path: "/v1/properties/example/offers/sale", handle: handler.UpsertOffer},
		{name: "key", method: http.MethodPost, path: "/v1/properties/example/keys", handle: handler.CreateKey},
		{name: "movement", method: http.MethodPost, path: "/v1/properties/example/keys/key/movements", handle: handler.MoveKey},
		{name: "ownership-create", method: http.MethodPost, path: "/v1/properties/example/ownerships", handle: handler.CreateOwnership},
		{name: "ownership-update", method: http.MethodPatch, path: "/v1/properties/example/ownerships/link", handle: handler.UpdateOwnership},
		{name: "ownership-end", method: http.MethodPost, path: "/v1/properties/example/ownerships/link/end", handle: handler.EndOwnership},
		{name: "asset-create", method: http.MethodPost, path: "/v1/properties/example/assets", handle: handler.CreateAsset},
		{name: "asset-upload-intent", method: http.MethodPost, path: "/v1/properties/example/assets/upload-intents", handle: handler.CreateAssetUploadIntent},
		{name: "asset-update", method: http.MethodPatch, path: "/v1/properties/example/assets/asset", handle: handler.UpdateAsset},
		{name: "asset-delete", method: http.MethodDelete, path: "/v1/properties/example/assets/asset", handle: handler.DeleteAsset},
		{name: "asset-order", method: http.MethodPut, path: "/v1/properties/example/assets/order", handle: handler.ReorderAssets},
		{name: "asset-primary", method: http.MethodPut, path: "/v1/properties/example/assets/asset/primary", handle: handler.SetPrimaryAsset},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(test.method, test.path, strings.NewReader(`{}`))
			response := httptest.NewRecorder()
			response.Header().Set("Vary", "Origin")

			test.handle(response, request)

			if got := response.Header().Get("Cache-Control"); got != "private, no-store" {
				t.Fatalf("Cache-Control = %q, want private, no-store", got)
			}
			vary := strings.ToLower(response.Header().Get("Vary"))
			for _, token := range []string{"origin", "authorization", "x-organization-id"} {
				if !strings.Contains(vary, token) {
					t.Fatalf("Vary = %q, missing %s", response.Header().Get("Vary"), token)
				}
			}
		})
	}
}

func TestDecodePropertyWorkspaceJSONRejectsUnknownNestedOwnerField(t *testing.T) {
	request := httptest.NewRequest("PATCH", "/v1/properties/example/ownerships/link", strings.NewReader(`{
		"ownership_percentage":100,
		"is_primary":true,
		"valid_from":"2026-08-01",
		"owner":{
			"name":"Maria",
			"notify_email":false,
			"expected_updated_at":"2026-08-01T12:00:00Z",
			"future_secret":true
		},
		"expected_updated_at":"2026-08-01T12:00:00Z"
	}`))
	response := httptest.NewRecorder()
	var input UpdatePropertyOwnershipInput
	if err := decodePropertyWorkspaceJSON(response, request, &input); err == nil {
		t.Fatal("expected an unknown nested owner field to be rejected")
	}
}

func TestDecodePropertyWorkspaceJSONAcceptsSingleStrictValue(t *testing.T) {
	request := httptest.NewRequest("POST", "/v1/properties/example/keys", strings.NewReader(`{"label":"Chave principal"}`))
	response := httptest.NewRecorder()
	var input CreatePropertyKeyInput
	if err := decodePropertyWorkspaceJSON(response, request, &input); err != nil {
		t.Fatalf("expected valid body, got %v", err)
	}
	if input.Label != "Chave principal" {
		t.Fatalf("unexpected decoded label %q", input.Label)
	}
}

func TestWorkspaceResourceNotFoundErrorsMapTo404(t *testing.T) {
	tests := []struct {
		name string
		err  error
		code string
	}{
		{name: "owner", err: ErrPropertyOwnerNotFound, code: "property_owner_not_found"},
		{name: "ownership", err: ErrPropertyOwnershipNotFound, code: "property_ownership_not_found"},
		{name: "asset", err: ErrPropertyAssetNotFound, code: "property_asset_not_found"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodGet, "/v1/properties/example", nil)
			response := httptest.NewRecorder()
			writePropertyError(response, request, test.err)
			if response.Code != http.StatusNotFound || !strings.Contains(response.Body.String(), test.code) {
				t.Fatalf("response = %d %s", response.Code, response.Body.String())
			}
		})
	}
	if !errors.Is(ErrPropertyAssetNotFound, ErrPropertyAssetNotFound) {
		t.Fatal("sentinel error identity changed")
	}
}
