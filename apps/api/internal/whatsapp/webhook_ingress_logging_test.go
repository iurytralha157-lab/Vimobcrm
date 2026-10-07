package whatsapp

import (
	"bytes"
	"errors"
	"log/slog"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/httpserver"
)

func TestEvolutionWebhookIngressFailureLogExcludesSensitiveDatabaseDetail(t *testing.T) {
	var output bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&output, nil))
	request := httptest.NewRequest("POST", "/v1/whatsapp/webhook/evolution-go", nil)
	request = request.WithContext(httpserver.ContextWithRequestID(request.Context(), "req-test-123"))
	err := webhookIngressStage("insert_inbox", &pgconn.PgError{
		Code:    "23505",
		Message: "secret-message-text",
		Detail:  "secret-phone-number",
	})

	logEvolutionWebhookIngressFailure(logger, request, err)
	logged := output.String()
	for _, required := range []string{"req-test-123", "insert_inbox", "23505"} {
		if !strings.Contains(logged, required) {
			t.Fatalf("safe ingress log missing %q: %s", required, logged)
		}
	}
	for _, sensitive := range []string{"secret-message-text", "secret-phone-number"} {
		if strings.Contains(logged, sensitive) {
			t.Fatalf("ingress log exposed %q", sensitive)
		}
	}
	var pgErr *pgconn.PgError
	if !errors.As(err, &pgErr) {
		t.Fatal("stage wrapper must preserve the underlying PostgreSQL error")
	}
}
