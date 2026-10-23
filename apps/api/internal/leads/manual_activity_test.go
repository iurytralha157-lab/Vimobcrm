package leads

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
)

func TestManualActivitySharedContractVectors(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("testdata", "manual_activity_cases.json"))
	if err != nil {
		t.Fatal(err)
	}
	var corpus struct {
		Version int `json:"version"`
		Cases   []struct {
			Name       string                `json:"name"`
			Input      json.RawMessage       `json:"input"`
			Valid      bool                  `json:"valid"`
			Normalized ActivityCreateRequest `json:"normalized"`
		} `json:"cases"`
	}
	if err := json.Unmarshal(raw, &corpus); err != nil || corpus.Version != 1 || len(corpus.Cases) < 100 {
		t.Fatal("invalid shared manual activity corpus", err)
	}
	for _, item := range corpus.Cases {
		t.Run(item.Name, func(t *testing.T) {
			response := httptest.NewRecorder()
			request, decoded := httpserver.DecodeJSONValue[ActivityCreateRequest](response,
				httptest.NewRequest(http.MethodPost, "/v1/activities", bytes.NewReader(item.Input)), 1<<18)
			if !decoded {
				if item.Valid || response.Code != 400 {
					t.Fatal("valid input was rejected or invalid JSON was not rejected safely")
				}
				return
			}
			input, err := request.Validate()
			if !item.Valid {
				if !errors.Is(err, ErrInvalidInput) {
					t.Fatal("reserved/invalid activity accepted")
				}
				return
			}
			if err != nil {
				t.Fatal("legitimate manual activity rejected", err)
			}
			if _, exists := input.Metadata["origin"]; exists {
				t.Fatal("request validation must not accept incoming provenance")
			}
			// The corpus's normalized value describes the persisted server record.
			input.Metadata["origin"] = manualActivityOrigin
			actual := ActivityCreateRequest{LeadID: input.LeadID, Type: input.Type, Content: input.Content, Metadata: input.Metadata}
			if !reflect.DeepEqual(actual, item.Normalized) {
				t.Fatalf("normalization differs across clients: got=%+v want=%+v", actual, item.Normalized)
			}
		})
	}
}

func TestManualActivityUnicodeLimitsAndInvalidUTF8(t *testing.T) {
	const leadID = "30000000-0000-4000-8000-000000000001"
	for _, field := range []string{"content", "phone", "notes"} {
		limit := 2_000
		if field == "phone" {
			limit = 80
		}
		for _, excess := range []int{0, 1} {
			t.Run(field+strings.Repeat("+", excess), func(t *testing.T) {
				text := "  " + strings.Repeat("🧡", limit+excess) + "  "
				request := ActivityCreateRequest{LeadID: leadID, Type: "call", Metadata: map[string]any{}}
				if field == "content" {
					request.Content = &text
				} else {
					request.Metadata[field] = text
				}
				input, err := request.Validate()
				if excess == 1 {
					if !errors.Is(err, ErrInvalidInput) {
						t.Fatal("oversized Unicode text was silently truncated")
					}
					return
				}
				if err != nil {
					t.Fatal(err)
				}
				var normalized string
				if field == "content" {
					normalized = *input.Content
				} else {
					normalized = input.Metadata[field].(string)
				}
				if len([]rune(normalized)) != limit {
					t.Fatal("Unicode text changed")
				}
			})
		}
	}
	for _, field := range []string{"content", "phone", "notes"} {
		invalid := string([]byte{0xff})
		request := ActivityCreateRequest{LeadID: leadID, Type: "call", Metadata: map[string]any{}}
		if field == "content" {
			request.Content = &invalid
		} else {
			request.Metadata[field] = invalid
		}
		if _, err := request.Validate(); !errors.Is(err, ErrInvalidInput) {
			t.Fatal("invalid UTF8 reached JSONB")
		}
	}
}

func TestManualActivityValidationDetachesMutableInput(t *testing.T) {
	content := " Synthetic call "
	metadata := map[string]any{"phone": " +5522999998888 ", "channel": " phone "}
	request := ActivityCreateRequest{LeadID: "30000000-0000-4000-8000-000000000001", Type: " call_initiated ", Content: &content, Metadata: metadata}
	input, err := request.Validate()
	if err != nil {
		t.Fatal(err)
	}
	content, metadata["phone"], metadata["origin"] = "Mutated", "Foreign phone", "system"
	if *input.Content != "Synthetic call" || input.Metadata["phone"] != "+5522999998888" || input.Metadata["origin"] != nil {
		t.Fatal("request alias changed a validated activity")
	}
}
