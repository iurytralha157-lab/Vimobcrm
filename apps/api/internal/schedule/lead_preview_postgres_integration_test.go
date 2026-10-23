package schedule

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

// This is a SQL/projection test in an owned database, not a production migration
// or permission/RLS certification. The shared Agenda minimal schema is reused.
func TestLeadPreviewPostgresOrderingPaginationAndMasking(t *testing.T) {
	ctx, conn := openLeadPreviewPostgresFixture(t)
	org, foreignOrg, owner, viewer, lead := leadPreviewFixtureID(1), leadPreviewFixtureID(2), leadPreviewFixtureID(3), leadPreviewFixtureID(4), leadPreviewFixtureID(5)
	at := time.Date(2026, 10, 12, 12, 0, 0, 0, time.UTC)
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := conn.Exec(ctx, sql, args...); err != nil {
			t.Fatalf("seed owned preview fixture: %v", err)
		}
	}
	exec(`insert into public.organizations(id,name) values($1,'Synthetic A'),($2,'Synthetic B')`, org, foreignOrg)
	exec(`insert into public.users(id,organization_id,name) values($1,$3,'Synthetic owner'),($2,$3,'Synthetic viewer')`, owner, viewer, org)
	exec(`insert into public.leads(id,organization_id,name,assigned_user_id) values($1,$2,'Synthetic lead',$3)`, lead, org, owner)
	for _, event := range []struct {
		id         int
		status     string
		visibility string
		start      time.Time
		org        string
	}{
		{101, "scheduled", "public", at.Add(time.Hour), org},
		{102, "scheduled", "public", at.Add(2 * time.Hour), org},
		{103, "completed", "public", at.Add(-time.Hour), org},
		{104, "canceled", "public", at.Add(-2 * time.Hour), org},
		{105, "completed", "default", at.Add(90 * time.Minute), org},
		{106, "scheduled", "default", at.Add(90 * time.Minute), org},
		{107, "scheduled", "public", at, foreignOrg},
		{108, "scheduled", "private", at, org},
	} {
		exec(`insert into public.schedule_events(id,organization_id,user_id,lead_id,title,start_time,end_time,status,visibility)
		 values($1,$2,$3,$4,'Synthetic title',$5,$6,$7,$8)`, leadPreviewFixtureID(event.id), event.org, owner, lead,
			event.start, event.start.Add(time.Hour), event.status, event.visibility)
	}
	read := func(preview bool, limit, offset int) EventPage {
		t.Helper()
		where := "se.organization_id=$1::uuid and se.lead_id=$11::uuid"
		query := scheduleEventsQuery(where)
		if preview {
			query = scheduleLeadPreviewEventsQuery(where)
		}
		rows, err := conn.Query(ctx, query+" limit $12::integer offset $13::bigint", org, viewer, false,
			false, viewer, false, false, false, viewer, false, lead, limit+1, offset)
		if err != nil {
			t.Fatalf("execute actual preview SQL: %v", err)
		}
		defer rows.Close()
		var events []Event
		for rows.Next() {
			event, err := scanEvent(rows)
			if err != nil {
				t.Fatal(err)
			}
			events = append(events, event)
		}
		if err := rows.Err(); err != nil {
			t.Fatal(err)
		}
		return scheduleEventPage(events, ListFilter{Limit: limit, Offset: offset})
	}
	ids := func(page EventPage) []string {
		result := []string{}
		for _, event := range page.Events {
			result = append(result, event.ID)
		}
		return result
	}
	t.Run("open first and recent finalized events remain reachable on later pages", func(t *testing.T) {
		var got []string
		for offset := 0; offset < 8; offset += 2 {
			page := read(true, 2, offset)
			got = append(got, ids(page)...)
			if !page.Pagination.HasMore {
				break
			}
		}
		want := []string{}
		for _, id := range []int{101, 105, 106, 102, 103, 104} {
			want = append(want, leadPreviewFixtureID(id))
		}
		if !slices.Equal(got, want) {
			t.Fatalf("preview page order: got %v want %v", got, want)
		}
		if legacy := read(false, 10, 0); legacy.Events[0].ID != leadPreviewFixtureID(104) {
			t.Fatal("legacy Agenda chronology changed")
		}
	})
	t.Run("masked outcome cannot affect position or expose status", func(t *testing.T) {
		before := read(true, 10, 0)
		for _, event := range before.Events {
			if event.ID == leadPreviewFixtureID(105) {
				raw, err := json.Marshal(event)
				if err != nil || !event.IsMasked || event.Status != "" || event.LeadID != nil || !strings.Contains(string(raw), `"status":null`) {
					t.Fatalf("masked projection exposed completed state: %s %v", raw, err)
				}
			}
		}
		exec(`update public.schedule_events set status='scheduled' where id=$1`, leadPreviewFixtureID(105))
		if after := read(true, 10, 0); !slices.Equal(ids(before), ids(after)) {
			t.Fatal("masked result was encoded in preview order")
		}
	})
}

func leadPreviewFixtureID(value int) string {
	return fmt.Sprintf("00000000-0000-4000-8000-%012d", value)
}

func openLeadPreviewPostgresFixture(t *testing.T) (context.Context, *pgx.Conn) {
	t.Helper()
	if os.Getenv("VIMOB_RUN_STAGE_ARCHIVE_DB_TESTS") != "LOCAL_WRITE_TEST" {
		t.Skip("opt in to the owned Pipeline PostgreSQL fixture")
	}
	dsn := strings.TrimSpace(os.Getenv("PIPELINE_ARCHIVE_TEST_DATABASE_URL"))
	parsed, err := url.Parse(dsn)
	loopback := func(host string) bool { return host == "127.0.0.1" || host == "localhost" || host == "::1" }
	if err != nil || (parsed.Scheme != "postgres" && parsed.Scheme != "postgresql") || parsed.User == nil ||
		parsed.User.Username() != "postgres" || parsed.Path != "/postgres" || !loopback(parsed.Hostname()) {
		t.Fatal("preview fixture requires disposable loopback postgres/postgres")
	}
	config, err := pgx.ParseConfig(dsn)
	if err != nil || config.User != "postgres" || config.Database != "postgres" || !loopback(config.Host) {
		t.Fatal("unsafe preview test target override")
	}
	for _, fallback := range config.Fallbacks {
		if !loopback(fallback.Host) {
			t.Fatal("unsafe preview test fallback")
		}
	}
	ctx, cancel := context.WithTimeout(t.Context(), time.Minute)
	t.Cleanup(cancel)
	admin, err := pgx.ConnectConfig(ctx, config)
	if err != nil {
		t.Fatal("cannot connect to explicitly selected disposable server")
	}
	var suffix [6]byte
	if _, err := rand.Read(suffix[:]); err != nil {
		_ = admin.Close(ctx)
		t.Fatal("cannot generate preview database name")
	}
	databaseName := "vimob_lead_preview_test_" + hex.EncodeToString(suffix[:])
	quoted := pgx.Identifier{databaseName}.Sanitize()
	if _, err := admin.Exec(ctx, "create database "+quoted); err != nil {
		_ = admin.Close(ctx)
		t.Fatal("cannot create owned preview database")
	}
	var conn *pgx.Conn
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cleanupCancel()
		if conn != nil {
			if err := conn.Close(cleanupCtx); err != nil {
				t.Errorf("close preview connection: %v", err)
			}
		}
		if _, err := admin.Exec(cleanupCtx, "drop database "+quoted); err != nil {
			t.Errorf("drop owned preview database: %v", err)
		}
		if err := admin.Close(cleanupCtx); err != nil {
			t.Errorf("close test server connection: %v", err)
		}
	})
	config = config.Copy()
	config.Database = databaseName
	conn, err = pgx.ConnectConfig(ctx, config)
	if err != nil {
		t.Fatal("cannot connect to owned preview database")
	}
	if _, err := conn.Exec(ctx, scheduleHardeningFixture); err != nil {
		t.Fatalf("create shared minimal Agenda schema: %v", err)
	}
	return ctx, conn
}
