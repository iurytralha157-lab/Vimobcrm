package teams

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/textproto"
	"strings"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestUpdateStatusRequiresExplicitBoolean(t *testing.T) {
	tests := []struct {
		name     string
		body     string
		wantCode string
	}{
		{name: "missing property", body: `{}`, wantCode: "invalid_team_input"},
		{name: "null property", body: `{"is_active":null}`, wantCode: "invalid_team_input"},
		{name: "null body", body: `null`, wantCode: "invalid_team_input"},
		{name: "non boolean property", body: `{"is_active":"false"}`, wantCode: "invalid_json"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			request := httptest.NewRequest(
				http.MethodPatch,
				"/v1/teams/11111111-1111-4111-8111-111111111111/status",
				strings.NewReader(test.body),
			)
			request.SetPathValue("id", "11111111-1111-4111-8111-111111111111")
			request = request.WithContext(tenant.ContextWithTenant(context.Background(), tenant.Context{
				OrganizationID: "22222222-2222-4222-8222-222222222222",
				UserID:         "33333333-3333-4333-8333-333333333333",
				MemberRole:     "admin",
			}))
			response := httptest.NewRecorder()

			NewHandler(Repository{}).UpdateStatus(response, request)

			if response.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want %d; body = %s", response.Code, http.StatusBadRequest, response.Body.String())
			}
			var payload struct {
				Error struct {
					Code string `json:"code"`
				} `json:"error"`
			}
			if err := json.Unmarshal(response.Body.Bytes(), &payload); err != nil {
				t.Fatalf("decode response: %v", err)
			}
			if payload.Error.Code != test.wantCode {
				t.Fatalf("error code = %q, want %s", payload.Error.Code, test.wantCode)
			}
		})
	}
}

func TestUpdateTeamStatusRequestPreservesExplicitBoolean(t *testing.T) {
	for _, expected := range []bool{false, true} {
		body := []byte(`{"is_active":false}`)
		if expected {
			body = []byte(`{"is_active":true}`)
		}
		var request UpdateTeamStatusRequest
		if err := json.Unmarshal(body, &request); err != nil {
			t.Fatalf("decode is_active=%t: %v", expected, err)
		}
		if request.IsActive == nil {
			t.Fatalf("is_active=%t decoded as absent", expected)
		}
		if *request.IsActive != expected {
			t.Fatalf("is_active = %t, want %t", *request.IsActive, expected)
		}
	}
}

func TestDecodeJSONRejectsTrailingPayload(t *testing.T) {
	request := httptest.NewRequest(http.MethodPatch, "/v1/teams/id", strings.NewReader(`{"name":"Equipe"} {"name":"Outra"}`))
	response := httptest.NewRecorder()
	var payload UpdateTeamRequest

	if err := httpserver.DecodeJSON(response, request, &payload, 1<<20); err == nil {
		t.Fatal("multiple JSON values must be rejected")
	}
	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", response.Code, http.StatusBadRequest)
	}
}

func TestParseLogoUploadUsesDetectedImageContent(t *testing.T) {
	tests := []struct {
		name     string
		contents []byte
		wantType string
	}{
		{name: "jpeg", contents: []byte("\xff\xd8\xff\xe0\x00\x10JFIF\x00"), wantType: "image/jpeg"},
		{name: "png", contents: []byte("\x89PNG\r\n\x1a\n"), wantType: "image/png"},
		{name: "webp", contents: []byte("RIFF\x00\x00\x00\x00WEBPVP8 "), wantType: "image/webp"},
		{name: "gif", contents: []byte("GIF89a\x01\x00\x01\x00"), wantType: "image/gif"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			response, request := logoUploadRequest(t, test.contents, "application/octet-stream")
			contentType, size, _, body, cleanup, err := parseLogoUpload(response, request)
			if cleanup != nil {
				defer cleanup()
			}
			if err != nil {
				t.Fatalf("parse logo upload: %v", err)
			}
			if contentType != test.wantType {
				t.Fatalf("content type = %q, want %q", contentType, test.wantType)
			}
			if size != int64(len(test.contents)) {
				t.Fatalf("size = %d, want %d", size, len(test.contents))
			}
			gotContents, err := io.ReadAll(body)
			if err != nil {
				t.Fatalf("read parsed body: %v", err)
			}
			if !bytes.Equal(gotContents, test.contents) {
				t.Fatalf("parsed body = %x, want %x", gotContents, test.contents)
			}
		})
	}
}

func TestParseLogoUploadRejectsSpoofedOrSVGContent(t *testing.T) {
	tests := []struct {
		name     string
		contents []byte
		declared string
	}{
		{
			name:     "plain text declared as png",
			contents: []byte("this is not an image"),
			declared: "image/png",
		},
		{
			name:     "svg declared as svg",
			contents: []byte(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`),
			declared: "image/svg+xml",
		},
		{
			name:     "svg declared as png",
			contents: []byte(`<svg xmlns="http://www.w3.org/2000/svg"></svg>`),
			declared: "image/png",
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			response, request := logoUploadRequest(t, test.contents, test.declared)
			_, _, _, _, cleanup, err := parseLogoUpload(response, request)
			if cleanup != nil {
				defer cleanup()
			}
			if !errors.Is(err, ErrInvalidInput) {
				t.Fatalf("error = %v, want ErrInvalidInput", err)
			}
		})
	}
}

func TestParseLogoUploadPrefersDetectedContentOverDeclaredMIME(t *testing.T) {
	contents := []byte("\x89PNG\r\n\x1a\n")
	response, request := logoUploadRequest(t, contents, "image/svg+xml")
	contentType, _, _, _, cleanup, err := parseLogoUpload(response, request)
	if cleanup != nil {
		defer cleanup()
	}
	if err != nil {
		t.Fatalf("parse logo upload: %v", err)
	}
	if contentType != "image/png" {
		t.Fatalf("content type = %q, want image/png", contentType)
	}
}

func logoUploadRequest(t *testing.T, contents []byte, declaredContentType string) (*httptest.ResponseRecorder, *http.Request) {
	t.Helper()

	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	header := make(textproto.MIMEHeader)
	header.Set("Content-Disposition", `form-data; name="file"; filename="logo.bin"`)
	header.Set("Content-Type", declaredContentType)
	part, err := writer.CreatePart(header)
	if err != nil {
		t.Fatalf("create multipart file: %v", err)
	}
	if _, err := part.Write(contents); err != nil {
		t.Fatalf("write multipart file: %v", err)
	}
	if err := writer.Close(); err != nil {
		t.Fatalf("close multipart writer: %v", err)
	}

	request := httptest.NewRequest(http.MethodPost, "/v1/teams/logo", &body)
	request.Header.Set("Content-Type", writer.FormDataContentType())
	return httptest.NewRecorder(), request
}
