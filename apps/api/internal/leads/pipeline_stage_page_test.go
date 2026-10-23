package leads

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestPipelineStagePageAlwaysSerializesContinuation(t *testing.T) {
	payload, err := json.Marshal(PipelineStageLeadsResponse{
		StageID: "11111111-1111-4111-8111-111111111111", Leads: []PipelineBoardLead{},
	})
	if err != nil {
		t.Fatal(err)
	}
	var response map[string]any
	if err := json.Unmarshal(payload, &response); err != nil {
		t.Fatal(err)
	}
	if hasMore, exists := response["hasMore"].(bool); !exists || hasMore {
		t.Fatalf("empty page must explicitly confirm hasMore:false, got %s", payload)
	}
}

func TestPipelineStagePageReadsOneSentinelWithinPublicLimit(t *testing.T) {
	for _, limit := range []int{1, 12, 100} {
		counts := []int{0, limit, limit + 1, limit + 2}
		if limit > 1 {
			counts = append(counts, limit-1)
		}
		for _, count := range counts {
			t.Run(fmt.Sprintf("limit%d/available%d", limit, count), func(t *testing.T) {
				fixture := &stagePageQueryer{data: stagePageRecords(count)}
				filter := stagePageFilter(limit)
				original := filter
				page := readStagePage(t, fixture, filter)
				want := min(limit, count)
				if page.StageID != stagePageStage || len(page.Leads) != want || page.HasMore != (count > limit) || fixture.requestedLimit != limit+1 || !reflect.DeepEqual(filter, original) {
					t.Fatalf("page=%+v requested=%d input=%+v", page, fixture.requestedLimit, filter)
				}
				if page.Leads == nil || (page.HasMore && cap(page.Leads) > limit) {
					t.Fatal("returned page was null or retained append capacity for the sentinel")
				}
				for index, lead := range page.Leads {
					if lead.ID != fixture.data[index].ID || lead.OrganizationID != stagePageOrg || !lead.CanOperate {
						t.Fatalf("production scan/capability/order changed at card %d: %+v", index, lead)
					}
				}
				payload, err := json.Marshal(page)
				if err != nil || (count > limit && strings.Contains(string(payload), fixture.data[limit].ID)) {
					t.Fatalf("sentinel was serialized or page failed: %s %v", payload, err)
				}
			})
		}
	}
}

func TestPipelineStagePageBoundsDirectCallerLimit(t *testing.T) {
	for _, scenario := range []struct{ input, want int }{{0, 12}, {-1, 12}, {101, 100}, {int(^uint(0) >> 1), 100}} {
		t.Run(fmt.Sprint(scenario.input), func(t *testing.T) {
			fixture := &stagePageQueryer{data: stagePageRecords(102)}
			page := readStagePage(t, fixture, stagePageFilter(scenario.input))
			if len(page.Leads) != scenario.want || fixture.requestedLimit != scenario.want+1 || !page.HasMore {
				t.Fatalf("unbounded/overflowing page: count=%d read=%d hasMore=%v", len(page.Leads), fixture.requestedLimit, page.HasMore)
			}
		})
	}
}

func TestPipelineStagePageContinuesBeyondAnOlderBoardTotal(t *testing.T) {
	// The board had 24 matching cards and showed 12. A team membership change
	// makes an existing 25th card match without changing any card's order clock.
	fixture := &stagePageQueryer{data: stagePageRecords(25)}
	filter := stagePageFilter(12)
	filter.CursorBefore, filter.CursorBeforeID = fixture.data[11].BoardOrderAt, fixture.data[11].ID
	filter.Offset = 12
	page := readStagePage(t, fixture, filter)
	if len(page.Leads) != 12 || !page.HasMore || page.Leads[11].ID != fixture.data[23].ID {
		t.Fatalf("old board total stopped at 24: %+v", page)
	}
	last := page.Leads[len(page.Leads)-1]
	filter.CursorBefore, filter.CursorBeforeID = last.BoardOrderAt, last.ID
	fixture.calls = 0
	final := readStagePage(t, fixture, filter)
	if len(final.Leads) != 1 || final.HasMore || final.Leads[0].ID != fixture.data[24].ID {
		t.Fatalf("sentinel was skipped instead of returned next: %+v", final)
	}
}

func TestPipelineStagePageKeepsCursorTieBreakAndOffset(t *testing.T) {
	for _, cursor := range []bool{false, true} {
		t.Run(fmt.Sprintf("cursor%v", cursor), func(t *testing.T) {
			fixture := &stagePageQueryer{data: stagePageRecords(5)}
			for index := range fixture.data {
				fixture.data[index].BoardOrderAt = fixture.data[0].BoardOrderAt
			}
			filter := stagePageFilter(2)
			filter.Offset = 2
			if cursor {
				filter.CursorBefore, filter.CursorBeforeID = fixture.data[1].BoardOrderAt, fixture.data[1].ID
				filter.Offset = 999 // ignored when the keyset cursor is present
			}
			page := readStagePage(t, fixture, filter)
			if len(page.Leads) != 2 || !page.HasMore || page.Leads[0].ID != fixture.data[2].ID || page.Leads[1].ID != fixture.data[3].ID {
				t.Fatalf("cursor/offset changed: %+v", page)
			}
			if strings.Contains(fixture.query, " offset $") == cursor || !strings.Contains(fixture.query, "desc, l.id desc") {
				t.Fatal("production cursor order or offset mode changed")
			}
		})
	}
}

func TestPipelineStagePagePreservesTenantACLAndSelectedTeamFilters(t *testing.T) {
	for _, org := range []string{stagePageOrg, "66666666-6666-4666-8666-666666666666"} {
		for _, role := range []string{"admin", "leader", "user"} {
			t.Run(org+"/"+role, func(t *testing.T) {
				fixture := &stagePageQueryer{}
				actor := stagePageActor()
				actor.OrganizationID, actor.MemberRole = org, role
				if role == "leader" {
					actor.MemberRole, actor.IsTeamLeader = "user", true
				}
				filter := stagePageFilter(12)
				filter.TeamID, filter.Search, filter.FilterDealStatus = stagePageTeam, "Synthetic %", "open"
				_, err := readPipelineStagePageWithQueryer(context.Background(), fixture, actor, filter)
				if err != nil {
					t.Fatal(err)
				}
				for _, clause := range []string{"l.organization_id = $1::uuid", "l.pipeline_id = $", "l.stage_id = $", "public.team_members", "l.deal_status = $", "visible_property.organization_id = l.organization_id"} {
					if !strings.Contains(fixture.query, clause) {
						t.Fatalf("page dropped production scope %q", clause)
					}
				}
				if fixture.args[0] != org || fixture.args[1] != canViewAllLeads(actor) || fixture.args[2] != actor.UserID || fixture.args[3] != actor.HasPermission("lead_view_team") {
					t.Fatalf("tenant/permission argument binding changed: %#v", fixture.args[:4])
				}
				for _, expected := range []any{stagePagePipeline, stagePageStage, stagePageTeam, "open", "%synthetic \\%%"} {
					if !containsStagePageArgument(fixture.args, expected) {
						t.Fatalf("filter was not parameterized: %v in %#v", expected, fixture.args)
					}
				}
			})
		}
	}
}

func containsStagePageArgument(args []any, expected any) bool {
	for _, actual := range args {
		if reflect.DeepEqual(actual, expected) {
			return true
		}
	}
	return false
}

func TestPipelineStagePageFailureNeverReturnsPartialPage(t *testing.T) {
	for _, phase := range []string{"query", "scan", "rows"} {
		t.Run(phase, func(t *testing.T) {
			failure := errors.New("synthetic page " + phase + " failure")
			fixture := &stagePageQueryer{data: stagePageRecords(4)}
			switch phase {
			case "query":
				fixture.queryErr = failure
			case "scan":
				fixture.scanErr, fixture.scanErrorAt = failure, 2
			case "rows":
				fixture.rowErr = failure
			}
			page, err := readPipelineStagePageWithQueryer(context.Background(), fixture, stagePageActor(), stagePageFilter(2))
			if !errors.Is(err, failure) || page.StageID != "" || page.Leads != nil || page.HasMore || fixture.calls != 1 {
				t.Fatalf("failure returned partial metadata/cards: %+v %v", page, err)
			}
			if phase != "query" && (fixture.rows == nil || !fixture.rows.closed) {
				t.Fatal("failed page did not close rows")
			}
		})
	}
}

func TestPipelineStagePageInvalidDestinationStopsBeforePool(t *testing.T) {
	for _, filter := range []PipelineBoardFilter{
		{PipelineID: stagePagePipeline, StageID: "invalid"},
		{StageID: stagePageStage},
		{PipelineID: "invalid", StageID: stagePageStage},
	} {
		if _, err := (Repository{}).ListPipelineStageLeads(context.Background(), tenant.Context{}, filter); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("invalid destination did not fail before pool: %v", err)
		}
	}
	fixture := &stagePageQueryer{}
	filter := stagePageFilter(12)
	filter.TeamID = "invalid"
	page, err := readPipelineStagePageWithQueryer(context.Background(), fixture, stagePageActor(), filter)
	if !errors.Is(err, ErrInvalidInput) || fixture.calls != 0 || page.Leads != nil {
		t.Fatalf("invalid filter reached the queryer: %+v %v", page, err)
	}
}

func TestPipelineStagePageCursorKeepsMicrosecondPrecision(t *testing.T) {
	fixture := &stagePageQueryer{data: stagePageRecords(2)}
	filter := stagePageFilter(1)
	value := fixture.data[0].BoardOrderAt.Add(time.Microsecond)
	filter.CursorBefore, filter.CursorBeforeID = &value, fixture.data[0].ID
	page := readStagePage(t, fixture, filter)
	if page.Leads[0].ID != fixture.data[0].ID || !containsStagePageArgument(fixture.args, value) || !page.HasMore {
		t.Fatal("page cursor lost its exact timestamp")
	}
}
