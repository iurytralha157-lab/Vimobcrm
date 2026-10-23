package leads

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

// Exercises F05/F06 through the real repository and SQL against the owned
// synthetic database. Queue-pool behavior is tested by its own runtime suite;
// these leads are ordinary manually assigned leads, with no managed queue.
func TestPipelineAssignmentRevisionAndTeamLocalPostgres(t *testing.T) {
	f := newAutomationStageFixture(t)
	f.exec(t, `create function private.prepare_queue_manual_transfer(uuid,uuid,uuid,uuid) returns boolean language sql as 'select true'`)
	actor, err := f.resolver.Resolve(f.ctx, f.user, f.org)
	if err != nil {
		t.Fatal(err)
	}
	f.command(t, 600, f.open, nil)
	lead, team, otherTeam, first, second, foreign := pipelinePostgresID(600), pipelinePostgresID(601), pipelinePostgresID(602), pipelinePostgresID(603), pipelinePostgresID(604), pipelinePostgresID(605)
	f.exec(t, `insert into public.teams(id,organization_id,name) values($1,$3,'Lead team'),($2,$3,'Other team')`, team, otherTeam, f.org)
	f.exec(t, `insert into public.users(id,organization_id,name,email,role) values($1,$4,'First','first@example.test','user'),($2,$4,'Second','second@example.test','user'),($3,$5,'Foreign','foreign@example.test','user')`, first, second, foreign, f.org, pipelinePostgresID(99))
	f.exec(t, `insert into public.organization_members(organization_id,user_id,role) values($1,$2,'user'),($1,$3,'user'),($4,$5,'user')`, f.org, first, second, pipelinePostgresID(99), foreign)
	f.exec(t, `insert into public.team_members(team_id,organization_id,user_id,membership_generation) values($1,$2,$3,1),($1,$2,$4,1)`, team, f.org, first, second)
	f.exec(t, `update public.leads set team_id=$2::uuid where id=$1::uuid`, lead, team)
	readRevision := func(t *testing.T) time.Time {
		t.Helper()
		var revision time.Time
		if err := f.conn.QueryRow(f.ctx, `select updated_at from public.leads where id=$1`, lead).Scan(&revision); err != nil {
			t.Fatal(err)
		}
		return revision
	}
	initial := readRevision(t)
	noEffects := func(t *testing.T) {
		t.Helper()
		if f.count(t, "public.assignments_log") != 0 || f.count(t, "public.notifications") != 0 || f.count(t, "public.activities") != 0 {
			t.Fatal("rejected assignment produced effects")
		}
	}
	assign := func(user *string, revision *time.Time) (Lead, error) {
		return f.repo.Assign(f.ctx, actor, lead, assignInput{AssignedUserID: user, ExpectedUpdatedAt: revision})
	}

	t.Run("missing or stale revision rejects before effects", func(t *testing.T) {
		for _, revision := range []*time.Time{nil, timePointer(initial.Add(-time.Microsecond))} {
			_, err := assign(&first, revision)
			if !errors.Is(err, ErrLeadChanged) {
				t.Fatalf("revision error=%v", err)
			}
			noEffects(t)
			response := httptest.NewRecorder()
			writeLeadError(response, httptest.NewRequest(http.MethodPost, "/v1/leads/synthetic/assign", nil), err)
			if response.Code != 409 || !strings.Contains(response.Body.String(), "lead_changed") {
				t.Fatal("stale transfer must have stable 409")
			}
		}
	})
	t.Run("foreign inactive and stale team epoch rejected", func(t *testing.T) {
		if _, err := assign(&foreign, &initial); !errors.Is(err, ErrInvalidReference) {
			t.Fatalf("foreign member=%v", err)
		}
		noEffects(t)
		for _, test := range []struct {
			name, change, restore   string
			changeArgs, restoreArgs []any
		}{
			{"other team", `update public.team_members set team_id=$2::uuid where user_id=$1::uuid`, `update public.team_members set team_id=$2::uuid where user_id=$1::uuid`, []any{first, otherTeam}, []any{first, team}},
			{"inactive team member", `update public.team_members set is_active=false where user_id=$1::uuid`, `update public.team_members set is_active=true where user_id=$1::uuid`, []any{first}, []any{first}},
			{"stale membership generation", `update public.organization_members set membership_generation=2 where user_id=$1::uuid`, `update public.organization_members set membership_generation=1 where user_id=$1::uuid`, []any{first}, []any{first}},
		} {
			t.Run(test.name, func(t *testing.T) {
				f.exec(t, test.change, test.changeArgs...)
				defer f.exec(t, test.restore, test.restoreArgs...)
				if _, err := assign(&first, &initial); !errors.Is(err, ErrLeadAssigneeTeamMismatch) {
					t.Fatalf("team guard=%v", err)
				}
				noEffects(t)
			})
		}
	})
	t.Run("concurrent transfers acknowledge one revision and notify once", func(t *testing.T) {
		start := make(chan struct{})
		failures := make([]error, 2)
		var wait sync.WaitGroup
		for index, target := range []string{first, second} {
			wait.Add(1)
			go func() { defer wait.Done(); <-start; _, failures[index] = assign(&target, &initial) }()
		}
		close(start)
		wait.Wait()
		successes, conflicts := 0, 0
		for _, err := range failures {
			if err == nil {
				successes++
			} else if errors.Is(err, ErrLeadChanged) {
				conflicts++
			} else {
				t.Fatalf("concurrent transfer=%v", err)
			}
		}
		if successes != 1 || conflicts != 1 || f.count(t, "public.assignments_log") != 1 || f.count(t, "public.notifications") != 1 {
			t.Fatal("revision CAS did not select exactly one transfer")
		}
	})
	t.Run("unassign retains team and does not notify or replay stale transfer", func(t *testing.T) {
		revision := readRevision(t)
		leadResult, err := assign(nil, &revision)
		if err != nil || leadResult.AssignedUserID != "" || leadResult.TeamID != team {
			t.Fatalf("unassign=%v", err)
		}
		if f.count(t, "public.assignments_log") != 2 || f.count(t, "public.notifications") != 1 {
			t.Fatal("unassign duplicated or missed effects")
		}
		_, err = assign(&first, &revision)
		if !errors.Is(err, ErrLeadChanged) {
			t.Fatalf("stale after unassign=%v", err)
		}
		if f.count(t, "public.assignments_log") != 2 || f.count(t, "public.notifications") != 1 {
			t.Fatal("stale transfer after unassign produced effects")
		}
	})
}

func timePointer(value time.Time) *time.Time { return &value }
