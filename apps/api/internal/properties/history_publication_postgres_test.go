package properties

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

// Own database, real ListHistory SQL and visibility predicate; no production schema or worker.
func TestPropertyPublicationHistoryPostgres(t *testing.T) {
	ctx, conn := propertyRemediationPostgres(t)
	_, err := conn.Exec(ctx, `
		alter table public.properties add column cadastrado_por uuid;
		alter table public.events add column id uuid default gen_random_uuid();
		alter table public.events add column created_at timestamptz default now();
		create table public.team_members (organization_id uuid, team_id uuid, user_id uuid, is_active boolean, is_leader boolean, membership_generation bigint);
		create table public.organization_members (organization_id uuid, user_id uuid, is_active boolean, deleted_at timestamptz, membership_generation bigint);
		create table public.schedule_events (id uuid, organization_id uuid, property_id uuid, status text, event_type text, start_time timestamptz, end_time timestamptz, created_at timestamptz);
		create table public.property_channel_publication_versions (id uuid, publication_id uuid, organization_id uuid, property_id uuid, version integer, payload jsonb);
		create table public.property_channel_publication_jobs (
			id uuid primary key, publication_id uuid, version_id uuid, organization_id uuid, property_id uuid, channel text,
			action text, status text, attempts integer, max_attempts integer, requested_by uuid, completed_at timestamptz, created_at timestamptz,
			idempotency_key text default 'PRIVATE-KEY', last_error_message text default 'PRIVATE-ERROR', request_hash text default 'PRIVATE-HASH'
		);
		insert into public.properties (id, organization_id, title, code, created_by, responsible_user_id, created_at) values
		('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Synthetic A','QA001','30000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','2026-11-15T10:00Z'),
		('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','Other property','QA002','30000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002','2026-11-15T10:00Z'),
		('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000002','Other tenant','QA003','30000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002','2026-11-15T10:00Z');
		insert into public.property_channel_publication_versions values
		('50000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',1,'{"secret":"PRIVATE-PAYLOAD","url":"https://private.invalid"}');
		insert into public.events (id, organization_id, entity_type, entity_id, event_type, payload, created_at) values
		('70000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','property','20000000-0000-4000-8000-000000000001','property_publication_changed','{"message":"Legacy publication event"}','2026-11-15T11:00Z');
	`)
	if err != nil {
		t.Fatal(err)
	}
	ownedURL, err := url.Parse(conn.Config().ConnString())
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(conn.Config().Database, "vimob_properties_remediation_") {
		t.Fatal("fixture database is not owned")
	}
	ownedURL.Path = "/" + conn.Config().Database
	database, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: ownedURL.String(), MaxConns: 1, ForceReadOnly: true})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(database.Close)
	repo := NewRepository(database, StorageConfig{})
	actor := tenant.Context{OrganizationID: "10000000-0000-4000-8000-000000000001", UserID: "30000000-0000-4000-8000-000000000001", Permissions: []string{"property_view"}}
	propertyID := "20000000-0000-4000-8000-000000000001"
	type jobCase struct {
		action, status, label string
		attempts              int
	}
	cases := []jobCase{
		{"publish", "succeeded", "Solicitação de publicação no Site — Concluída", 1},
		{"unpublish", "succeeded", "Solicitação de remoção no Site — Concluída", 1},
		{"publish", "pending", "Solicitação de publicação no Site — Na fila", 0},
		{"update", "processing", "Solicitação de atualização no Site — Processando", 1},
		{"update", "retry", "Solicitação de atualização no Site — Nova tentativa agendada", 2},
		{"revalidate", "dead", "Solicitação de revalidação no Site — Falhou", 3},
		{"publish", "superseded", "Solicitação de publicação no Site — Substituída", 1},
	}
	for i, c := range cases {
		_, err = conn.Exec(ctx, `insert into public.property_channel_publication_jobs
		(id,publication_id,version_id,organization_id,property_id,channel,action,status,attempts,max_attempts,requested_by,created_at,completed_at)
		values ($1::uuid,'60000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001',$2::uuid,$3::uuid,'site',$4,$5,$6,12,$7::uuid,$8::timestamptz,case when $5='succeeded' then $8::timestamptz+interval '1 minute' end)`,
			fmt.Sprintf("40000000-0000-4000-8000-%012d", i+1), actor.OrganizationID, propertyID, c.action, c.status, c.attempts, actor.UserID, time.Date(2026, 11, 15, 12, i, 0, 0, time.UTC))
		if err != nil {
			t.Fatal(err)
		}
	}
	_, err = conn.Exec(ctx, `insert into public.property_channel_publication_jobs
		(id,publication_id,organization_id,property_id,channel,action,status,attempts,max_attempts,created_at)
		select ('90000000-0000-4000-8000-'||lpad(row_number() over ()::text,12,'0'))::uuid,
		'60000000-0000-4000-8000-000000000001',organization_id,id,'grupo_olx','publish','pending',0,12,'2026-11-15T13:00Z'
		from public.properties where id <> $1::uuid`, propertyID)
	if err != nil {
		t.Fatal(err)
	}
	read := func(t *testing.T, scope tenant.Context, id string) []HistoryEvent {
		t.Helper()
		rows, err := repo.ListHistory(ctx, scope, id)
		if err != nil {
			t.Fatal(err)
		}
		return rows
	}
	t.Run("own property includes each canonical request once with safe metadata", func(t *testing.T) {
		rows := read(t, actor, propertyID)
		if len(rows) != len(cases)+2 {
			t.Fatalf("history count=%d, want %d", len(rows), len(cases)+2)
		}
		for i, c := range cases {
			t.Run(c.status, func(t *testing.T) {
				id := fmt.Sprintf("publication-job:40000000-0000-4000-8000-%012d", i+1)
				var found []HistoryEvent
				for _, row := range rows {
					if row.ID == id {
						found = append(found, row)
					}
				}
				if len(found) != 1 {
					t.Fatalf("job rows=%d, want one", len(found))
				}
				row := found[0]
				if row.Type != "property_publication_job" || row.Title != c.label {
					t.Fatalf("unexpected presentation: %s / %s", row.Type, row.Title)
				}
				if row.Metadata["requested_by"] != actor.UserID || row.Metadata["status"] != c.status || row.Metadata["version"] != float64(1) || row.Metadata["attempts"] != float64(c.attempts) {
					t.Fatalf("safe job metadata mismatch")
				}
				allowed := map[string]bool{"job_id": true, "channel": true, "action": true, "status": true, "version": true, "attempts": true, "max_attempts": true, "requested_by": true, "completed_at": true}
				for key := range row.Metadata {
					if !allowed[key] {
						t.Fatalf("unexpected metadata key %s", key)
					}
				}
				encoded, _ := json.Marshal(row)
				if strings.Contains(string(encoded), "PRIVATE-") || strings.Contains(string(encoded), "https:") {
					t.Fatal("private publication data leaked")
				}
			})
		}
		for i := 1; i < len(rows); i++ {
			if rows[i].CreatedAt > rows[i-1].CreatedAt {
				t.Fatal("history is not newest first")
			}
		}
	})
	t.Run("legacy publication event is preserved without speculative dedupe", func(t *testing.T) {
		rows := read(t, actor, propertyID)
		count := 0
		for _, row := range rows {
			if row.ID == "70000000-0000-4000-8000-000000000001" {
				count++
			}
		}
		if count != 1 {
			t.Fatalf("legacy rows=%d", count)
		}
	})
	t.Run("repeat reads retain the same job identities", func(t *testing.T) {
		first, second := read(t, actor, propertyID), read(t, actor, propertyID)
		a, _ := json.Marshal(first)
		b, _ := json.Marshal(second)
		if string(a) != string(b) {
			t.Fatal("repeat read changed canonical identities")
		}
	})
	t.Run("retry updates one job rather than inventing attempts as events", func(t *testing.T) {
		if _, err := conn.Exec(ctx, `update public.property_channel_publication_jobs set attempts=3 where id='40000000-0000-4000-8000-000000000005'`); err != nil {
			t.Fatal(err)
		}
		rows := read(t, actor, propertyID)
		count := 0
		for _, row := range rows {
			if row.ID == "publication-job:40000000-0000-4000-8000-000000000005" {
				count++
				if row.Metadata["attempts"] != float64(3) {
					t.Fatal("retry state missing")
				}
			}
		}
		if count != 1 {
			t.Fatalf("retry rows=%d", count)
		}
	})
	t.Run("other property and other tenant remain hidden", func(t *testing.T) {
		for _, id := range []string{"20000000-0000-4000-8000-000000000002", "20000000-0000-4000-8000-000000000003"} {
			if _, err := repo.ListHistory(ctx, actor, id); !errors.Is(err, ErrPropertyNotFound) {
				t.Fatalf("invisible property error=%v", err)
			}
		}
		other := actor
		other.OrganizationID = "10000000-0000-4000-8000-000000000002"
		if _, err := repo.ListHistory(ctx, other, propertyID); !errors.Is(err, ErrPropertyNotFound) {
			t.Fatalf("cross-tenant error=%v", err)
		}
		other = actor
		other.UserID = "30000000-0000-4000-8000-000000000002"
		if _, err := repo.ListHistory(ctx, other, propertyID); !errors.Is(err, ErrPropertyNotFound) {
			t.Fatalf("other actor error=%v", err)
		}
	})
	t.Run("manager can read another own-tenant property and nullable job fields", func(t *testing.T) {
		manager := actor
		manager.MemberRole = "admin"
		rows := read(t, manager, "20000000-0000-4000-8000-000000000002")
		if len(rows) != 2 || rows[0].Title != "Solicitação de publicação no Grupo OLX — Na fila" || rows[1].Type != "property_created" {
			t.Fatal("other property job/fallback changed")
		}
		if rows[0].Metadata["requested_by"] != nil || rows[0].Metadata["version"] != nil || rows[0].Metadata["completed_at"] != nil {
			t.Fatal("nullable fields were invented")
		}
	})
	t.Run("second tenant only receives its own property job", func(t *testing.T) {
		other := actor
		other.OrganizationID = "10000000-0000-4000-8000-000000000002"
		other.UserID = "30000000-0000-4000-8000-000000000002"
		rows := read(t, other, "20000000-0000-4000-8000-000000000003")
		if len(rows) != 2 || rows[0].Metadata["channel"] != "grupo_olx" {
			t.Fatal("second tenant projection differs")
		}
		for _, row := range rows {
			if strings.Contains(row.ID, "40000000") || row.ID == "70000000-0000-4000-8000-000000000001" {
				t.Fatal("first tenant history leaked")
			}
		}
	})
	t.Run("newest-first global history limit remains 100", func(t *testing.T) {
		_, err := conn.Exec(ctx, `insert into public.property_channel_publication_jobs
		(id,publication_id,organization_id,property_id,channel,action,status,attempts,max_attempts,created_at)
		select ('80000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'60000000-0000-4000-8000-000000000001',$1::uuid,$2::uuid,'site','publish','pending',0,12,'2026-11-16T00:00Z'::timestamptz+i*interval '1 minute' from generate_series(1,110)i`, actor.OrganizationID, propertyID)
		if err != nil {
			t.Fatal(err)
		}
		rows := read(t, actor, propertyID)
		if len(rows) != 100 || rows[0].ID != "publication-job:80000000-0000-4000-8000-000000000110" || rows[99].ID != "publication-job:80000000-0000-4000-8000-000000000011" {
			t.Fatalf("limit/order changed: %d rows", len(rows))
		}
	})
}
