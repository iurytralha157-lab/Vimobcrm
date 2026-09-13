package properties

import (
	"context"
	"log/slog"
)

const propertyCoverSignedURLBatchSize = 100

// attachSignedPropertyCoverURLs resolves private canonical photos only for the
// authorized CRM response. Raw Storage paths never leave the API, and the
// legacy column is ignored as soon as a canonical photo exists.
func (repo Repository) attachSignedPropertyCoverURLs(ctx context.Context, properties []Property) {
	pathIndexes := map[string][]int{}
	paths := make([]string, 0, len(properties))
	for index, property := range properties {
		storagePath := anyString(property["_asset_cover_storage_path"])
		delete(property, "_asset_cover_storage_path")
		if storagePath == "" {
			continue
		}
		if _, exists := pathIndexes[storagePath]; !exists {
			paths = append(paths, storagePath)
		}
		pathIndexes[storagePath] = append(pathIndexes[storagePath], index)
	}

	for start := 0; start < len(paths); start += propertyCoverSignedURLBatchSize {
		end := min(start+propertyCoverSignedURLBatchSize, len(paths))
		signedURLs, err := repo.storage.createSignedURLs(
			ctx,
			propertyPrivateBucket,
			paths[start:end],
			propertyAssetAccessTTL,
		)
		if err != nil {
			slog.WarnContext(ctx, "could not sign private property cover batch", "error", err)
			continue
		}
		for storagePath, signedURL := range signedURLs {
			for _, index := range pathIndexes[storagePath] {
				properties[index]["imagem_principal"] = signedURL
			}
		}
	}
}
