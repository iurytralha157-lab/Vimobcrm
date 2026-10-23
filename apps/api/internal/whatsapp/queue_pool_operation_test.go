package whatsapp

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
)

type poolOperationRow struct {
	access *bool
	err    error
}

func (row poolOperationRow) Scan(dest ...any) error {
	if row.err != nil {
		return row.err
	}
	*dest[0].(**bool) = row.access
	return nil
}

type poolOperationQuery struct {
	row   poolOperationRow
	query string
	args  []any
}

func (query *poolOperationQuery) QueryRow(_ context.Context, sql string, args ...any) pgx.Row {
	query.query, query.args = sql, args
	return query.row
}

func TestWhatsAppQueuePoolHumanOperationRequiresClaim(t *testing.T) {
	allowed, hidden := true, false
	for _, test := range []struct {
		name   string
		access *bool
		want   error
	}{
		{"ordinary or claimed lead", nil, nil},
		{"pool audience including owner administrator", &allowed, ErrQueuePoolClaimRequired},
		{"outside private audience", &hidden, ErrConversationNotFound},
	} {
		t.Run(test.name, func(t *testing.T) {
			query := &poolOperationQuery{row: poolOperationRow{access: test.access}}
			err := requireWhatsAppQueuePoolClaim(context.Background(), query, "organization", "lead", "actor")
			if !errors.Is(err, test.want) {
				t.Fatalf("error=%v want=%v", err, test.want)
			}
			if query.query != `select private.queue_pool_read_access($1::uuid,$2::uuid,$3::uuid)` || len(query.args) != 3 || query.args[0] != "organization" || query.args[1] != "lead" || query.args[2] != "actor" {
				t.Fatalf("pool gate lost tenant/actor identity: %q %v", query.query, query.args)
			}
		})
	}
	queryErr := errors.New("synthetic database failure")
	query := &poolOperationQuery{row: poolOperationRow{err: queryErr}}
	if err := requireWhatsAppQueuePoolClaim(context.Background(), query, "organization", "lead", "actor"); !errors.Is(err, queryErr) {
		t.Fatalf("database failure was allowed: %v", err)
	}
}

func TestWhatsAppQueuePoolErrorContract(t *testing.T) {
	for _, test := range []struct {
		err    error
		status int
		code   string
	}{
		{ErrQueuePoolClaimRequired, http.StatusConflict, "queue_pool_changed"},
		{ErrConversationNotFound, http.StatusNotFound, "whatsapp_conversation_not_found"},
	} {
		recorder := httptest.NewRecorder()
		writeWhatsAppError(recorder, httptest.NewRequest(http.MethodPost, "/v1/whatsapp/conversations/synthetic/attendance", nil), test.err)
		if recorder.Code != test.status || !strings.Contains(recorder.Body.String(), `"code":"`+test.code+`"`) {
			t.Fatalf("error=%v status=%d body=%s", test.err, recorder.Code, recorder.Body.String())
		}
	}
}
