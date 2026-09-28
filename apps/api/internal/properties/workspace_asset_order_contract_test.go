package properties

import (
	"os"
	"strings"
	"testing"
)

func TestCreatePropertyAssetChecksSameTypeActiveOrderInsidePropertyLock(t *testing.T) {
	raw, err := os.ReadFile("workspace_ownership_assets.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)
	start := strings.Index(source, "func (repo Repository) CreatePropertyAsset(")
	end := strings.Index(source, "func resolveCreatePropertyAssetSortOrder(")
	if start < 0 || end <= start {
		t.Fatal("could not isolate canonical asset creation")
	}
	method := source[start:end]
	lock := strings.Index(method, "lockWorkspaceProperty(ctx, tx")
	query := strings.Index(method, "coalesce(bool_or(asset.sort_order = $4::integer), false)")
	insert := strings.Index(method, "insert into public.property_assets (")
	if lock < 0 || query <= lock || insert <= query {
		t.Fatal("asset order collision check must run after the property lock and before insert")
	}
	for _, clause := range []string{
		"asset.organization_id = $1::uuid",
		"asset.property_id = $2::uuid",
		"asset.asset_type = $3",
		"activePropertyAssetSQL(\"asset\")",
		"resolveCreatePropertyAssetSortOrder(input.SortOrder, requestedOrderOccupied, highestOrder)",
	} {
		if !strings.Contains(method[query:insert], clause) {
			t.Fatalf("asset order collision query is missing %q", clause)
		}
	}
}
