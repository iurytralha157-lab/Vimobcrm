package meta

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

func TestLeadDetailsFetchesGraphWhenWebhookFieldsHaveNoAnswers(t *testing.T) {
	tests := map[string]map[string]any{
		"missing":         {},
		"null":            {"field_data": nil},
		"empty array":     {"field_data": []any{}},
		"malformed value": {"field_data": "not an array"},
		"empty answers": {"field_data": []any{
			map[string]any{"name": "full_name", "values": []any{"  "}},
		}},
		"nested null":        {"lead_data": map[string]any{"field_data": nil}},
		"nested empty array": {"lead_data": map[string]any{"field_data": []any{}}},
	}

	for name, raw := range tests {
		t.Run(name, func(t *testing.T) {
			var requests atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
				requests.Add(1)
				if request.URL.Path != "/v25.0/lead-123" {
					t.Errorf("Graph path = %q", request.URL.Path)
				}
				writer.Header().Set("Content-Type", "application/json")
				_, _ = writer.Write([]byte(`{"id":"lead-123","field_data":[{"name":"full_name","values":["Maria Silva"]},{"name":"phone_number","values":["+5511999999999"]}]}`))
			}))
			defer server.Close()

			repo := NewRepository(nil, Config{GraphBaseURL: server.URL, GraphVersion: "v25.0"})
			token := "synthetic-page-token"
			change := leadgenChange{LeadgenID: "lead-123", Raw: raw}
			integration := metaIntegration{AccessToken: &token}
			details, err := repo.leadDetails(context.Background(), change, integration)
			if err != nil {
				t.Fatalf("leadDetails() error = %v", err)
			}
			if got := requests.Load(); got != 1 {
				t.Fatalf("Graph requests = %d, want 1", got)
			}
			lead := mapLeadData(details, change, integration, metaFormConfig{})
			if lead.Name != "Maria Silva" || lead.Phone == nil || *lead.Phone != "+5511999999999" {
				t.Fatalf("Graph identity was not mapped: name = %q, phone = %#v", lead.Name, lead.Phone)
			}
			if got := classifyMetaLeadIntake(details, raw, lead); got != metaLeadIntakeReady {
				t.Fatalf("intake disposition = %v, want ready", got)
			}
		})
	}
}

func TestLeadDetailsPreservesWebhookAnswersAndDummyClassification(t *testing.T) {
	tests := []struct {
		name  string
		value string
		want  metaLeadIntakeDisposition
	}{
		{name: "real provider answer", value: "Maria Silva", want: metaLeadIntakeReady},
		{name: "Meta dummy answer", value: "<test lead: dummy data for full_name>", want: metaLeadIntakeIgnoreTest},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			for _, nested := range []bool{false, true} {
				raw := map[string]any{"field_data": []any{
					map[string]any{"name": "full_name", "values": []any{test.value}},
				}}
				if nested {
					raw = map[string]any{"lead_data": raw}
				}
				change := leadgenChange{LeadgenID: "lead-123", Raw: raw}
				// No token: an unnecessary Graph lookup would fail this test.
				repo := NewRepository(nil, Config{})
				details, err := repo.leadDetails(context.Background(), change, metaIntegration{})
				if err != nil {
					t.Fatalf("leadDetails(nested=%t) error = %v", nested, err)
				}
				lead := mapLeadData(details, change, metaIntegration{}, metaFormConfig{})
				if got := classifyMetaLeadIntake(details, raw, lead); got != test.want {
					t.Fatalf("intake disposition (nested=%t) = %v, want %v", nested, got, test.want)
				}
			}
		})
	}
}
