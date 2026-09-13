package properties

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAttachSignedPropertyCoverURLsUsesCanonicalPrivateAssetWithoutLeakingPath(t *testing.T) {
	storagePath := "orgs/example/properties/property/asset/fachada.jpg"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || !strings.HasSuffix(r.URL.Path, "/object/sign/property-private") {
			http.NotFound(w, r)
			return
		}
		var body struct {
			Paths []string `json:"paths"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if len(body.Paths) != 1 || body.Paths[0] != storagePath {
			t.Fatalf("signed paths = %#v", body.Paths)
		}
		_ = json.NewEncoder(w).Encode([]map[string]string{{
			"path":      storagePath,
			"signedURL": "/object/sign/property-private/fachada.jpg?token=short-lived",
		}})
	}))
	defer server.Close()

	properties := []Property{{
		"id":                        "property",
		"imagem_principal":          "",
		"_asset_cover_storage_path": storagePath,
	}}
	repository := Repository{storage: newStorageClient(StorageConfig{
		ProjectURL: server.URL,
		APIKey:     "service-key",
	})}
	repository.attachSignedPropertyCoverURLs(context.Background(), properties)

	cover := anyString(properties[0]["imagem_principal"])
	if !strings.Contains(cover, "token=short-lived") {
		t.Fatalf("canonical private cover was not signed: %#v", properties[0])
	}
	if _, leaked := properties[0]["_asset_cover_storage_path"]; leaked {
		t.Fatalf("raw private path leaked: %#v", properties[0])
	}
}
