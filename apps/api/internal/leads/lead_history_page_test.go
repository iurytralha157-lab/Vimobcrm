package leads

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const historyPageTestOrg = "11111111-1111-4111-8111-111111111111"
const historyPageTestOtherOrg = "22222222-2222-4222-8222-222222222222"
const historyPageTestLead = "33333333-3333-4333-8333-333333333333"

func historyPageTestCursor() leadHistoryPageCursor {
	return leadHistoryPageCursor{Version: 1, OrganizationID: historyPageTestOrg, LeadID: historyPageTestLead,
		SnapshotAt: time.Date(2026, 10, 12, 18, 0, 0, 123456000, time.UTC),
		OccurredAt: time.Date(2026, 10, 12, 17, 0, 0, 654321000, time.UTC),
		ID:         "44444444-4444-4444-8444-444444444444", SourceRank: 6}
}

func TestLeadHistoryPageFilterKeepsLegacyAndRejectsInvalidInput(t *testing.T) {
	_, paged, err := ParseLeadHistoryPageFilter(url.Values{"unrelated": {"1"}})
	if err != nil || paged {
		t.Fatalf("legacy request changed: paged=%v err=%v", paged, err)
	}
	encoded, err := encodeLeadHistoryPageCursor(historyPageTestCursor())
	if err != nil {
		t.Fatal(err)
	}
	filter, paged, err := ParseLeadHistoryPageFilter(url.Values{"cursor": {encoded}})
	if err != nil || !paged || filter.PageSize != 100 || filter.cursor == nil {
		t.Fatalf("cursor-only request did not use default: %+v %v %v", filter, paged, err)
	}
	for _, size := range []string{"1", "100", "200"} {
		filter, paged, err := ParseLeadHistoryPageFilter(url.Values{"pageSize": {size}})
		if err != nil || !paged || filter.PageSize < 1 || filter.PageSize > 200 {
			t.Fatalf("valid page size %q rejected", size)
		}
	}
	invalid := []url.Values{{"pageSize": {""}}, {"pageSize": {"0"}}, {"pageSize": {"-1"}},
		{"pageSize": {"201"}}, {"pageSize": {"1.2"}}, {"pageSize": {"100", "200"}},
		{"cursor": {""}}, {"cursor": {" "}}, {"cursor": {"bad!"}}, {"cursor": {encoded, encoded}}}
	for _, input := range invalid {
		_, paged, err := ParseLeadHistoryPageFilter(input)
		if !paged || !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("invalid parameters accepted: %v", input)
		}
	}
}

func TestLeadHistoryPageCursorRoundTripAndMalformedValues(t *testing.T) {
	cursor := historyPageTestCursor()
	encoded, err := encodeLeadHistoryPageCursor(cursor)
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := decodeLeadHistoryPageCursor(encoded)
	if err != nil || decoded != cursor {
		t.Fatalf("cursor lost precision or scope: %+v %v", decoded, err)
	}
	for _, mutate := range []func(*leadHistoryPageCursor){
		func(c *leadHistoryPageCursor) { c.Version = 2 }, func(c *leadHistoryPageCursor) { c.SourceRank = 0 },
		func(c *leadHistoryPageCursor) { c.SourceRank = len(leadHistoryPageSources) + 1 }, func(c *leadHistoryPageCursor) { c.LeadID = "invalid" },
		func(c *leadHistoryPageCursor) { c.OrganizationID = "invalid" }, func(c *leadHistoryPageCursor) { c.ID = "invalid" },
		func(c *leadHistoryPageCursor) { c.SnapshotAt = time.Time{} }, func(c *leadHistoryPageCursor) { c.OccurredAt = time.Time{} },
	} {
		bad := cursor
		mutate(&bad)
		value, err := encodeLeadHistoryPageCursor(bad)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := decodeLeadHistoryPageCursor(value); !errors.Is(err, ErrInvalidInput) {
			t.Fatal("invalid cursor accepted")
		}
	}
	raw, err := json.Marshal(cursor)
	if err != nil {
		t.Fatal(err)
	}
	for _, bad := range [][]byte{append(append([]byte{}, raw...), []byte("{}")...),
		[]byte(strings.Replace(string(raw), `"v":1`, `"v":1,"unknown":true`, 1)), []byte("null"), []byte("[]")} {
		if _, err := decodeLeadHistoryPageCursor(base64.RawURLEncoding.EncodeToString(bad)); !errors.Is(err, ErrInvalidInput) {
			t.Fatal("malformed cursor accepted")
		}
	}
	if _, err := decodeLeadHistoryPageCursor(strings.Repeat("A", 2049)); !errors.Is(err, ErrInvalidInput) {
		t.Fatal("oversized cursor accepted")
	}
}

func TestLeadHistoryPageRejectsForeignScopeBeforeDatabase(t *testing.T) {
	cursor := historyPageTestCursor()
	filter := LeadHistoryPageFilter{PageSize: 100, cursor: &cursor}
	for _, scope := range [][2]string{{historyPageTestOtherOrg, historyPageTestLead}, {historyPageTestOrg, historyPageTestOrg}} {
		_, err := (Repository{}).LeadHistoryPage(context.Background(), tenant.Context{OrganizationID: scope[0]}, scope[1], filter)
		if !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("foreign cursor scope reached database: %v", err)
		}
	}
	if _, err := (Repository{}).LeadHistoryPage(context.Background(), tenant.Context{OrganizationID: historyPageTestOrg}, "bad", filter); !errors.Is(err, ErrInvalidInput) {
		t.Fatal("invalid lead reached database")
	}
}

func historyPageTestRow(rank, sequence int, at time.Time) leadHistoryPageRow {
	id := fmt.Sprintf("%08x-4444-4444-8444-444444444444", sequence)
	data := map[string]any{"id": id, "organization_id": historyPageTestOrg, "lead_id": historyPageTestLead}
	if rank == 6 {
		delete(data, "lead_id")
		data["entity_id"], data["entity_type"] = historyPageTestLead, "lead"
	}
	return leadHistoryPageRow{SourceRank: rank, OccurredAt: at, ID: id, Data: data}
}

func TestLeadHistoryPageTieOrderingRecoversAllSyntheticRows(t *testing.T) {
	at := historyPageTestCursor().OccurredAt
	rows := []leadHistoryPageRow{}
	for sequence := 1; sequence <= 9; sequence++ {
		for rank := 1; rank <= len(leadHistoryPageSources); rank++ {
			rows = append(rows, historyPageTestRow(rank, sequence, at))
		}
	}
	rows = append(rows, historyPageTestRow(1, 20, at.Add(time.Second)), historyPageTestRow(6, 21, time.Unix(0, 0).UTC()))
	slices.SortFunc(rows, func(a, b leadHistoryPageRow) int {
		if leadHistoryPageRowOlder(a, b) {
			return 1
		}
		if leadHistoryPageRowOlder(b, a) {
			return -1
		}
		return 0
	})
	seen := map[string]bool{}
	var boundary *leadHistoryPageRow
	for {
		candidates := []leadHistoryPageRow{}
		for _, row := range rows {
			if boundary == nil || leadHistoryPageRowOlder(row, *boundary) {
				candidates = append(candidates, row)
			}
		}
		if len(candidates) == 0 {
			break
		}
		pageSize := 7
		hasOlder := len(candidates) > pageSize
		if hasOlder {
			candidates = candidates[:pageSize]
		}
		response, err := reconstructLeadHistoryPage(leadHistoryPageResult{Events: candidates, HasOlder: hasOlder,
			Lead: map[string]any{"id": historyPageTestLead}}, historyPageTestOrg, historyPageTestLead, at.Add(time.Hour), pageSize)
		if err != nil {
			t.Fatal(err)
		}
		for _, row := range candidates {
			identity := fmt.Sprintf("%s:%d", row.ID, row.SourceRank)
			if seen[identity] {
				t.Fatal("cursor returned duplicate identity")
			}
			seen[identity] = true
		}
		if !response.Pagination.HasOlder {
			if response.Pagination.NextCursor != nil {
				t.Fatal("last page emitted cursor")
			}
			break
		}
		cursor, err := decodeLeadHistoryPageCursor(*response.Pagination.NextCursor)
		if err != nil {
			t.Fatal(err)
		}
		boundary = &leadHistoryPageRow{OccurredAt: cursor.OccurredAt, ID: cursor.ID, SourceRank: cursor.SourceRank}
	}
	if len(seen) != len(rows) {
		t.Fatalf("lost synthetic occurrence: got %d want %d", len(seen), len(rows))
	}
}

func TestLeadHistoryPageReconstructionArraysCoverageAndRedaction(t *testing.T) {
	at := historyPageTestCursor().OccurredAt
	rows := []leadHistoryPageRow{}
	for rank := len(leadHistoryPageSources); rank >= 1; rank-- {
		rows = append(rows, historyPageTestRow(rank, 1, at))
	}
	for _, row := range rows {
		if row.SourceRank == 6 {
			row.Data["new_data"] = map[string]any{"name": "Synthetic Person", "integration_secret": "synthetic-secret", "deal_status": "won"}
		}
	}
	response, err := reconstructLeadHistoryPage(leadHistoryPageResult{Events: rows, Lead: map[string]any{"id": historyPageTestLead},
		CanonicalPresence: leadHistoryCanonicalPresence{LeadCreated: true, FirstResponse: true, Assignment: true}},
		historyPageTestOrg, historyPageTestLead, at.Add(time.Hour), 100)
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"timelineEvents", "activityEvents", "entryEvents", "distributionLogs", "assignmentLogs", "auditLogs", "queueRuntimeEvents"} {
		if len(response.Data[key].([]map[string]any)) != 1 {
			t.Fatalf("source %s not reconstructed", key)
		}
	}
	audit := response.Data["auditLogs"].([]map[string]any)[0]["new_data"].(map[string]any)
	if audit["name"] != "[valor protegido]" || audit["deal_status"] != "won" || audit["integration_secret"] != nil {
		t.Fatal("paged audit did not reuse operational redaction")
	}
	raw, err := json.Marshal(response)
	if err != nil {
		t.Fatal(err)
	}
	for _, fragment := range []string{`"complete":false`, `"leadCreated":true`, `"firstResponse":true`, `"assignment":true`,
		`"nextCursor":null`, `"hasOlder":false`, `"leadMeta":{}`, `"users":[]`} {
		if !strings.Contains(string(raw), fragment) {
			t.Fatalf("missing envelope fragment %s", fragment)
		}
	}
}

func TestLeadHistoryPageReconstructionRejectsBrokenRowsAndBoundary(t *testing.T) {
	at := historyPageTestCursor().OccurredAt
	valid := historyPageTestRow(1, 1, at)
	for _, result := range []leadHistoryPageResult{
		{}, {Lead: map[string]any{"id": historyPageTestOrg}},
		{Lead: map[string]any{"id": historyPageTestLead}, HasOlder: true},
		{Lead: map[string]any{"id": historyPageTestLead}, Events: []leadHistoryPageRow{valid, valid}},
	} {
		if _, err := reconstructLeadHistoryPage(result, historyPageTestOrg, historyPageTestLead, at, 1); err == nil {
			t.Fatal("broken page accepted")
		}
	}
	for _, mutate := range []func(*leadHistoryPageRow){
		func(r *leadHistoryPageRow) { r.SourceRank = 0 }, func(r *leadHistoryPageRow) { r.OccurredAt = time.Time{} },
		func(r *leadHistoryPageRow) { r.Data["organization_id"] = historyPageTestOtherOrg },
		func(r *leadHistoryPageRow) { r.Data["lead_id"] = historyPageTestOrg }, func(r *leadHistoryPageRow) { r.Data["id"] = "other" },
	} {
		row := historyPageTestRow(1, 1, at)
		mutate(&row)
		if _, err := reconstructLeadHistoryPage(leadHistoryPageResult{Lead: map[string]any{"id": historyPageTestLead}, Events: []leadHistoryPageRow{row}},
			historyPageTestOrg, historyPageTestLead, at, 100); err == nil {
			t.Fatal("invalid row accepted")
		}
	}
}

func TestLeadHistoryPageSQLIsBoundedScopedAndHydratesAfterSelection(t *testing.T) {
	sql := leadHistoryPageSQL()
	if strings.Contains(strings.ToLower(sql), " offset ") || strings.Count(sql, "limit $8::integer") != len(leadHistoryPageSources)+1 {
		t.Fatal("all sources and unified identifiers must use bounded keyset reads")
	}
	if strings.Index(sql, "page_rows as materialized") > strings.Index(sql, "jsonb_agg(") {
		t.Fatal("JSON aggregation ran before bounded page selection")
	}
	for _, source := range leadHistoryPageSources {
		for _, fragment := range []string{source.alias + ".organization_id = $1::uuid and " + source.leadFilter,
			"coalesce(" + source.alias + ".created_at, 'epoch'::timestamptz) <= $3::timestamptz",
			fmt.Sprintf("(%s, %s.id, %d::integer) < ($4::timestamptz, $5::uuid, $6::integer)", source.occurrence, source.alias, source.rank)} {
			if !strings.Contains(sql, fragment) {
				t.Fatalf("source %s missing scoped boundary", source.table)
			}
		}
	}
	for _, fragment := range []string{"coalesce(e.event_at, e.created_at, 'epoch'::timestamptz)",
		"order by occurred_at desc, id desc, source_rank desc", "from hydrated_page p",
		"'message_fingerprint'", "'{metadata,profile,cpf}'", "'{metadata,profile,rg}'",
		"exists (select 1 from public.lead_timeline_events", "exists (select 1 from public.activities",
		"exists (select 1 from public.assignments_log", "exists (select 1 from public.round_robin_logs"} {
		if !strings.Contains(sql, fragment) {
			t.Fatalf("missing query contract %s", fragment)
		}
	}
}

func TestLeadHistoryPageSQLResolvesMetadataActorsOnlyInsideOrganization(t *testing.T) {
	sql := leadHistoryPageSQL()
	for _, path := range []string{
		"p.data->'metadata'->>'user_id'", "p.data->'metadata'->>'to_user_id'", "p.data->'metadata'->>'from_user_id'",
		"p.data->'metadata'->>'assigned_user_id'", "p.data->'old_data'->>'assigned_user_id'", "p.data->'new_data'->>'assigned_user_id'",
	} {
		if !strings.Contains(sql, path) {
			t.Fatalf("missing page actor reference %s", path)
		}
	}
	guardedCast := `case
		when lower(btrim(id)) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
		then lower(btrim(id))::uuid else null`
	if !strings.Contains(sql, guardedCast) {
		t.Fatal("free metadata must be normalized and validated inside CASE before UUID conversion")
	}
	_, lookup, found := strings.Cut(sql, "from public.users u join user_ids on u.id = user_ids.id")
	for _, criterion := range []string{"u.organization_id = $1::uuid", "u.role = 'super_admin'",
		"history_participant.organization_id = $1::uuid", "history_participant.user_id = u.id"} {
		if !found || !strings.Contains(lookup, criterion) {
			t.Fatalf("metadata actor lookup is missing organization participant guard %s", criterion)
		}
	}
	if !strings.Contains(sql, "from public.users u join user_ids on u.id = user_ids.id") ||
		strings.Contains(sql, "user_ids.id::uuid") {
		t.Fatal("actor lookup must join the safely converted UUID using the user primary key")
	}
}
