package teams

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/realtime"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const pipelineEventTestID = "44444444-4444-4444-8444-444444444444"

func TestPipelineEventsPublishOnlyEffectiveCommittedChanges(t *testing.T) {
	for _, method := range []string{http.MethodPost, http.MethodDelete} {
		for _, scenario := range []string{"changed", "duplicate", "commit failed", "write failed", "readback failed", "permission denied", "outside led team"} {
			if method == http.MethodDelete && scenario == "readback failed" {
				continue
			}
			t.Run(method+"/"+scenario, func(t *testing.T) {
				actor := tenant.Context{OrganizationID: transactionTestOrganizationID, UserID: transactionTestUserID, MemberRole: "manager", Permissions: []string{permissions.PipelineManage, permissions.TeamView}}
				tx := &pipelineEventTestTx{affected: 1}
				want := http.StatusCreated
				if method == http.MethodDelete {
					want = http.StatusNoContent
				}
				switch scenario {
				case "duplicate":
					tx.affected = 0
				case "commit failed":
					tx.commitErr = errors.New("synthetic commit failure")
					want = http.StatusInternalServerError
				case "write failed":
					tx.writeErr = errors.New("synthetic write failure")
					want = http.StatusInternalServerError
				case "readback failed":
					tx.readbackErr = errors.New("synthetic readback failure")
					want = http.StatusInternalServerError
				case "permission denied":
					actor.Permissions = []string{permissions.TeamView}
					want = http.StatusForbidden
				case "outside led team":
					actor.IsTeamLeader = true
					actor.LedTeamIDs = []string{"55555555-5555-4555-8555-555555555555"}
					want = http.StatusForbidden
				}
				repo := Repository{beginMutationTx: func(context.Context) (pgx.Tx, error) { return tx, nil }}
				publisher := &pipelineEventRecorder{t: t, tx: tx}
				handler := NewHandler(repo, publisher)
				url := "/v1/team-pipelines?teamId=" + transactionTestTeamID + "&pipelineId=" + pipelineEventTestID
				body := `{"teamId":"` + transactionTestTeamID + `","pipelineId":"` + pipelineEventTestID + `"}`
				request := httptest.NewRequest(method, url, strings.NewReader(body))
				request = request.WithContext(tenant.ContextWithTenant(context.Background(), actor))
				response := httptest.NewRecorder()
				if method == http.MethodPost {
					handler.AssignPipelineToTeam(response, request)
				} else {
					handler.RemovePipelineFromTeam(response, request)
				}
				if response.Code != want {
					t.Fatalf("status=%d want=%d body=%s", response.Code, want, response.Body.String())
				}
				if scenario != "changed" {
					if len(publisher.events) != 0 {
						t.Fatalf("refused/no-op mutation published: %#v", publisher.events)
					}
					return
				}
				if len(publisher.events) != 1 {
					t.Fatalf("events=%#v", publisher.events)
				}
				event := publisher.events[0]
				kind := "team.pipeline.linked"
				if method == http.MethodDelete {
					kind = "team.pipeline.unlinked"
				}
				if event.Type != kind || event.OrganizationID != transactionTestOrganizationID || event.UserID != transactionTestUserID || len(event.Data) != 2 || event.Data["teamId"] != transactionTestTeamID || event.Data["pipelineId"] != pipelineEventTestID {
					t.Fatalf("incorrect event scope/data: %#v", event)
				}
			})
		}
	}
}

type pipelineEventRecorder struct {
	t      *testing.T
	tx     *pipelineEventTestTx
	events []realtime.Event
}

func (p *pipelineEventRecorder) Publish(event realtime.Event) {
	if p.tx.commitCalls != 1 || p.tx.commitErr != nil {
		p.t.Fatal("pipeline event published before successful commit")
	}
	p.events = append(p.events, event)
}

type pipelineEventTestTx struct {
	teamMutationTestTx
	affected                         int64
	commitErr, writeErr, readbackErr error
}

func (tx *pipelineEventTestTx) Commit(context.Context) error { tx.commitCalls++; return tx.commitErr }
func (tx *pipelineEventTestTx) Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	if strings.Contains(sql, "public.team_pipelines") {
		if len(args) != 3 || args[0] != transactionTestOrganizationID || args[1] != transactionTestTeamID || args[2] != pipelineEventTestID {
			return pgconn.CommandTag{}, errors.New("wrong tenant or relation mutation")
		}
		if tx.writeErr != nil {
			return pgconn.CommandTag{}, tx.writeErr
		}
		if tx.affected == 0 {
			return pgconn.NewCommandTag("DELETE 0"), nil
		}
		return pgconn.NewCommandTag("DELETE 1"), nil
	}
	return tx.teamMutationTestTx.Exec(ctx, sql, args...)
}
func (tx *pipelineEventTestTx) QueryRow(ctx context.Context, sql string, args ...any) pgx.Row {
	if strings.Contains(sql, "from public.team_pipelines tp") {
		if tx.readbackErr != nil {
			return teamMutationErrorRow{err: tx.readbackErr}
		}
		return pipelineEventRelationRow{}
	}
	return tx.teamMutationTestTx.QueryRow(ctx, sql, args...)
}

type pipelineEventRelationRow struct{}

func (pipelineEventRelationRow) Scan(dest ...any) error {
	values := []string{"66666666-6666-4666-8666-666666666666", transactionTestTeamID, pipelineEventTestID, "2026-10-13T00:00:00Z", pipelineEventTestID, "Pipeline", transactionTestTeamID, "Equipe"}
	for index, value := range values {
		*(dest[index].(*string)) = value
	}
	return nil
}
