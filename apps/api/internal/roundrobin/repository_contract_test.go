package roundrobin

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"strings"
	"testing"
)

func TestQueueReadContractsUseCanonicalLogCounters(t *testing.T) {
	for _, functionName := range []string{"List", "Get"} {
		t.Run(functionName, func(t *testing.T) {
			source := repositoryFunctionSource(t, functionName)

			requireRepositoryFragments(t, source,
				"coalesce(latest_log.current_position, rr.current_position, 0)",
				"latest.metadata->>'candidate_position'",
				"latest.reason = 'canonical_round_robin'",
				"order by latest.created_at desc, latest.id desc",
				"select count(*)::bigint as total",
				"coalesce(logs.total, 0)",
			)
			requireRepositoryFragmentAbsent(t, source, "coalesce(rr.current_position, 0)")
		})
	}
}

func TestMemberReadContractsPreferCanonicalMemberID(t *testing.T) {
	for _, functionName := range []string{"listMembers", "getMember"} {
		t.Run(functionName, func(t *testing.T) {
			source := repositoryFunctionSource(t, functionName)

			requireRepositoryFragments(t, source,
				"rrl.member_id = rrm.id",
				"rrl.member_id is null",
				"rrl.assigned_user_id = rrm.user_id",
				"rrl.metadata->>'member_id' = rrm.id::text",
			)
			requireRepositoryOrder(t, source, "rrl.member_id is null", "rrl.assigned_user_id = rrm.user_id")
		})
	}
}

func TestDirectMemberContextUsesTenantScopedActiveTeamMembership(t *testing.T) {
	source := repositoryFunctionSource(t, "activeUserTeamIDs")

	requireRepositoryFragments(t, source,
		"tm.organization_id = $1::uuid",
		"tm.user_id = $2::uuid",
		"t.organization_id = tm.organization_id",
		"coalesce(t.is_active, true) = true",
		"coalesce(tm.is_active, true) = true",
	)
}

func TestDirectMemberResolutionValidatesUserBeforeTeamContext(t *testing.T) {
	source := repositoryFunctionSource(t, "resolveMemberEntry")

	requireRepositoryOrder(t, source, "repo.validateUser", "repo.activeUserTeamIDs")
	requireRepositoryOrder(t, source, "repo.activeUserTeamIDs", "resolveDirectUserTeamID")
}

func repositoryFunctionSource(t *testing.T, functionName string) string {
	t.Helper()

	source, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatalf("read repository.go: %v", err)
	}

	files := token.NewFileSet()
	parsed, err := parser.ParseFile(files, "repository.go", source, 0)
	if err != nil {
		t.Fatalf("parse repository.go: %v", err)
	}
	for _, declaration := range parsed.Decls {
		function, ok := declaration.(*ast.FuncDecl)
		if !ok || function.Name.Name != functionName {
			continue
		}
		start := files.Position(function.Pos()).Offset
		end := files.Position(function.End()).Offset
		return string(source[start:end])
	}

	t.Fatalf("function %s not found in repository.go", functionName)
	return ""
}

func requireRepositoryFragments(t *testing.T, source string, fragments ...string) {
	t.Helper()
	for _, fragment := range fragments {
		if !strings.Contains(source, fragment) {
			t.Fatalf("repository contract is missing %q", fragment)
		}
	}
}

func requireRepositoryFragmentAbsent(t *testing.T, source string, fragment string) {
	t.Helper()
	if strings.Contains(source, fragment) {
		t.Fatalf("repository contract still contains forbidden fragment %q", fragment)
	}
}

func requireRepositoryOrder(t *testing.T, source string, first string, second string) {
	t.Helper()
	firstIndex := strings.Index(source, first)
	secondIndex := strings.Index(source, second)
	if firstIndex < 0 || secondIndex < 0 || firstIndex >= secondIndex {
		t.Fatalf("expected %q before %q", first, second)
	}
}
