package app

import (
	"bufio"
	"os"
	"regexp"
	"strings"
	"testing"
)

var registeredTeamRoutePattern = regexp.MustCompile(`(?m)^[ \t]*mux\.Handle\("([A-Z]+) ([^"]+)",.*http\.HandlerFunc\((?:teamsHandler\.[A-Za-z0-9_]+|roundRobinHandler\.GetTeamDistributionStats)\)`)

func TestEveryRegisteredTeamRouteIsDocumentedInOpenAPI(t *testing.T) {
	appSource, err := os.ReadFile("routes.go")
	if err != nil {
		t.Fatalf("read app routes: %v", err)
	}
	contractSource, err := os.ReadFile("../../../../packages/contracts/openapi/v1.yaml")
	if err != nil {
		t.Fatalf("read OpenAPI contract: %v", err)
	}

	registered := registeredTeamRoutePattern.FindAllStringSubmatch(string(appSource), -1)
	handlerRegistrations := strings.Count(string(appSource), "teamsHandler.") +
		strings.Count(string(appSource), "roundRobinHandler.GetTeamDistributionStats")
	if len(registered) == 0 || len(registered) != handlerRegistrations {
		t.Fatalf("parsed %d of %d registered Teams handler routes", len(registered), handlerRegistrations)
	}

	documented := documentedOpenAPIOperations(t, string(contractSource))
	seen := make(map[string]struct{}, len(registered))
	for _, match := range registered {
		method := strings.ToLower(match[1])
		path := match[2]
		key := method + " " + path
		if _, duplicate := seen[key]; duplicate {
			t.Fatalf("duplicate Teams route registration parsed for %s", key)
		}
		seen[key] = struct{}{}

		methods, pathDocumented := documented[path]
		if !pathDocumented {
			t.Errorf("registered Teams route %s is missing from OpenAPI paths", key)
			continue
		}
		if _, methodDocumented := methods[method]; !methodDocumented {
			t.Errorf("registered Teams route %s is missing its OpenAPI operation", key)
		}
	}
}

func TestMemberAvailabilityOpenAPIDocumentsOvernightRanges(t *testing.T) {
	contractSource, err := os.ReadFile("../../../../packages/contracts/openapi/v1.yaml")
	if err != nil {
		t.Fatalf("read OpenAPI contract: %v", err)
	}

	contract := string(contractSource)
	want := "Active non-all-day entries require different start_time and end_time; start_time after end_time crosses midnight."
	if count := strings.Count(contract, want); count != 2 {
		t.Fatalf("overnight availability description count = %d, want 2", count)
	}
	if strings.Contains(contract, "Active non-all-day entries require start_time before end_time.") {
		t.Fatal("OpenAPI still rejects valid overnight availability ranges")
	}
}

func documentedOpenAPIOperations(t *testing.T, source string) map[string]map[string]struct{} {
	t.Helper()

	operations := map[string]struct{}{
		"delete": {},
		"get":    {},
		"patch":  {},
		"post":   {},
		"put":    {},
	}
	documented := make(map[string]map[string]struct{})
	currentPath := ""
	scanner := bufio.NewScanner(strings.NewReader(source))
	for scanner.Scan() {
		line := strings.TrimSuffix(scanner.Text(), "\r")
		if strings.HasPrefix(line, "  /") && strings.HasSuffix(line, ":") {
			currentPath = strings.TrimSuffix(strings.TrimSpace(line), ":")
			documented[currentPath] = make(map[string]struct{})
			continue
		}
		if currentPath == "" {
			continue
		}
		if strings.HasPrefix(line, "    ") && !strings.HasPrefix(line, "      ") {
			candidate := strings.TrimSuffix(strings.TrimSpace(line), ":")
			if _, isOperation := operations[candidate]; isOperation {
				documented[currentPath][candidate] = struct{}{}
			}
			continue
		}
		if strings.TrimSpace(line) != "" && !strings.HasPrefix(line, "    ") {
			currentPath = ""
		}
	}
	if err := scanner.Err(); err != nil {
		t.Fatalf("scan OpenAPI contract: %v", err)
	}
	return documented
}
