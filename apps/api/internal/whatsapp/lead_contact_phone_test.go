package whatsapp

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
)

var errLeadPhoneBoundaryReached = errors.New("synthetic lead phone boundary reached")

type leadPhoneBoundaryTx struct {
	pgx.Tx
	queries int
	phone   string
}

func (tx *leadPhoneBoundaryTx) Begin(context.Context) (pgx.Tx, error) { return tx, nil }
func (tx *leadPhoneBoundaryTx) Rollback(context.Context) error        { return nil }
func (tx *leadPhoneBoundaryTx) QueryRow(_ context.Context, query string, args ...any) pgx.Row {
	tx.queries++
	if strings.Contains(query, "public.upsert_whatsapp_webhook_lead(") {
		tx.phone = args[2].(string)
		return leadPhoneBoundaryRow{err: errLeadPhoneBoundaryReached}
	}
	return leadPhoneBoundaryRow{}
}

type leadPhoneBoundaryRow struct{ err error }

func (row leadPhoneBoundaryRow) Scan(dest ...any) error {
	if row.err != nil {
		return row.err
	}
	*dest[0].(*bool) = true // Synthetic current session owner is active.
	return nil
}

func TestNativeCTWALeadCreationPreservesInternationalPhoneAtRPCBoundary(t *testing.T) {
	for _, test := range []struct {
		name string
		jid  string
		want string
	}{
		{"NANP", "14155552671@s.whatsapp.net", "+14155552671"},
		{"international ten digits", "3312345678@c.us", "+3312345678"},
		{"Portugal", "351912345678@s.whatsapp.net", "+351912345678"},
		{"Brazil unchanged", "5511999999999@s.whatsapp.net", "5511999999999"},
		{"opaque LID", "123456789@lid", ""},
		{"group", "120363123456789@g.us", ""},
	} {
		t.Run(test.name, func(t *testing.T) {
			identity := newWhatsAppContactIdentity("", test.jid, false)
			message := nativeEvolutionMessage{
				ContactPhone: identity.ContactPhone, RemoteJID: identity.RemoteJID,
				IsGroup: identity.IsGroup, IsCTWAAd: true, Content: "Interesse sintético",
				ProviderMessageID:                  "synthetic-contact-intake",
				CampaignEntryPointConversionSource: "ctwa_ad",
			}
			tx := &leadPhoneBoundaryTx{}
			_, err := createAuthorizedNativeLead(context.Background(), tx,
				nativeEvolutionSession{OrganizationID: "synthetic-org", OwnerUserID: "synthetic-owner"},
				message, nativeInboundRule{ManagedMessageDistribution: true})
			if test.want == "" {
				if err != nil || tx.queries != 0 {
					t.Fatalf("non-phone identity reached lead intake: err=%v queries=%d", err, tx.queries)
				}
				return
			}
			if !errors.Is(err, errLeadPhoneBoundaryReached) {
				t.Fatalf("did not reach synthetic RPC boundary: %v", err)
			}
			if tx.phone != test.want {
				t.Fatalf("lead RPC phone = %q, want %q", tx.phone, test.want)
			}
		})
	}
}
