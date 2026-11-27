package leads

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
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
	lead, team, first, second, foreign := pipelinePostgresID(600), pipelinePostgresID(601), pipelinePostgresID(603), pipelinePostgresID(604), pipelinePostgresID(605)
	f.exec(t, `insert into public.teams(id,organization_id,name) values($1,$2,'Lead team')`, team, f.org)
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
	t.Run("foreign and inactive organization members are rejected", func(t *testing.T) {
		if _, err := assign(&foreign, &initial); !errors.Is(err, ErrInvalidReference) {
			t.Fatalf("foreign member=%v", err)
		}
		noEffects(t)
		f.exec(t, `update public.organization_members set is_active=false where user_id=$1::uuid`, first)
		defer f.exec(t, `update public.organization_members set is_active=true where user_id=$1::uuid`, first)
		if _, err := assign(&first, &initial); !errors.Is(err, ErrInvalidReference) {
			t.Fatalf("inactive member=%v", err)
		}
		noEffects(t)
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

func TestLeadOwnerTransfersAcrossTeamsLocalPostgres(t *testing.T) {
	f := newAutomationStageFixture(t, "tags", "lead_tags")
	f.exec(t, `create function private.prepare_queue_manual_transfer(uuid,uuid,uuid,uuid) returns boolean language sql as 'select true'`)
	source, firstTeam, secondTeam, inactiveTeam := pipelinePostgresID(611), pipelinePostgresID(612), pipelinePostgresID(613), pipelinePostgresID(614)
	recipient, unteamed := pipelinePostgresID(615), pipelinePostgresID(616)
	f.exec(t, `update public.organization_members set role='user' where user_id=$1::uuid`, f.user)
	f.exec(t, `insert into public.teams(id,organization_id,name,is_active) values
		($1,$5,'Source',true),($2,$5,'First',true),($3,$5,'Second',true),($4,$5,'Inactive',false)`, source, firstTeam, secondTeam, inactiveTeam, f.org)
	f.exec(t, `insert into public.users(id,organization_id,name,email,role) values
		($1,$3,'Recipient','recipient@example.test','user'),($2,$3,'No team','unteamed@example.test','user')`, recipient, unteamed, f.org)
	f.exec(t, `insert into public.organization_members(organization_id,user_id,role) values($1,$2,'user'),($1,$3,'user')`, f.org, recipient, unteamed)
	f.exec(t, `insert into public.team_members(team_id,organization_id,user_id,membership_generation,is_active,created_at) values
		($1,$5,$8,1,true,'2026-01-01'),($2,$5,$6,1,true,'2026-02-01'),($3,$5,$6,1,true,'2026-03-01'),
		($4,$5,$6,1,true,'2025-01-01'),($1,$5,$6,0,true,'2025-01-01'),($3,$5,$7,1,false,'2026-01-01')`,
		source, firstTeam, secondTeam, inactiveTeam, f.org, recipient, unteamed, f.user)

	actor, err := f.resolver.Resolve(f.ctx, f.user, f.org)
	if err != nil {
		t.Fatal(err)
	}
	otherUser, err := f.resolver.Resolve(f.ctx, recipient, f.org)
	if err != nil {
		t.Fatal(err)
	}
	handler := NewHandler(f.repo)
	for index, test := range []struct {
		name, originalTeam, targetUser, destinationTeam string
	}{
		{"across teams with expired source membership", source, recipient, firstTeam},
		{"retain the current team when eligible", secondTeam, recipient, secondTeam},
		{"clear the former team when recipient has no active team", source, unteamed, ""},
	} {
		t.Run(test.name, func(t *testing.T) {
			leadID := pipelinePostgresID(620 + index)
			f.command(t, 620+index, f.open, nil)
			f.exec(t, `update public.leads set team_id=$2::uuid where id=$1::uuid`, leadID, test.originalTeam)
			var revision time.Time
			if err := f.conn.QueryRow(f.ctx, `select updated_at from public.leads where id=$1`, leadID).Scan(&revision); err != nil {
				t.Fatal(err)
			}
			body, err := json.Marshal(map[string]any{"assignedUserId": test.targetUser, "expectedUpdatedAt": revision})
			if err != nil {
				t.Fatal(err)
			}
			transfer := func(transferActor tenant.Context) *httptest.ResponseRecorder {
				request := httptest.NewRequest(http.MethodPost, "/v1/leads/"+leadID+"/assign", strings.NewReader(string(body)))
				request.SetPathValue("id", leadID)
				response := httptest.NewRecorder()
				handler.Assign(response, request.WithContext(tenant.ContextWithTenant(request.Context(), transferActor)))
				return response
			}
			if denied := transfer(otherUser); denied.Code != http.StatusForbidden {
				t.Fatalf("non-owner transfer status=%d body=%s", denied.Code, denied.Body)
			}
			response := transfer(actor)
			if response.Code != http.StatusOK {
				t.Fatalf("owner transfer status=%d body=%s", response.Code, response.Body)
			}
			var receipt struct{ Data Lead }
			if err := json.Unmarshal(response.Body.Bytes(), &receipt); err != nil {
				t.Fatal(err)
			}
			if receipt.Data.AssignedUserID != test.targetUser || receipt.Data.TeamID != test.destinationTeam ||
				receipt.Data.PipelineID != f.pipeline || receipt.Data.StageID != f.open {
				t.Fatalf("unexpected assignment receipt: %+v", receipt.Data)
			}
			newOwner, err := f.resolver.Resolve(f.ctx, test.targetUser, f.org)
			if err != nil {
				t.Fatal(err)
			}
			persisted, err := f.repo.Get(f.ctx, newOwner, leadID)
			if err != nil || persisted.AssignedUserID != test.targetUser || persisted.TeamID != test.destinationTeam {
				t.Fatalf("new owner read assignee=%q team=%q err=%v", persisted.AssignedUserID, persisted.TeamID, err)
			}
			if _, err = f.repo.Get(f.ctx, actor, leadID); !errors.Is(err, ErrLeadNotFound) {
				t.Fatalf("previous owner read err=%v", err)
			}
			if f.count(t, "public.assignments_log") != index+1 || f.count(t, "public.notifications") != index+1 {
				t.Fatal("successful transfer must record one assignment and one notification")
			}
		})
	}
}

func timePointer(value time.Time) *time.Time { return &value }
