package distribution

import (
	"go/ast"
	"go/parser"
	"go/token"
	"path/filepath"
	"testing"
)

func intakeWiringFunction(t *testing.T, path, name string) *ast.FuncDecl {
	t.Helper()
	file, err := parser.ParseFile(token.NewFileSet(), path, nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	for _, declaration := range file.Decls {
		if function, ok := declaration.(*ast.FuncDecl); ok && function.Name.Name == name {
			return function
		}
	}
	t.Fatalf("missing intake owner %s in %s", name, path)
	return nil
}
func intakeWiringCalls(node ast.Node, name string) []token.Pos {
	var calls []token.Pos
	ast.Inspect(node, func(node ast.Node) bool {
		call, ok := node.(*ast.CallExpr)
		if !ok {
			return true
		}
		switch function := call.Fun.(type) {
		case *ast.SelectorExpr:
			if function.Sel.Name == name {
				calls = append(calls, call.Pos())
			}
		case *ast.Ident:
			if function.Name == name {
				calls = append(calls, call.Pos())
			}
		}
		return true
	})
	return calls
}

func TestEveryNewProviderIntakeValidatesEffectiveDestinationBeforeCommit(t *testing.T) {
	for _, owner := range []struct{ file, function string }{
		{"../meta/repository.go", "persistLeadWithIdentityMode"},
		{"../site/repository_public_contact.go", "CreatePublicContact"},
		{"../webhooks/repository.go", "receiveLeadWithIdentityMode"},
		{"../portals/repository_leads.go", "ProcessGrupoOLXLead"},
	} {
		t.Run(owner.file, func(t *testing.T) {
			function := intakeWiringFunction(t, filepath.FromSlash(owner.file), owner.function)
			guards, distribution, commits := intakeWiringCalls(function, "ValidatePersistedIntakeDestination"), intakeWiringCalls(function, "Distribute"), intakeWiringCalls(function, "Commit")
			if len(guards) != 1 || len(distribution) != 1 || len(commits) == 0 || guards[0] <= distribution[0] || guards[0] >= commits[len(commits)-1] {
				t.Fatal("provider can commit without final effective destination guard")
			}
			if len(intakeWiringCalls(function, "Rollback")) == 0 {
				t.Fatal("provider rejection does not own rollback")
			}
		})
	}
}

func TestCreateAndReentryGuardDestinationBeforeIdentityAndAfterDistribution(t *testing.T) {
	for _, name := range []string{"createNewLead", "registerReentry"} {
		function := intakeWiringFunction(t, "../leads/repository.go", name)
		guards, resolve, identity := intakeWiringCalls(function, "LockIntakePipelineDestination"), intakeWiringCalls(function, "resolveLeadIntakeDestination"), intakeWiringCalls(function, "lockLeadIntakeIdentity")
		if len(guards) != 1 || len(resolve) != 1 || len(identity) != 1 || guards[0] >= resolve[0] || guards[0] >= identity[0] {
			t.Fatalf("%s trusts preflight outside its transaction", name)
		}
		commits := intakeWiringCalls(function, "commitLeadImportCreation")
		finalName := "ValidatePersistedIntakeDestination"
		if name == "createNewLead" {
			finalName = "finishLeadCreationOutcome"
		}
		final := intakeWiringCalls(function, finalName)
		if len(final) != 1 || len(commits) != 1 || final[0] >= commits[0] {
			t.Fatalf("%s can commit an invalid effective destination", name)
		}
	}
	finish := intakeWiringFunction(t, "../leads/lead_creation_outcome.go", "finishLeadCreationOutcome")
	guards := intakeWiringCalls(finish, "LockIntakePipelineDestination")
	if len(guards) != 1 {
		t.Fatal("creation snapshot does not guard effective destination")
	}
	var snapshot *ast.FuncLit
	ast.Inspect(finish, func(node ast.Node) bool {
		entry, ok := node.(*ast.KeyValueExpr)
		if ok {
			key, ok := entry.Key.(*ast.Ident)
			if ok && key.Name == "snapshot" {
				snapshot, _ = entry.Value.(*ast.FuncLit)
			}
		}
		return true
	})
	if snapshot == nil || guards[0] < snapshot.Pos() || guards[0] > snapshot.End() {
		t.Fatal("guard must execute inside snapshot, before the non-deferred return")
	}
}
