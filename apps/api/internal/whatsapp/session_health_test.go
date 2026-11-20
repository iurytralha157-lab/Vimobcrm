package whatsapp

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

func TestSessionHealthRequiresTwoAuthoritativeDisconnects(t *testing.T) {
	connected := map[string]any{"ok": true, "normalizedStatus": "connected"}
	disconnected := map[string]any{"ok": true, "normalizedStatus": "disconnected"}
	unknown := map[string]any{"ok": false, "status": "503"}
	missing := map[string]any{"ok": false, "status": "404"}
	qr := map[string]any{"ok": true, "normalizedStatus": "qr_ready"}
	transportError := errors.New("synthetic provider timeout")
	for _, tc := range []struct {
		name              string
		optIn             bool
		first, second     map[string]any
		secondErr         error
		status            string
		known, notFound   bool
		confirmed, waited bool
	}{
		{name: "default one observation", first: disconnected, status: "disconnected", known: true},
		{name: "connected", optIn: true, first: connected, status: "connected", known: true},
		{name: "confirmed", optIn: true, first: disconnected, second: disconnected, status: "disconnected", known: true, confirmed: true, waited: true},
		{name: "recovers before notice", optIn: true, first: disconnected, second: connected, status: "connected", known: true, waited: true},
		{name: "qr not a confirmed disconnect", optIn: true, first: disconnected, second: qr, status: "qr_ready", known: true, waited: true},
		{name: "unknown on either request", optIn: true, first: disconnected, second: unknown, waited: true},
		{name: "inconclusive first request", optIn: true, first: unknown},
		{name: "missing instance not confirmed", optIn: true, first: missing, status: "disconnected", known: true, notFound: true},
		{name: "instance disappears on recheck", optIn: true, first: disconnected, second: missing, status: "disconnected", known: true, notFound: true, waited: true},
		{name: "transport fails on recheck", optIn: true, first: disconnected, secondErr: transportError, waited: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			requests, waits := 0, 0
			observation, err := observeSessionStatus(context.Background(), tc.optIn, func(context.Context) (map[string]any, error) {
				requests++
				if requests == 1 {
					return tc.first, nil
				}
				if requests == 2 && waits == 1 {
					return tc.second, tc.secondErr
				}
				t.Fatalf("unexpected probe %d after %d waits", requests, waits)
				return nil, nil
			}, func(context.Context) error {
				waits++
				return nil
			})
			if !errors.Is(err, tc.secondErr) || observation.status != tc.status || observation.authoritative != tc.known ||
				observation.missing != tc.notFound || observation.confirmedLoss != tc.confirmed ||
				(requests == 2) != tc.waited || (waits == 1) != tc.waited {
				t.Fatalf("observation=%+v err=%v probes=%d waits=%d", observation, err, requests, waits)
			}
		})
	}
}

func TestSessionHealthCancelsBeforeSecondProbe(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	probes := 0
	observed, err := observeSessionStatus(ctx, true, func(context.Context) (map[string]any, error) {
		probes++
		return map[string]any{"ok": true, "normalizedStatus": "disconnected"}, nil
	}, func(context.Context) error {
		cancel()
		return nil
	})
	if !errors.Is(err, context.Canceled) || probes != 1 || observed.confirmedLoss {
		t.Fatalf("observation=%+v err=%v probes=%d", observed, err, probes)
	}
}

func TestSessionHealthScopePreservesUserLogout(t *testing.T) {
	base := Session{Status: "connected", Provider: "evolution_go", IsActive: true}
	if !sessionHealthConfirmationEligible(base) || (Repository{}).sessionHealthNotificationWriter != nil {
		t.Fatal("eligible supervisor session must still require opt-in")
	}
	for _, different := range []Session{
		{Status: "disconnected", Provider: "evolution_go", IsActive: true},
		{Status: "deleted", Provider: "evolution_go", IsActive: true},
		{Status: "connected", Provider: "evolution", IsActive: true},
		{Status: "connected", Provider: "evolution_go", IsActive: false},
		{Status: "connected", Provider: "evolution_go", IsActive: true, AdvancedSettings: map[string]any{"auto_reconnect_enabled": false}},
		{Status: "connecting", Provider: "evolution_go", IsActive: true, AdvancedSettings: map[string]any{"auto_reconnect_blocked_reason": "user_logged_out"}},
	} {
		if sessionHealthConfirmationEligible(different) {
			t.Fatalf("session with status %s and provider %s crossed the health scope", different.Status, different.Provider)
		}
	}
}

type sessionHealthTestRows struct {
	pgx.Rows
	ids []string
}

func (rows *sessionHealthTestRows) Next() bool { return len(rows.ids) > 0 }
func (*sessionHealthTestRows) Close()          {}
func (*sessionHealthTestRows) Err() error      { return nil }
func (rows *sessionHealthTestRows) Scan(values ...any) error {
	*values[0].(*string) = rows.ids[0]
	rows.ids = rows.ids[1:]
	return nil
}

type sessionHealthTestTx struct {
	pgx.Tx
	t          *testing.T
	recipients []string
	audit      map[string]any
}

func (tx *sessionHealthTestTx) Query(_ context.Context, sql string, args ...any) (pgx.Rows, error) {
	tx.t.Helper()
	for _, filter := range []string{
		"account.organization_id = $1::uuid",
		"account.is_active is true",
		"membership.user_id = account.id",
		"membership.organization_id = account.organization_id",
		"membership.is_active is true",
		"membership.deleted_at is null",
		"account.id = $2::uuid or account.role = 'admin'",
		"for share of account, membership",
	} {
		if !strings.Contains(sql, filter) {
			tx.t.Fatalf("recipient query missing %q", filter)
		}
	}
	if !reflect.DeepEqual(args, []any{"synthetic-org", "synthetic-owner"}) {
		tx.t.Fatalf("recipient scope = %v", args)
	}
	return &sessionHealthTestRows{ids: tx.recipients}, nil
}

func (tx *sessionHealthTestTx) Exec(_ context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	tx.t.Helper()
	if !strings.Contains(sql, "'whatsapp.session_disconnected'") || args[0] != "synthetic-org" || args[1] != "synthetic-session" {
		tx.t.Fatal("session audit escaped the confirmed scope")
	}
	if err := json.Unmarshal([]byte(args[2].(string)), &tx.audit); err != nil {
		tx.t.Fatal(err)
	}
	return pgconn.NewCommandTag("INSERT 0 1"), nil
}

func TestSessionHealthUsesOneNoticePerScopedRecipientAndOneAudit(t *testing.T) {
	ctx := context.Background()
	session := Session{
		ID: "synthetic-session", OrganizationID: "synthetic-org", OwnerUserID: "synthetic-owner",
		InstanceName: "Sessão de teste", Status: "connected",
		UpdatedAt:        time.Date(2026, time.November, 20, 15, 24, 1, 420000000, time.UTC),
		AdvancedSettings: map[string]any{"token": "synthetic-secret"},
	}
	tx := &sessionHealthTestTx{t: t, recipients: []string{"synthetic-owner", "synthetic-admin"}}
	events := map[string]string{}
	writer := func(_ context.Context, actualTx pgx.Tx, organizationID, userID, eventKey, dedupeKey string, variables map[string]any) error {
		if actualTx != tx || organizationID != session.OrganizationID || events[userID] != "" {
			t.Fatalf("invalid or duplicate callback scope for %s", userID)
		}
		events[userID] = eventKey
		episode := "2026-11-20T15:24:01.42+00:00"
		if dedupeKey != "whatsapp_disconnected:synthetic-session:"+userID+":"+episode ||
			!reflect.DeepEqual(variables, map[string]any{"nome_sessao": session.InstanceName, "session_name": session.InstanceName, "disconnect_episode": episode}) {
			t.Fatal("notification contents do not preserve the scoped episode")
		}
		return nil
	}
	if err := (Repository{}).WithSessionHealthNotifications(writer).recordConfirmedSessionDisconnect(ctx, tx, session); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(events, map[string]string{"synthetic-owner": "whatsapp_disconnected", "synthetic-admin": "whatsapp_disconnected_admin"}) {
		t.Fatalf("recipient event keys = %v", events)
	}
	expectedAudit := map[string]any{"previous_status": "connected", "new_status": "disconnected",
		"first_check": map[string]any{"connected": false}, "second_check": map[string]any{"connected": false}}
	if !reflect.DeepEqual(tx.audit, expectedAudit) {
		t.Fatalf("unexpected health audit: %v", tx.audit)
	}
	tx.audit = nil
	failure := errors.New("synthetic notification enqueue failure")
	failingRepo := (Repository{}).WithSessionHealthNotifications(func(context.Context, pgx.Tx, string, string, string, string, map[string]any) error {
		return failure
	})
	if err := failingRepo.recordConfirmedSessionDisconnect(ctx, tx, session); !errors.Is(err, failure) || tx.audit != nil {
		t.Fatalf("failed enqueue must stop the shared transaction before audit: err=%v audit=%v", err, tx.audit)
	}
}

func TestSessionHealthWritesEffectsInsideFencedStatusTransaction(t *testing.T) {
	source := readWhatsAppSourceFunction(t, "session_supervisor.go", "func (repo Repository) updateSessionStatusFromProviderIfCurrent")
	fence := strings.Index(source, "for update")
	activeClaim := strings.Index(source, "if stateCommand.RowsAffected() != 1")
	effects := strings.Index(source, "repo.recordConfirmedSessionDisconnect(ctx, tx, session)")
	commit := strings.LastIndex(source, "tx.Commit(ctx)")
	if fence < 0 || activeClaim <= fence || effects <= activeClaim || commit <= effects || !strings.Contains(source, "tx.Rollback(ctx)") {
		t.Fatal("confirmed health loss must fence the current session and commit the shared effects atomically")
	}
	for _, check := range []string{"confirmedHealthLoss", "owner_user_id::text = $11::text", "instance_id::text is not distinct from $14::text", "'user_logged_out'"} {
		if !strings.Contains(source, check) {
			t.Fatalf("confirmed health transaction missing %q", check)
		}
	}
}
