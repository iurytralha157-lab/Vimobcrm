package leads

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

func TestLeadPipelinePostgresRejectsUnsafeTargets(t *testing.T) {
	for _, dsn := range []string{"", "postgres://postgres@example.test/postgres", "postgres://other@127.0.0.1/postgres",
		"postgres://postgres@127.0.0.1/shared", "postgres://postgres@127.0.0.1/postgres?host=example.test",
		"postgres://postgres@127.0.0.1/postgres?dbname=shared"} {
		if _, err := leadPipelineTestConfig(dsn); err == nil {
			t.Fatal("unsafe target accepted before connection")
		}
	}
}

func TestLeadPipelinePostgresHistoryCursorAndTags(t *testing.T) {
	ctx, conn := openLeadPipelinePostgresFixture(t)
	legacyRepository := openPipelineLegacyHistoryRepository(t, ctx, conn)
	org, foreignOrg, lead, otherLead, user := pipelinePostgresID(1), pipelinePostgresID(2), pipelinePostgresID(3), pipelinePostgresID(4), pipelinePostgresID(5)
	at := time.Date(2026, 10, 12, 12, 0, 0, 123456000, time.UTC)
	snapshot := at.Add(time.Hour)
	pipelinePostgresExec(t, ctx, conn, `insert into public.users(id,name,email) values($1,'Synthetic actor','actor@example.test')`, user)
	pipelinePostgresExec(t, ctx, conn, `insert into public.organization_members(organization_id,user_id) values($1,$2)`, org, user)
	pipelinePostgresExec(t, ctx, conn, `insert into public.leads(id,organization_id,assigned_user_id,created_at) values($1,$2,$3,$4)`, lead, org, user, at.Add(-time.Hour))
	pipelinePostgresExec(t, ctx, conn, `insert into public.leads(id,organization_id,created_at) values($1,$2,$3)`, otherLead, org, at)
	for sequence := 1; sequence <= 9; sequence++ {
		for rank := 1; rank <= 6; rank++ {
			seedPipelineHistoryRow(t, ctx, conn, rank, pipelinePostgresID(100+sequence), org, lead, user, at, at)
		}
	}
	// A later occurrence and a null timestamp exercise the two ordering extremes.
	seedPipelineHistoryRow(t, ctx, conn, 1, pipelinePostgresID(120), org, lead, user, at.Add(time.Second), at)
	seedPipelineHistoryRow(t, ctx, conn, 6, pipelinePostgresID(121), org, lead, user, nil, nil)
	seedPipelineHistoryRow(t, ctx, conn, 1, pipelinePostgresID(122), foreignOrg, lead, user, at, at)
	seedPipelineHistoryRow(t, ctx, conn, 1, pipelinePostgresID(123), org, otherLead, user, at, at)
	// Late insertion with an old occurrence is outside the insertion-time fence.
	seedPipelineHistoryRow(t, ctx, conn, 1, pipelinePostgresID(124), org, lead, user, at.Add(-time.Hour), snapshot.Add(time.Second))
	seedPipelineHistoryRow(t, ctx, conn, 1, pipelinePostgresID(125), org, lead, user, at.Add(-time.Hour), at.Add(-time.Hour))
	pipelinePostgresExec(t, ctx, conn, `update public.lead_timeline_events set event_type='lead_created' where id=$1`, pipelinePostgresID(125))
	pipelinePostgresExec(t, ctx, conn, `update public.activities set type='first_response' where id=$1`, pipelinePostgresID(101))

	t.Run("actual six-source SQL paginates ties without loss or foreign rows", func(t *testing.T) {
		var boundary *leadHistoryPageCursor
		seen := map[string]bool{}
		var gotRows []leadHistoryPageRow
		for page := 0; page < 20; page++ {
			result := readPipelineHistoryPage(t, ctx, conn, org, lead, snapshot, boundary, 7)
			if !result.CanonicalPresence.LeadCreated || !result.CanonicalPresence.FirstResponse || !result.CanonicalPresence.Assignment {
				t.Fatal("older canonical events were absent from page-wide context")
			}
			response, err := reconstructLeadHistoryPage(result, org, lead, snapshot, 7)
			if err != nil {
				t.Fatalf("actual SQL did not match reconstruction contract: %v", err)
			}
			for _, row := range result.Events {
				identity := fmt.Sprintf("%s:%d", row.ID, row.SourceRank)
				if seen[identity] {
					t.Fatal("SQL cursor repeated an occurrence")
				}
				seen[identity] = true
				gotRows = append(gotRows, row)
				if row.SourceRank == 1 && row.Data["metadata"].(map[string]any)["message_fingerprint"] != nil {
					t.Fatal("timeline fingerprint was exposed")
				}
			}
			if page == 0 && len(result.Users) != 1 {
				t.Fatal("authorized actor context was not hydrated")
			}
			if !response.Pagination.HasOlder {
				break
			}
			cursor, err := decodeLeadHistoryPageCursor(*response.Pagination.NextCursor)
			if err != nil {
				t.Fatal(err)
			}
			boundary = &cursor
		}
		if len(seen) != 57 || len(gotRows) != 57 {
			t.Fatalf("actual SQL returned %d occurrences, want 57", len(seen))
		}
		if gotRows[0].ID != pipelinePostgresID(120) || !gotRows[len(gotRows)-1].OccurredAt.Equal(time.Unix(0, 0).UTC()) {
			t.Fatal("occurrence ordering extremes changed")
		}
		for _, id := range []int{122, 123, 124} {
			if seen[fmt.Sprintf("%s:1", pipelinePostgresID(id))] {
				t.Fatal("foreign scope or late insertion crossed the page fence")
			}
		}
	})

	t.Run("SQL empty context is explicit and lead bindings remain tenant scoped", func(t *testing.T) {
		result := readPipelineHistoryPage(t, ctx, conn, foreignOrg, lead, snapshot, nil, 7)
		if len(result.Lead) != 0 {
			t.Fatal("foreign tenant read the lead context")
		}
		result = readPipelineHistoryPage(t, ctx, conn, org, otherLead, snapshot, nil, 7)
		if len(result.Events) != 1 || result.HasOlder || result.Lead["id"] != otherLead {
			t.Fatal("other lead pagination was not isolated")
		}
	})

	t.Run("tag SQL retains canonical empty and excludes mismatched tenants", func(t *testing.T) {
		read := func() []LeadEnrichmentTag {
			var raw []byte
			if err := conn.QueryRow(ctx, "select "+leadDetailTagsSQL+" from public.leads l where l.id=$1 and l.organization_id=$2", lead, org).Scan(&raw); err != nil {
				t.Fatal(err)
			}
			var tags []LeadEnrichmentTag
			if err := json.Unmarshal(raw, &tags); err != nil || tags == nil {
				t.Fatalf("tags must be an explicit canonical collection: %s %v", raw, err)
			}
			return tags
		}
		if len(read()) != 0 {
			t.Fatal("empty canonical tags changed")
		}
		for _, tag := range []struct {
			id           int
			organization string
		}{{201, org}, {202, org}, {203, foreignOrg}} {
			pipelinePostgresExec(t, ctx, conn, `insert into public.tags values($1,$2,'Synthetic tag','#112233')`, pipelinePostgresID(tag.id), tag.organization)
		}
		pipelinePostgresExec(t, ctx, conn, `insert into public.lead_tags values($1,$2,$3,$4),($1,$2,$5,$6),($1,$2,$7,$4),($8,$2,$3,$4)`,
			org, lead, pipelinePostgresID(202), at, pipelinePostgresID(201), at.Add(-time.Second), pipelinePostgresID(203), foreignOrg)
		ids := []string{}
		for _, tag := range read() {
			ids = append(ids, tag.ID)
		}
		if !slices.Equal(ids, []string{pipelinePostgresID(201), pipelinePostgresID(202)}) {
			t.Fatalf("tag ordering/tenant isolation changed: %v", ids)
		}
	})

	t.Run("actual SQL planner accepts all paginated parameters", func(t *testing.T) {
		var plan []byte
		if err := conn.QueryRow(ctx, "explain (format json) "+leadHistoryPageSQL(), org, lead, snapshot, nil, nil, 0, 7, 8).Scan(&plan); err != nil {
			t.Fatalf("actual PostgreSQL planner rejected query: %v", err)
		}
		if !strings.Contains(string(plan), "Plan") {
			t.Fatal("EXPLAIN did not return its plan")
		}
	})

	t.Run("corrupt foreign actor references retain IDs without name avatar or email", func(t *testing.T) {
		// No API-created foreign association is assumed: this is an intentionally
		// inconsistent historical row to examine the exact SQL projection only.
		foreignUser := pipelinePostgresID(301)
		const foreignName = "Synthetic foreign actor"
		const foreignAvatar = "https://foreign.example.test/actor.png"
		const foreignEmail = "foreign-actor@example.test"
		pipelinePostgresExec(t, ctx, conn, `insert into public.users(id,name,email,avatar_url,organization_id) values($1,$2,$3,$4,$5)`, foreignUser, foreignName, foreignEmail, foreignAvatar, foreignOrg)
		pipelinePostgresExec(t, ctx, conn, `insert into public.organization_members(organization_id,user_id) values($1,$2)`, foreignOrg, foreignUser)
		pipelinePostgresExec(t, ctx, conn, `update public.leads set assigned_user_id=$2,first_response_actor_user_id=$2 where id=$1`, lead, foreignUser)
		for rank := 1; rank <= 6; rank++ {
			seedPipelineHistoryRow(t, ctx, conn, rank, pipelinePostgresID(310+rank), org, lead, foreignUser, at.Add(2*time.Second), at.Add(2*time.Second))
		}
		pipelinePostgresExec(t, ctx, conn, `update public.assignments_log set old_user_id=$2 where id=$1`, pipelinePostgresID(315), foreignUser)
		pipelinePostgresExec(t, ctx, conn, `update public.lead_entry_events set metadata=jsonb_build_object('user_id',$2::text) where id=$1`, pipelinePostgresID(313), foreignUser)
		result := readPipelineHistoryPage(t, ctx, conn, org, lead, snapshot, nil, 6)
		if len(result.Events) != 6 {
			t.Fatal("foreign actor probe did not include all six sources")
		}
		for _, row := range result.Events {
			raw, err := json.Marshal(row.Data)
			if err != nil {
				t.Fatal(err)
			}
			name, avatar, email := strings.Contains(string(raw), foreignName), strings.Contains(string(raw), foreignAvatar), strings.Contains(string(raw), foreignEmail)
			t.Logf("synthetic inconsistent actor: source=%d foreign name=%t avatar=%t email=%t", row.SourceRank, name, avatar, email)
			if name || avatar || email {
				t.Errorf("source %d hydrated a foreign participant", row.SourceRank)
			}
		}
		leadRaw, err := json.Marshal(result.Lead)
		if err != nil {
			t.Fatal(err)
		}
		t.Logf("synthetic inconsistent lead assignee: foreign name=%t avatar=%t email=%t", strings.Contains(string(leadRaw), foreignName), strings.Contains(string(leadRaw), foreignAvatar), strings.Contains(string(leadRaw), foreignEmail))
		if strings.Contains(string(leadRaw), foreignName) || strings.Contains(string(leadRaw), foreignAvatar) || strings.Contains(string(leadRaw), foreignEmail) || len(result.Users) != 0 ||
			result.Lead["first_response_actor"] != nil || result.Lead["assigned_user"] != nil || result.Lead["assigned_user_id"] != foreignUser {
			t.Fatal("foreign contextual participant was hydrated or historical ID was lost")
		}
		legacy, err := legacyRepository.LeadHistoryRaw(ctx, tenant.Context{OrganizationID: org, UserID: user, MemberRole: "admin"}, lead)
		if err != nil {
			t.Fatalf("execute actual legacy history read: %v", err)
		}
		legacyRaw, err := json.Marshal(legacy)
		if err != nil || strings.Contains(string(legacyRaw), foreignName) || strings.Contains(string(legacyRaw), foreignAvatar) || strings.Contains(string(legacyRaw), foreignEmail) || !strings.Contains(string(legacyRaw), foreignUser) {
			t.Fatalf("legacy history exposed foreign identity or dropped the historical ID: %v", err)
		}
		pipelinePostgresExec(t, ctx, conn, `update public.users set name=null where id=$1`, foreignUser)
		legacy, err = legacyRepository.LeadHistoryRaw(ctx, tenant.Context{OrganizationID: org, UserID: user, MemberRole: "admin"}, lead)
		if err != nil {
			t.Fatal(err)
		}
		legacyRaw, err = json.Marshal(legacy)
		if err != nil || strings.Contains(string(legacyRaw), foreignEmail) || strings.Contains(string(legacyRaw), foreignAvatar) {
			t.Fatalf("legacy user lookup exposed a foreign email fallback: %v", err)
		}
	})

	t.Run("former members legacy primary users and platform admins retain history identity", func(t *testing.T) {
		for index, scenario := range []struct {
			name         string
			primaryOrg   string
			role         string
			formerMember bool
		}{{"Former synthetic actor", foreignOrg, "user", true}, {"Legacy synthetic actor", org, "user", false}, {"Platform synthetic actor", foreignOrg, "super_admin", false}} {
			participant := pipelinePostgresID(401 + index*50)
			pipelinePostgresExec(t, ctx, conn, `insert into public.users(id,organization_id,role,name,avatar_url) values($1,$2,$3,$4,'https://actor.example.test/avatar.png')`, participant, scenario.primaryOrg, scenario.role, scenario.name)
			if scenario.formerMember {
				pipelinePostgresExec(t, ctx, conn, `insert into public.organization_members(organization_id,user_id,is_active,deleted_at) values($1,$2,false,now())`, org, participant)
			}
			pipelinePostgresExec(t, ctx, conn, `update public.leads set assigned_user_id=$2,first_response_actor_user_id=$2 where id=$1`, lead, participant)
			for rank := 1; rank <= 6; rank++ {
				date := at.Add(time.Duration(3+index) * time.Second)
				seedPipelineHistoryRow(t, ctx, conn, rank, pipelinePostgresID(410+index*50+rank), org, lead, participant, date, date)
			}
			result := readPipelineHistoryPage(t, ctx, conn, org, lead, snapshot, nil, 6)
			for _, row := range result.Events {
				raw, err := json.Marshal(row.Data)
				if err != nil || ((row.SourceRank == 2 || row.SourceRank == 4 || row.SourceRank == 5 || row.SourceRank == 6) && !strings.Contains(string(raw), scenario.name)) {
					t.Fatalf("legitimate %s source %d lost actor identity: %v", scenario.name, row.SourceRank, err)
				}
			}
			contextRaw, err := json.Marshal(result.Lead)
			if err != nil || result.Lead["assigned_user"] == nil || result.Lead["first_response_actor"] == nil || !strings.Contains(string(contextRaw), scenario.name) {
				t.Fatalf("legitimate %s lost contextual identity: %v", scenario.name, err)
			}
			found := false
			for _, actor := range result.Users {
				found = found || actor["id"] == participant
			}
			if !found {
				t.Fatalf("legitimate %s disappeared from page user lookup", scenario.name)
			}
			legacy, err := legacyRepository.LeadHistoryRaw(ctx, tenant.Context{OrganizationID: org, UserID: user, MemberRole: "admin"}, lead)
			if err != nil {
				t.Fatal(err)
			}
			legacyRaw, err := json.Marshal(legacy)
			if err != nil || !strings.Contains(string(legacyRaw), scenario.name) {
				t.Fatalf("legitimate %s disappeared from legacy history: %v", scenario.name, err)
			}
		}
	})
}

func openPipelineLegacyHistoryRepository(t *testing.T, ctx context.Context, conn *pgx.Conn) Repository {
	t.Helper()
	config := conn.Config()
	if !strings.HasPrefix(config.Database, "vimob_lead_pipeline_test_") {
		t.Fatal("legacy repository must use the already owned generated database")
	}
	parsed, err := url.Parse(config.ConnString())
	if err != nil {
		t.Fatal("cannot construct the owned legacy read URL")
	}
	// ConnString keeps the originally supplied DSN: changing ConnConfig.Database
	// alone must never be used when constructing a new pool from that string.
	parsed.Path = "/" + config.Database
	database, err := dbpkg.NewPostgres(ctx, dbpkg.Config{URL: parsed.String(), MaxConns: 1, HealthTimeout: 3 * time.Second})
	if err != nil {
		t.Fatal("cannot connect legacy reader to generated database")
	}
	t.Cleanup(database.Close)
	var actualDatabase string
	if err := database.Pool().QueryRow(ctx, "select current_database()").Scan(&actualDatabase); err != nil || actualDatabase != config.Database {
		t.Fatal("legacy read pool did not connect to the exact owned database")
	}
	return NewRepository(database, nil)
}

func readPipelineHistoryPage(t *testing.T, ctx context.Context, conn *pgx.Conn, org, lead string, snapshot time.Time, cursor *leadHistoryPageCursor, size int) leadHistoryPageResult {
	t.Helper()
	var occurred, id any
	rank := 0
	if cursor != nil {
		occurred, id, rank = cursor.OccurredAt, cursor.ID, cursor.SourceRank
	}
	var raw []byte
	if err := conn.QueryRow(ctx, leadHistoryPageSQL(), org, lead, snapshot, occurred, id, rank, size, size+1).Scan(&raw); err != nil {
		t.Fatalf("execute actual Pipeline history SQL: %v", err)
	}
	var result leadHistoryPageResult
	if err := json.Unmarshal(raw, &result); err != nil {
		t.Fatal(err)
	}
	return result
}

func seedPipelineHistoryRow(t *testing.T, ctx context.Context, conn *pgx.Conn, rank int, id, org, lead, user string, occurred, created any) {
	t.Helper()
	base := "insert into public."
	args := []any{id, org, lead, created}
	sql := ""
	switch rank {
	case 1:
		sql = `lead_timeline_events(id,organization_id,lead_id,created_at,event_at,event_type,metadata,actor_user_id) values($1,$2,$3,$4,$5,'synthetic','{"message_fingerprint":"synthetic-fingerprint"}',$6)`
		args = append(args, occurred, user)
	case 2:
		sql = `activities(id,organization_id,lead_id,created_at,user_id,type,metadata) values($1,$2,$3,$4,$5,'synthetic','{}')`
		args = append(args, user)
	case 3:
		sql = `lead_entry_events(id,organization_id,lead_id,created_at,metadata,payload) values($1,$2,$3,$4,'{}','{}')`
	case 4:
		sql = `round_robin_logs(id,organization_id,lead_id,created_at,assigned_user_id) values($1,$2,$3,$4,$5)`
		args = append(args, user)
	case 5:
		sql = `assignments_log(id,organization_id,lead_id,created_at,new_user_id,created_by,reason) values($1,$2,$3,$4,$5,$5,'synthetic')`
		args = append(args, user)
	case 6:
		sql = `audit_logs(id,organization_id,entity_id,created_at,entity_type,user_id,action,old_data,new_data) values($1,$2,$3,$4,'lead',$5,'synthetic','{}','{"metadata":{"profile":{"cpf":"synthetic-only","rg":"synthetic-only"}},"deal_status":"won"}')`
		args = append(args, user)
	default:
		t.Fatal("invalid synthetic source rank")
	}
	pipelinePostgresExec(t, ctx, conn, base+sql, args...)
}
