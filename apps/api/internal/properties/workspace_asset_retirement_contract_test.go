package properties

import (
	"os"
	"strings"
	"testing"
)

func TestRetiredWorkspaceAssetsAreHiddenAndImmutable(t *testing.T) {
	raw, err := os.ReadFile("workspace_ownership_assets.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)
	contracts := []struct {
		name     string
		start    string
		end      string
		minGuard int
	}{
		{"update", "func (repo Repository) UpdatePropertyAsset(", "func (repo Repository) ReorderPropertyAssets(", 1},
		{"reorder", "func (repo Repository) ReorderPropertyAssets(", "func (repo Repository) SetPrimaryPropertyAsset(", 2},
		{"set-primary", "func (repo Repository) SetPrimaryPropertyAsset(", "func (repo Repository) DeletePropertyAsset(", 2},
		{"delete", "func (repo Repository) DeletePropertyAsset(", "func publishedAssetRepresentationChanged(", 1},
		{"lookup", "func (repo Repository) getWorkspaceAsset(", "func listWorkspaceAssets(", 1},
		{"list", "func listWorkspaceAssets(", "func clearOtherPrimaryPhotos(", 1},
		{"clear-primary", "func clearOtherPrimaryPhotos(", "func ensurePropertyPhotoAssetCapacity(", 1},
		{"capacity", "func ensurePropertyPhotoAssetCapacity(", "type propertyAssetOrderVersion struct", 1},
		{"legacy-mirror", "func syncLegacyPropertyPrimaryPhoto(", "func activePropertyAssetSQL(", 4},
	}
	for _, contract := range contracts {
		t.Run(contract.name, func(t *testing.T) {
			start := strings.Index(source, contract.start)
			end := strings.Index(source, contract.end)
			if start < 0 || end <= start {
				t.Fatalf("could not isolate %s asset contract", contract.name)
			}
			if count := strings.Count(source[start:end], "activePropertyAssetSQL("); count < contract.minGuard {
				t.Fatalf("%s has %d retirement guards, want at least %d", contract.name, count, contract.minGuard)
			}
		})
	}
}

func TestWorkspaceProjectionHidesRetiredAssetsButKeepsInclusivePhotoFence(t *testing.T) {
	raw, err := os.ReadFile("workspace_repository.go")
	if err != nil {
		t.Fatal(err)
	}
	source := string(raw)
	if count := strings.Count(source, "activePropertyAssetSQL(\"asset\")"); count != 1 {
		t.Fatalf("workspace asset projection retirement filter count = %d, want 1", count)
	}
	fenceStart := strings.Index(source, "from public.property_assets as any_photo")
	if fenceStart < 0 {
		t.Fatal("could not isolate inclusive workspace photo fence")
	}
	fenceEnd := strings.Index(source[fenceStart:], "\n\t\t\t)")
	if fenceEnd < 0 {
		t.Fatal("could not isolate inclusive workspace photo fence")
	}
	if strings.Contains(source[fenceStart:fenceStart+fenceEnd], "activePropertyAssetSQL") {
		t.Fatal("workspace has_asset_photos must include retired canonical rows")
	}
}
