package whatsapp

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
)

type unlinkedEpochTestRow struct {
	raw string
	err error
}

func (row unlinkedEpochTestRow) Scan(dest ...any) error {
	if row.err != nil {
		return row.err
	}
	*dest[0].(*string) = row.raw
	return nil
}

type unlinkedEpochTestQueryer struct {
	row   unlinkedEpochTestRow
	query string
	args  []any
}

func (queryer *unlinkedEpochTestQueryer) QueryRow(_ context.Context, query string, args ...any) pgx.Row {
	queryer.query = query
	queryer.args = args
	return queryer.row
}

func TestRetireUnlinkedConversationEpochFailsClosed(t *testing.T) {
	const organizationID = "11111111-1111-4111-8111-111111111111"
	const sessionID = "22222222-2222-4222-8222-222222222222"
	const expectedID = "33333333-3333-4333-8333-333333333333"
	const remoteJID = "5511999991111@s.whatsapp.net"
	for _, test := range []struct {
		name    string
		row     unlinkedEpochTestRow
		wantErr bool
	}{
		{"expired", unlinkedEpochTestRow{raw: `{"retired":true,"conversation_id":"` + expectedID + `","reason":"expired"}`}, false},
		{"already retired", unlinkedEpochTestRow{raw: `{"retired":true,"conversation_id":"` + expectedID + `","reason":"already_retired"}`}, false},
		{"cutover required", unlinkedEpochTestRow{raw: `{"retired":false,"conversation_id":"` + expectedID + `","reason":"cutover_required"}`}, true},
		{"different route", unlinkedEpochTestRow{raw: `{"retired":true,"conversation_id":"44444444-4444-4444-8444-444444444444","reason":"expired"}`}, true},
		{"malformed outcome", unlinkedEpochTestRow{raw: `{"retired":`}, true},
		{"database error", unlinkedEpochTestRow{err: errors.New("db unavailable")}, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			queryer := &unlinkedEpochTestQueryer{row: test.row}
			err := retireWhatsAppUnlinkedConversationEpoch(
				context.Background(), queryer, organizationID, sessionID, expectedID, remoteJID,
			)
			if (err != nil) != test.wantErr {
				t.Fatalf("retire epoch error = %v, want error %v", err, test.wantErr)
			}
			if len(queryer.args) != 4 || queryer.args[0] != organizationID || queryer.args[1] != sessionID ||
				queryer.args[2] != expectedID || queryer.args[3] != remoteJID {
				t.Fatalf("retire epoch CAS arguments = %#v", queryer.args)
			}
			if !strings.Contains(queryer.query, "p_expected_conversation_id") ||
				!strings.Contains(queryer.query, "p_remote_jid") {
				t.Fatalf("retire epoch lacks immutable route comparison: %s", queryer.query)
			}
		})
	}
}
