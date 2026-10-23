package ai

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/schedule"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type agendaHistoryAIQuery struct {
	pgx.Tx
	query string
	args  []any
	err   error
}

func (query *agendaHistoryAIQuery) Query(_ context.Context, sql string, args ...any) (pgx.Rows, error) {
	query.query, query.args = sql, args
	return nil, query.err
}

func TestAIActivityContextAppliesCurrentAgendaScopeBeforeSummaryLimit(t *testing.T) {
	for _, role := range []string{"viewer", "leader", "admin", "owner", "superadmin", "module off", "view revoked"} {
		t.Run(role, func(t *testing.T) {
			actor := tenant.Context{OrganizationID: "10000000-0000-4000-8000-000000000001",
				UserID: "20000000-0000-4000-8000-000000000001", EnabledModules: []string{"agenda"},
				Permissions: []string{permissions.LeadViewAll, permissions.ScheduleView}}
			switch role {
			case "leader":
				actor.IsTeamLeader = true
			case "admin", "owner":
				actor.MemberRole = role
			case "superadmin":
				actor.IsSuperAdmin = true
			case "module off":
				actor.EnabledModules = nil
			case "view revoked":
				actor.Permissions = []string{permissions.LeadViewAll}
			}
			failure := errors.New("synthetic capture only")
			query := &agendaHistoryAIQuery{err: failure}
			leadID := "30000000-0000-4000-8000-000000000001"
			data, err := (Repository{}).loadLeadActivitiesWithQueryer(context.Background(), query, actor, leadID)
			if !errors.Is(err, failure) || data != nil {
				t.Fatalf("query failure returned a context: %v %v", data, err)
			}
			predicate := schedule.HistoryReadableRecordSQL(actor, "a", "type", "$4")
			index := strings.Index(query.query, "and "+predicate)
			if index < 0 || index > strings.Index(query.query, "order by a.created_at desc") || index > strings.Index(query.query, "limit 12") {
				t.Fatal("AI activity context bypasses Agenda or filters after its summary limit")
			}
			if len(query.args) != 8 || query.args[0] != actor.OrganizationID || query.args[1] != leadID || query.args[3] != actor.UserID {
				t.Fatal("AI activity context changed tenant/actor/property bindings")
			}
			if !strings.Contains(query.query, "activity_property.id is not null") || !strings.Contains(query.query, "'commission_percentage'") {
				t.Fatal("Agenda filter removed existing property redaction")
			}
		})
	}
}

func TestAIActivityContextStillRejectsMissingLeadPermissionBeforeQuery(t *testing.T) {
	query := &agendaHistoryAIQuery{err: errors.New("must not query")}
	_, err := (Repository{}).loadLeadActivitiesWithQueryer(context.Background(), query, tenant.Context{
		EnabledModules: []string{"agenda"}, Permissions: []string{permissions.ScheduleView},
	}, "30000000-0000-4000-8000-000000000001")
	if !errors.Is(err, ErrPermission) || query.query != "" {
		t.Fatal("Agenda access granted unrelated lead context")
	}
}
