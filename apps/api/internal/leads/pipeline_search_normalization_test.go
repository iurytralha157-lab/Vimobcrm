package leads

import (
	"errors"
	"fmt"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/searchtext"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestPipelineSearchParserTrimsLikeTheBrowserBeforeValidatingSize(t *testing.T) {
	for _, item := range []struct{ input, want string }{
		{"\ufeff Åsa \ufeff", "Åsa"}, {"\ufeff", ""},
		{"\ufeff" + strings.Repeat("a", 180) + "\ufeff", strings.Repeat("a", 180)},
		{"\ufeff" + strings.Repeat("🏠", 180) + "\ufeff", strings.Repeat("🏠", 180)},
		{"\u0085Asa\u0085", "\u0085Asa\u0085"}, {"A\ufeffsa", "A\ufeffsa"},
	} {
		filter, err := ParsePipelineBoardFilter(url.Values{"search": {item.input}})
		if err != nil || filter.Search != item.want {
			t.Fatalf("search parser input=%q got=%q want=%q err=%v", item.input, filter.Search, item.want, err)
		}
	}
	for _, input := range []string{
		strings.Repeat("a", 181), "\ufeff" + strings.Repeat("a", 181) + "\ufeff",
		strings.Repeat("🏠", 181), "\ufeffa\x00b\ufeff", "\u0085" + strings.Repeat("a", 180),
		// Counting decomposed/normalized output would incorrectly accept this.
		strings.Repeat("e\u0301", 91),
	} {
		if _, err := ParsePipelineBoardFilter(url.Values{"search": {input}}); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("invalid raw trimmed query was accepted: %q err=%v", input, err)
		}
	}
}

func TestPipelineSearchBuilderKeepsUnicodeSearchInsideScopedBoundSQL(t *testing.T) {
	placeholder := regexp.MustCompile(`\$(\d+)`)
	for organization := 1; organization <= 2; organization++ {
		id := func(group, entity int) string {
			return fmt.Sprintf("%08d-0000-4000-8000-%012d", group, organization*10+entity)
		}
		org, pipeline, stage := id(20000000, 1), id(30000000, 1), id(40000000, 1)
		team, tag, broker := id(50000000, 1), id(60000000, 1), id(10000000, 3)
		for _, profile := range []string{"admin", "leader", "user"} {
			actor := tenant.Context{OrganizationID: org, UserID: id(10000000, 1), MemberRole: "admin"}
			if profile != "admin" {
				actor.UserID, actor.MemberRole, actor.Permissions = broker, "user", []string{"lead_view_own"}
				if profile == "leader" {
					actor.UserID, actor.IsTeamLeader = id(10000000, 2), true
					actor.Permissions = append(actor.Permissions, "lead_view_team")
					actor.LedTeamIDs, actor.LedUserIDs = []string{team}, []string{broker}
				}
			}
			for _, combined := range []bool{false, true} {
				for _, item := range []struct{ query, pattern, digits string }{
					{"Åsa", "%asa%", ""}, {"Černý", "%cerny%", ""},
					{"\ufeffAsa\ufeff", "%asa%", ""}, {"ΟΣ", "%ος%", ""},
					{"（１１）９９９９９－８８８８", "%(11)99999-8888%", "11999998888"},
					{"11999998888", "%11999998888%", "11999998888"},
					{"１２３", "%123%", ""}, {"Lote １２３４", "%lote 1234%", ""},
					{"１２_３４", `%12\_34%`, ""}, {"１２%３４", `%12\%34%`, ""},
					{"١٢٣٤", "%١٢٣٤%", ""}, {"all", "%all%", ""},
					{"%' OR 1=1 --", `%\%' or 1=1 --%`, ""},
				} {
					name := fmt.Sprintf("org%d/%s/combined=%t/%s", organization, profile, combined, item.query)
					t.Run(name, func(t *testing.T) {
						filter, err := ParsePipelineBoardFilter(url.Values{"search": {item.query}, "pipelineId": {pipeline}, "stageId": {stage}})
						if err != nil {
							t.Fatal(err)
						}
						if combined {
							filter.TeamID, filter.FilterDealStatus, filter.FilterTags = team, "open", []string{tag}
						}
						where, args, err := buildPipelineLeadWhere(actor, filter)
						if err != nil {
							t.Fatal(err)
						}
						joined := strings.Join(where, " and ")
						if args[0] != org || args[2] != actor.UserID || where[0] != "l.organization_id = $1::uuid" ||
							args[1] != (profile == "admin") || args[3] != (profile != "user") {
							t.Fatalf("search changed organization/actor/permission scope: %#v", args)
						}
						for _, required := range []string{"l.pipeline_id = $5::uuid", "l.stage_id = $6::uuid", "private.queue_pool_read_access("} {
							if !strings.Contains(joined, required) {
								t.Fatalf("search lost existing scope %q", required)
							}
						}
						patternIndex := 7
						if combined {
							patternIndex = 9
							for _, required := range []string{"dtm.team_id = $7::uuid", "l.deal_status = $8", "lt.organization_id = $1::uuid", "lt.tag_id = any($"} {
								if !strings.Contains(joined, required) {
									t.Fatalf("search lost combined filter %q", required)
								}
							}
						}
						if args[patternIndex-1] != item.pattern {
							t.Fatalf("bound text pattern=%v want=%q", args[patternIndex-1], item.pattern)
						}
						searchClause := where[4]
						if combined {
							searchClause = where[6]
						}
						if !strings.HasPrefix(searchClause, "(") || !strings.HasSuffix(searchClause, ")") {
							t.Fatal("search/phone OR escaped the scoped predicate")
						}
						if item.digits != "" {
							if args[patternIndex] != "%"+item.digits+"%" || !strings.Contains(searchClause, searchtext.PipelinePhoneSQL("l.phone", fmt.Sprintf("$%d", patternIndex+1))) {
								t.Fatalf("normalized phone fallback missing: %s args=%#v", searchClause, args)
							}
						} else if strings.Contains(joined, "regexp_replace(") {
							t.Fatalf("non-phone/short query acquired an independent numeric match: %q", item.query)
						}
						if strings.Contains(item.query, "'") && strings.Contains(joined, item.query) {
							t.Fatal("untrusted query was interpolated into SQL")
						}
						seen := map[int]bool{}
						for _, token := range placeholder.FindAllStringSubmatch(joined, -1) {
							index, _ := strconv.Atoi(token[1])
							if index < 1 || index > len(args) {
								t.Fatalf("invalid placeholder %d / %d", index, len(args))
							}
							seen[index] = true
						}
						if len(seen) != len(args) {
							t.Fatalf("unused bound argument: %#v", args)
						}
					})
				}
			}
		}
	}
}
