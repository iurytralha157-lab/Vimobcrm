package properties

import "testing"

func TestPublishedAssetRepresentationChangeBlocksVisibilityLocatorAndType(t *testing.T) {
	currentSize := int64(4096)
	current := map[string]any{
		"asset_type": "photo", "visibility": "public", "storage_path": "org/photo.jpg", "external_url": nil,
		"mime_type": "image/jpeg", "file_size_bytes": currentSize,
	}
	target := CreatePropertyAssetInput{
		AssetType: "photo", Visibility: "internal", StoragePath: workspaceStringPointer("org/photo.jpg"),
		MIMEType: workspaceStringPointer("image/jpeg"), FileSizeBytes: &currentSize,
	}
	if !publishedAssetRepresentationChanged(current, target) {
		t.Fatal("visibility change must be blocked while the asset is published")
	}
	target.Visibility = "public"
	target.StoragePath = workspaceStringPointer("org/new-photo.jpg")
	if !publishedAssetRepresentationChanged(current, target) {
		t.Fatal("locator change must be blocked while a published version references the asset")
	}
	target.StoragePath = workspaceStringPointer("org/photo.jpg")
	target.AssetType = "document"
	if !publishedAssetRepresentationChanged(current, target) {
		t.Fatal("asset type change must be blocked while a published version references the asset")
	}
	target.AssetType = "photo"
	target.MIMEType = workspaceStringPointer("image/png")
	if !publishedAssetRepresentationChanged(current, target) {
		t.Fatal("MIME proof change must be blocked while a published version references the asset")
	}
	target.MIMEType = workspaceStringPointer("image/jpeg")
	changedSize := int64(8192)
	target.FileSizeBytes = &changedSize
	if !publishedAssetRepresentationChanged(current, target) {
		t.Fatal("size proof change must be blocked while a published version references the asset")
	}
}

func workspaceStringPointer(value string) *string { return &value }
