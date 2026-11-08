package properties

import (
	"context"
	"log/slog"
)

const propertyCoverSignedURLBatchSize = 100

// attachSignedPropertyCoverURLs resolves private canonical photos only for the
// authorized CRM response. Raw Storage paths never leave the API, and the
// legacy column is ignored as soon as a canonical photo exists.
func (repo Repository) attachSignedPropertyCoverURLs(ctx context.Context, organizationID string, properties []Property) {
	pathIndexes := map[string][]int{}
	paths := make([]string, 0, len(properties))
	for index, property := range properties {
		storagePath := anyString(property["_asset_cover_storage_path"])
		delete(property, "_asset_cover_storage_path")
		if !isCanonicalPropertyStoragePath(storagePath, organizationID, anyString(property["id"])) {
			continue
		}
		if _, exists := pathIndexes[storagePath]; !exists {
			paths = append(paths, storagePath)
		}
		pathIndexes[storagePath] = append(pathIndexes[storagePath], index)
	}

	signedURLs, err := repo.storage.createPhotoAccessURLs(ctx, propertyPrivateBucket, paths)
	if err != nil {
		slog.WarnContext(ctx, "could not sign private property cover batch", "error", err)
	}
	for storagePath, signedURL := range signedURLs {
		for _, index := range pathIndexes[storagePath] {
			properties[index]["imagem_principal"] = signedURL
		}
	}
}
