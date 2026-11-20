package leads

import (
	"context"
	"errors"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

type importConnectionTestTx struct {
	pgx.Tx
	query string
	args  []any
}
type importConnectionTestRow struct{}

var errImportPreflightTest = errors.New("synthetic preflight sentinel")

func (importConnectionTestRow) Scan(...any) error { return errImportPreflightTest }
func (tx *importConnectionTestTx) QueryRow(_ context.Context, query string, args ...any) pgx.Row {
	tx.query, tx.args = query, args
	return importConnectionTestRow{}
}

func TestKeyedImportPreflightUsesClaimedTransactionWithoutPool(t *testing.T) {
	tx := &importConnectionTestTx{}
	request := &leadImportRequest{tx: tx}
	repo := Repository{} // No pool: any nested pool access panics/fails this test.
	if repo.leadCreationReadQueryer(request) != tx {
		t.Fatal("keyed read did not reuse its claimed transaction")
	}
	viewer := tenant.Context{OrganizationID: importDistributionOrganizationID, UserID: importDistributionActorID, MemberRole: "admin"}
	_, err := repo.Create(context.Background(), viewer, createInput{Name: "Synthetic contact", ImportMode: true, PipelineID: stringPointer("33333333-3333-4333-8333-333333333333"), AutoDistribute: boolPointer(false)}, request)
	if !errors.Is(err, errImportPreflightTest) || tx.query == "" {
		t.Fatalf("preflight bypassed claimed connection: %v", err)
	}
	for _, legacy := range []bool{false, true} {
		tx.query = ""
		phone := "+5511999998888"
		if legacy {
			_, err = repo.findExistingLeadByPhoneLegacy(context.Background(), viewer.OrganizationID, &phone, tx)
		} else {
			_, err = repo.findExistingLeadByPhone(context.Background(), viewer.OrganizationID, &phone, "unscoped", tx)
		}
		if !errors.Is(err, errImportPreflightTest) || tx.query == "" || tx.args[0] != viewer.OrganizationID {
			t.Fatalf("identity lookup reacquired pool or lost scope: %v", err)
		}
	}
}

func TestEveryCreatePreflightQueryUsesTheSelectedReader(t *testing.T) {
	_, createBody := readRepositoryMethod(t, "lead_creation.go", "Create")
	wanted := map[string]bool{"resolveDestination": false, "validateAssignedUser": false, "validateLeadTeam": false, "validateRequestedRoundRobin": false, "resolveLeadIntakeDestination": false, "legacyLeadPhoneUniquenessActive": false, "findExistingLeadByPhoneLegacy": false, "findExistingLeadByPhone": false}
	ast.Inspect(createBody, func(node ast.Node) bool {
		call, ok := node.(*ast.CallExpr)
		if !ok {
			return true
		}
		name := ""
		switch fn := call.Fun.(type) {
		case *ast.SelectorExpr:
			name = fn.Sel.Name
		case *ast.Ident:
			name = fn.Name
		}
		if name == "Pool" {
			t.Error("Create reacquires pool while an import transaction may own the only connection")
		}
		if _, needed := wanted[name]; !needed {
			return true
		}
		index := 1
		if name == "findExistingLeadByPhone" || name == "findExistingLeadByPhoneLegacy" {
			index = len(call.Args) - 1
		}
		reader, ok := call.Args[index].(*ast.Ident)
		if !ok || reader.Name != "readQueryer" {
			t.Errorf("%s preflight bypasses selected reader", name)
		}
		wanted[name] = true
		return true
	})
	for name, found := range wanted {
		if !found {
			t.Errorf("preflight regression must cover %s", name)
		}
	}
}

func readRepositoryMethod(t *testing.T, path string, name string) (string, *ast.BlockStmt) {
	t.Helper()
	source, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	files := token.NewFileSet()
	parsed, err := parser.ParseFile(files, path, source, 0)
	if err != nil {
		t.Fatalf("parse %s: %v", path, err)
	}
	for _, declaration := range parsed.Decls {
		method, ok := declaration.(*ast.FuncDecl)
		if ok && method.Name.Name == name && method.Recv != nil && method.Body != nil {
			start := files.Position(method.Pos()).Offset
			end := files.Position(method.End()).Offset
			return string(source[start:end]), method.Body
		}
	}
	t.Fatalf("method %s not found in %s", name, path)
	return "", nil
}
