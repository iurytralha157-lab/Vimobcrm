package leads

import (
	"context"
	"fmt"
	"regexp"
	"strconv"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const (
	stagePageOrg      = "11111111-1111-4111-8111-111111111111"
	stagePagePipeline = "22222222-2222-4222-8222-222222222222"
	stagePageStage    = "33333333-3333-4333-8333-333333333333"
	stagePageUser     = "44444444-4444-4444-8444-444444444444"
	stagePageTeam     = "55555555-5555-4555-8555-555555555555"
)

// Only transport rows are synthetic: the production SQL builder, argument
// binding, row scanner, operation capability and page assembly run unchanged.
type stagePageQueryer struct {
	data                      []PipelineBoardLead
	query                     string
	args                      []any
	calls, requestedLimit     int
	queryErr, rowErr, scanErr error
	scanErrorAt               int
	rows                      *stagePageRows
}

func (fixture *stagePageQueryer) QueryRow(context.Context, string, ...any) pgx.Row {
	panic("stage pagination must not issue a count or second query")
}

func (fixture *stagePageQueryer) Query(_ context.Context, query string, args ...any) (pgx.Rows, error) {
	fixture.calls++
	fixture.query, fixture.args = query, append([]any(nil), args...)
	if fixture.queryErr != nil {
		return nil, fixture.queryErr
	}
	limitMatch := regexp.MustCompile(`limit \$(\d+)`).FindStringSubmatch(query)
	if len(limitMatch) != 2 {
		return nil, fmt.Errorf("missing parameterized page limit")
	}
	limitPosition, _ := strconv.Atoi(limitMatch[1])
	fixture.requestedLimit = args[limitPosition-1].(int)
	var cursorTime *time.Time
	cursorID := ""
	if match := regexp.MustCompile(`\) < \(\$(\d+)::timestamptz, \$(\d+)::uuid\)`).FindStringSubmatch(query); len(match) == 3 {
		timePosition, _ := strconv.Atoi(match[1])
		idPosition, _ := strconv.Atoi(match[2])
		value := args[timePosition-1].(time.Time)
		cursorTime, cursorID = &value, args[idPosition-1].(string)
	}
	offset := 0
	if match := regexp.MustCompile(`offset \$(\d+)`).FindStringSubmatch(query); len(match) == 2 {
		position, _ := strconv.Atoi(match[1])
		offset = args[position-1].(int)
	}
	selected := []PipelineBoardLead{}
	for _, lead := range fixture.data {
		if cursorTime != nil && !(lead.BoardOrderAt.Before(*cursorTime) || (lead.BoardOrderAt.Equal(*cursorTime) && lead.ID < cursorID)) {
			continue
		}
		if offset > 0 {
			offset--
			continue
		}
		if len(selected) == fixture.requestedLimit {
			break
		}
		selected = append(selected, lead)
	}
	fixture.rows = &stagePageRows{data: selected, rowErr: fixture.rowErr, scanErr: fixture.scanErr, scanErrorAt: fixture.scanErrorAt}
	return fixture.rows, nil
}

type stagePageRows struct {
	pgx.Rows
	data            []PipelineBoardLead
	index           int
	closed          bool
	rowErr, scanErr error
	scanErrorAt     int
}

func (rows *stagePageRows) Next() bool {
	if rows.index >= len(rows.data) {
		return false
	}
	rows.index++
	return true
}

func (rows *stagePageRows) Scan(dest ...any) error {
	if rows.scanErr != nil && rows.index == rows.scanErrorAt {
		return rows.scanErr
	}
	if len(dest) != 31 {
		return fmt.Errorf("unexpected production lead projection: %d columns", len(dest))
	}
	lead := rows.data[rows.index-1]
	*dest[0].(*string), *dest[1].(*string) = lead.ID, lead.Name
	*dest[5].(*time.Time), *dest[6].(*time.Time) = lead.CreatedAt, lead.UpdatedAt
	for position, value := range map[int]string{4: "manual", 7: *lead.StageID, 8: *lead.AssignedUserID, 9: *lead.TeamID, 10: *lead.PipelineID, 14: lead.OrganizationID, 19: "open"} {
		*dest[position].(*pgtype.Text) = pgtype.Text{String: value, Valid: true}
	}
	*dest[13].(*pgtype.Timestamptz) = pgtype.Timestamptz{Time: *lead.BoardOrderAt, Valid: true}
	return nil
}

func (rows *stagePageRows) Err() error { return rows.rowErr }
func (rows *stagePageRows) Close()     { rows.closed = true }

func stagePageRecords(count int) []PipelineBoardLead {
	leads := make([]PipelineBoardLead, 0, count)
	base := time.Date(2026, 10, 20, 12, 0, 0, 123456000, time.UTC)
	for index := 0; index < count; index++ {
		clock := base.Add(-time.Duration(index) * time.Minute)
		stage, pipeline, user, team := stagePageStage, stagePagePipeline, stagePageUser, stagePageTeam
		leads = append(leads, PipelineBoardLead{
			ID: fmt.Sprintf("00000000-0000-4000-8000-%012d", 1000-index), Name: "Synthetic page lead",
			StageID: &stage, PipelineID: &pipeline, AssignedUserID: &user, TeamID: &team,
			OrganizationID: stagePageOrg, BoardOrderAt: &clock, CreatedAt: clock, UpdatedAt: clock,
		})
	}
	return leads
}

func stagePageActor() tenant.Context {
	return tenant.Context{OrganizationID: stagePageOrg, UserID: stagePageUser, MemberRole: "user", Permissions: []string{permissions.LeadViewOwn, permissions.LeadViewTeam, permissions.LeadOperate}}
}

func stagePageFilter(limit int) PipelineBoardFilter {
	return PipelineBoardFilter{PipelineID: stagePagePipeline, StageID: stagePageStage, Limit: limit}
}

func readStagePage(t *testing.T, fixture *stagePageQueryer, filter PipelineBoardFilter) PipelineStageLeadsResponse {
	t.Helper()
	page, err := readPipelineStagePageWithQueryer(context.Background(), fixture, stagePageActor(), filter)
	if err != nil {
		t.Fatal(err)
	}
	if fixture.calls != 1 || fixture.rows == nil || !fixture.rows.closed {
		t.Fatalf("page must close exactly one filtered query: %+v", fixture)
	}
	return page
}
