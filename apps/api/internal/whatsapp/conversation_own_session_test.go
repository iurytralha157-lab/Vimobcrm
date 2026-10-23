package whatsapp

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestStartConversationOwnSessionFlagSurvivesRequestDecoding(t *testing.T) {
	var request StartConversationRequest
	if err := json.Unmarshal([]byte(`{"phone":"5511999990001","sessionId":"00000000-0000-4000-8000-000000000010","expectedPreviousLeadId":"unlinked","ownSessionOnly":true}`), &request); err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(request)
	if err != nil {
		t.Fatal(err)
	}
	var fields map[string]any
	if err := json.Unmarshal(encoded, &fields); err != nil {
		t.Fatal(err)
	}
	if fields["ownSessionOnly"] != true {
		t.Fatalf("personal start request dropped its server ownership contract: %s", encoded)
	}
}

func TestLinkConversationOwnSessionFlagSurvivesRequestDecoding(t *testing.T) {
	var request LinkLeadRequest
	if err := json.Unmarshal([]byte(`{"leadId":"00000000-0000-4000-8000-000000000010","expectedPreviousLeadId":"unlinked","ownSessionOnly":true}`), &request); err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(request)
	var fields map[string]any
	if err := json.Unmarshal(encoded, &fields); err != nil {
		t.Fatal(err)
	}
	if fields["ownSessionOnly"] != true {
		t.Fatalf("link consent dropped its personal-session scope: %s", encoded)
	}
}

func TestOwnSessionStartRejectsSharedAndPreservesGeneralDefault(t *testing.T) {
	if err := validateStartSessionOwnership(true, "owner", "assigned-broker"); !errors.Is(err, ErrSessionNotFound) {
		t.Fatalf("personal start accepted a shared number: %v", err)
	}
	if err := validateStartSessionOwnership(false, "owner", "assigned-broker"); err != nil {
		t.Fatalf("normal shared start was restricted: %v", err)
	}
	if err := validateStartSessionOwnership(true, "owner", "owner"); err != nil {
		t.Fatal(err)
	}
	if err := validateStartSessionOwnership(true, "", ""); !errors.Is(err, ErrSessionNotFound) {
		t.Fatal("unresolved identities became an owned session")
	}
	var request StartConversationRequest
	if err := json.Unmarshal([]byte(`{"phone":"5511999990001"}`), &request); err != nil {
		t.Fatal(err)
	}
	if request.OwnSessionOnly {
		t.Fatal("default contract changed existing shared callers")
	}
}

type ownSessionStartRow struct {
	owner string
	err   error
}

func (row ownSessionStartRow) Scan(dest ...any) error {
	if row.err != nil {
		return row.err
	}
	*dest[0].(*string) = row.owner
	return nil
}

type ownSessionStartQuery struct {
	row   ownSessionStartRow
	calls int
	query string
	args  []any
}

func (query *ownSessionStartQuery) QueryRow(_ context.Context, sql string, args ...any) pgx.Row {
	query.calls++
	query.query = sql
	query.args = args
	return query.row
}

func TestOwnSessionLinkUsesTrustedOrgConversationAndActor(t *testing.T) {
	const sessionID = "00000000-0000-4000-8000-000000000010"
	actor := tenant.Context{OrganizationID: "org", UserID: "actor"}
	query := &ownSessionStartQuery{row: ownSessionStartRow{owner: sessionID}}
	actual, err := resolveOwnedConversationLinkSession(context.Background(), query, actor, "conversation")
	if err != nil || actual != sessionID {
		t.Fatalf("owned link session: %q %v", actual, err)
	}
	if len(query.args) != 3 || query.args[0] != actor.OrganizationID || query.args[1] != "conversation" || query.args[2] != actor.UserID {
		t.Fatalf("link trusted identity arguments: %#v", query.args)
	}
	for _, required := range []string{"wc.organization_id=$1::uuid", "wc.id=$2::uuid", "ws.owner_user_id=$3::uuid"} {
		if !strings.Contains(query.query, required) {
			t.Fatalf("owned link lacks identity fence %s", required)
		}
	}
	for _, row := range []ownSessionStartRow{{err: pgx.ErrNoRows}, {owner: "not-a-session-uuid"}} {
		if _, err := resolveOwnedConversationLinkSession(context.Background(), &ownSessionStartQuery{row: row}, actor, "conversation"); !errors.Is(err, ErrSessionNotFound) {
			t.Fatalf("missing/shared/malformed link route accepted: %v", err)
		}
	}
	var request LinkLeadRequest
	if err := json.Unmarshal([]byte(`{"leadId":"00000000-0000-4000-8000-000000000010","expectedPreviousLeadId":"unlinked"}`), &request); err != nil || request.OwnSessionOnly {
		t.Fatal("default link contract changed")
	}
}

func TestOwnSessionStartRevalidatesCurrentLockedOwner(t *testing.T) {
	actor := tenant.Context{OrganizationID: "org", UserID: "original-owner"}
	for _, check := range []struct {
		owner   string
		err     error
		allowed bool
	}{
		{owner: "original-owner", allowed: true}, {owner: "new-owner"}, {err: pgx.ErrNoRows},
	} {
		query := &ownSessionStartQuery{row: ownSessionStartRow{owner: check.owner, err: check.err}}
		err := revalidateOwnStartSession(context.Background(), query, actor, "session", true)
		if check.allowed && err != nil || !check.allowed && !errors.Is(err, ErrSessionNotFound) {
			t.Fatalf("current session owner fence: %+v err=%v", check, err)
		}
		if query.calls != 1 {
			t.Fatalf("ownership was not reread under the caller's lock: %d", query.calls)
		}
	}
	query := &ownSessionStartQuery{row: ownSessionStartRow{err: errors.New("must not read for default start")}}
	if err := revalidateOwnStartSession(context.Background(), query, actor, "session", false); err != nil || query.calls != 0 {
		t.Fatalf("default shared start gained ownership I/O: calls=%d err=%v", query.calls, err)
	}
}
