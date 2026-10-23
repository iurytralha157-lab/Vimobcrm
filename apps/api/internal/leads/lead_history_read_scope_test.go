package leads

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type historyScopeFixture struct {
	org, owner, lead                      string
	options                               pgx.TxOptions
	beginErr, authorizationErr, commitErr error
	transferredAfterAuthorization         bool
	reads, commits, rollbacks             int
	tx                                    *historyScopeTx
}

type historyScopeTx struct {
	pgx.Tx
	fixture *historyScopeFixture
	owner   string
}

type historyScopeRow struct{ scan func(...any) error }

func (row historyScopeRow) Scan(dest ...any) error { return row.scan(dest...) }

func (fixture *historyScopeFixture) BeginTx(_ context.Context, options pgx.TxOptions) (pgx.Tx, error) {
	fixture.options = options
	if fixture.beginErr != nil {
		return nil, fixture.beginErr
	}
	fixture.tx = &historyScopeTx{fixture: fixture, owner: fixture.owner}
	return fixture.tx, nil
}

func (tx *historyScopeTx) QueryRow(_ context.Context, query string, args ...any) pgx.Row {
	return historyScopeRow{scan: func(dest ...any) error {
		if strings.Contains(query, "select l.id::text from public.leads") {
			if tx.fixture.authorizationErr != nil {
				return tx.fixture.authorizationErr
			}
			if args[0] != tx.fixture.org || args[4] != tx.fixture.lead || args[2] != tx.owner {
				return pgx.ErrNoRows
			}
			*dest[0].(*string) = tx.fixture.lead
			if tx.fixture.transferredAfterAuthorization {
				tx.fixture.owner = "55555555-5555-4555-8555-555555555555"
			}
			return nil
		}
		tx.fixture.reads++
		if query == "select clock_timestamp()" {
			*dest[0].(*time.Time) = historyPageTestCursor().SnapshotAt
			return nil
		}
		if args[0] != tx.fixture.org || args[1] != tx.fixture.lead {
			return errors.New("payload crossed organization or lead")
		}
		if tx.fixture.options.IsoLevel != pgx.RepeatableRead || tx.fixture.options.AccessMode != pgx.ReadOnly {
			return errors.New("authorization and payload do not share a read-only snapshot")
		}
		data := leadHistoryPageResult{Lead: map[string]any{"id": tx.fixture.lead, "assigned_user_id": tx.owner}}
		raw, err := json.Marshal(data)
		*dest[0].(*[]byte) = raw
		return err
	}}
}

func (tx *historyScopeTx) Commit(context.Context) error {
	tx.fixture.commits++
	return tx.fixture.commitErr
}

func (tx *historyScopeTx) Rollback(context.Context) error {
	tx.fixture.rollbacks++
	return nil
}

func newHistoryScopeFixture() (*historyScopeFixture, tenant.Context) {
	actor := tenant.Context{OrganizationID: historyPageTestOrg, UserID: historyPageTestOtherOrg, Permissions: []string{permissions.LeadViewOwn}}
	return &historyScopeFixture{org: actor.OrganizationID, owner: actor.UserID, lead: historyPageTestLead}, actor
}

func TestLeadHistoryReadScopeRejectsDeniedActorAndForeignOrganizationBeforePayload(t *testing.T) {
	for _, scenario := range []string{"foreign organization", "transferred lead", "authorization query error"} {
		t.Run(scenario, func(t *testing.T) {
			fixture, actor := newHistoryScopeFixture()
			want := ErrLeadNotFound
			switch scenario {
			case "foreign organization":
				actor.OrganizationID = historyPageTestOtherOrg
			case "transferred lead":
				fixture.owner = historyPageTestOrg
			case "authorization query error":
				fixture.authorizationErr = errors.New("synthetic authorization failure")
				want = fixture.authorizationErr
			}
			result, err := readLeadHistorySnapshot(context.Background(), fixture, actor, fixture.lead, func(tx pgx.Tx) (LeadHistoryPageResponse, error) {
				return readLeadHistoryPageInSnapshot(context.Background(), tx, actor.OrganizationID, fixture.lead, LeadHistoryPageFilter{PageSize: 100})
			})
			if !errors.Is(err, want) || result.Data != nil || fixture.reads != 0 || fixture.commits != 0 || fixture.rollbacks != 1 {
				t.Fatalf("denial hydrated a payload or committed: result=%v err=%v fixture=%+v", result, err, fixture)
			}
		})
	}
}

func TestLeadHistoryReadScopePageUsesAuthorizationSnapshotDuringTransfer(t *testing.T) {
	fixture, actor := newHistoryScopeFixture()
	fixture.transferredAfterAuthorization = true
	response, err := readLeadHistorySnapshot(context.Background(), fixture, actor, fixture.lead, func(tx pgx.Tx) (LeadHistoryPageResponse, error) {
		return readLeadHistoryPageInSnapshot(context.Background(), tx, actor.OrganizationID, fixture.lead, LeadHistoryPageFilter{PageSize: 100})
	})
	if err != nil || fixture.options.IsoLevel != pgx.RepeatableRead || fixture.options.AccessMode != pgx.ReadOnly || fixture.commits != 1 {
		t.Fatalf("history did not use one read snapshot: %v %+v", err, fixture)
	}
	if response.Data["lead"].(map[string]any)["assigned_user_id"] != actor.UserID || fixture.owner == actor.UserID {
		t.Fatal("payload was hydrated from the live post-transfer state")
	}
	// A new page starts a fresh snapshot and must deny the former owner.
	_, err = readLeadHistorySnapshot(context.Background(), fixture, actor, fixture.lead, func(pgx.Tx) (string, error) {
		t.Fatal("former owner reached the next page payload")
		return "", nil
	})
	if !errors.Is(err, ErrLeadNotFound) {
		t.Fatalf("next page reused stale authorization: %v", err)
	}
}

func TestLeadHistoryReadScopeNeverReturnsPayloadOnReadOrCommitFailure(t *testing.T) {
	for _, scenario := range []string{"begin", "read", "commit"} {
		t.Run(scenario, func(t *testing.T) {
			fixture, actor := newHistoryScopeFixture()
			failure := errors.New("synthetic " + scenario + " failure")
			if scenario == "begin" {
				fixture.beginErr = failure
			}
			if scenario == "commit" {
				fixture.commitErr = failure
			}
			result, err := readLeadHistorySnapshot(context.Background(), fixture, actor, fixture.lead, func(pgx.Tx) (string, error) {
				if scenario == "read" {
					return "private payload", failure
				}
				return "private payload", nil
			})
			if !errors.Is(err, failure) || result != "" || (scenario != "begin" && fixture.rollbacks != 1) {
				t.Fatalf("failed read exposed payload: %q %v %+v", result, err, fixture)
			}
		})
	}
}

type historyScopeBatch struct {
	rows  [][]byte
	index int
}

func (batch *historyScopeBatch) QueryRow() pgx.Row {
	row := historyJSONRow{raw: batch.rows[batch.index]}
	batch.index++
	return row
}
func (*historyScopeBatch) Exec() (pgconn.CommandTag, error) { return pgconn.CommandTag{}, nil }
func (*historyScopeBatch) Query() (pgx.Rows, error)         { return nil, errors.New("unexpected rows query") }
func (*historyScopeBatch) Close() error                     { return nil }

func (tx *historyScopeTx) SendBatch(_ context.Context, batch *pgx.Batch) pgx.BatchResults {
	tx.fixture.reads++
	if len(batch.QueuedQueries) != 10 {
		panic("legacy history must include the authorized private queue event projection")
	}
	for _, item := range batch.QueuedQueries {
		if item.Arguments[0] != tx.fixture.org || item.Arguments[1] != tx.fixture.lead {
			panic("legacy history crossed tenant or lead")
		}
	}
	return &historyScopeBatch{rows: [][]byte{
		[]byte(`[{"metadata":{"file_url":"https://private.invalid/legacy","file_name":"documento.pdf"}}]`),
		[]byte(`[{"metadata":{"attachment_id":"reference","fileURL":"https://private.invalid/activity"}}]`),
		[]byte(`[{"payload":{"nested":{"file_url":"https://private.invalid/entry"}}}]`),
		[]byte(`{"id":"` + tx.fixture.lead + `"}`),
		[]byte(`{"creative_url":"https://public.invalid/creative","nested":{"fileUrl":"https://private.invalid/meta"}}`),
		[]byte(`[]`), []byte(`[]`), []byte(`[]`), []byte(`[]`),
		[]byte(`[{"id":"queue-event","event_type":"entered_pool","metadata":{"reason":"queue_closed"}}]`),
	}}
}

func TestLeadHistoryReadScopeLegacyBatchRetainsContextAndRedactsURLs(t *testing.T) {
	fixture, actor := newHistoryScopeFixture()
	result, err := readLeadHistorySnapshot(context.Background(), fixture, actor, fixture.lead, func(tx pgx.Tx) (map[string]any, error) {
		return (Repository{}).leadHistoryRawInSnapshot(context.Background(), tx, actor, fixture.lead)
	})
	if err != nil || fixture.reads != 1 || fixture.commits != 1 {
		t.Fatalf("legacy batch did not finish in its authorization transaction: %v %+v", err, fixture)
	}
	raw, err := json.Marshal(result)
	if err != nil || strings.Contains(string(raw), "private.invalid") || !strings.Contains(string(raw), "documento.pdf") || !strings.Contains(string(raw), "public.invalid/creative") {
		t.Fatalf("legacy read lost presentation or leaked a URL: %s %v", raw, err)
	}
	if len(result["queueRuntimeEvents"].([]map[string]any)) != 1 {
		t.Fatal("legacy history omitted authorized queue runtime context")
	}
}
