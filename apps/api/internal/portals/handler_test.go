package portals

import (
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type unreadTrackingBody struct {
	read bool
}

func (body *unreadTrackingBody) Read([]byte) (int, error) {
	body.read = true
	return 0, io.EOF
}

func (*unreadTrackingBody) Close() error { return nil }

func TestWebhookAuthorizationFailsBeforeReadingBodyOrDatabase(t *testing.T) {
	handler := NewHandler(Repository{webhookSecret: "global-secret"})
	for _, serve := range []func(http.ResponseWriter, *http.Request){
		handler.GrupoOLXLeadWebhook,
		handler.GrupoOLXImportReportWebhook,
	} {
		body := &unreadTrackingBody{}
		request := httptest.NewRequest(http.MethodPost, "/public/token", nil)
		request.Body = body
		response := httptest.NewRecorder()
		serve(response, request)
		if response.Code != http.StatusUnauthorized || body.read {
			t.Fatalf("unauthorized webhook status=%d body_read=%v", response.Code, body.read)
		}
	}

	repo := Repository{webhookSecret: "global-secret"}
	if _, err := repo.ReceiveGrupoOLXImportReport(t.Context(), "token", "", []byte(`{}`)); !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("repository auth-first error = %v", err)
	}
}

func TestImportReportBodyLimitAllowsLargeOfficialReports(t *testing.T) {
	body := strings.Repeat("x", maxGrupoOLXLeadWebhookBody+1)
	request := httptest.NewRequest(http.MethodPost, "/import-reports/token", strings.NewReader(body))
	response := httptest.NewRecorder()
	got, ok := readLimitedBody(response, request, maxGrupoOLXImportReportBody)
	if !ok || len(got) != len(body) || response.Code != http.StatusOK {
		t.Fatalf("large import report body rejected: ok=%v bytes=%d status=%d", ok, len(got), response.Code)
	}
}

func TestImportReportBodyLimitRejectsOversizedReports(t *testing.T) {
	body := strings.Repeat("x", maxGrupoOLXImportReportBody+1)
	request := httptest.NewRequest(http.MethodPost, "/import-reports/token", strings.NewReader(body))
	response := httptest.NewRecorder()
	if _, ok := readLimitedBody(response, request, maxGrupoOLXImportReportBody); ok || response.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversized import report status=%d ok=%v", response.Code, ok)
	}
}
