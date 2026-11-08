package properties

import (
	"context"
	"sync"
	"time"
)

const (
	// Non-confidential photos are displayed by lists that stay cached for up to
	// an hour and lazy-load while scrolling, so they outlive that cache. Documents
	// and confidential photos keep propertyAssetAccessTTL and are never shared.
	propertyPhotoAccessTTL = 2 * time.Hour
	// A URL is handed out again only while it remains valid longer than the list
	// cache. Reuse keeps the image src stable across refetches, so the browser
	// serves its cached copy instead of downloading and decoding the photo again.
	propertyPhotoAccessMinRemaining = 70 * time.Minute
	propertyPhotoAccessCacheLimit   = 20_000
)

type propertyPhotoURLEntry struct {
	url       string
	expiresAt time.Time
}

// propertyPhotoURLCache only holds URLs already signed for an authorized read.
// Callers still resolve which paths the current user may see before asking.
type propertyPhotoURLCache struct {
	mutex   sync.Mutex
	entries map[string]propertyPhotoURLEntry
}

func newPropertyPhotoURLCache() *propertyPhotoURLCache {
	return &propertyPhotoURLCache{entries: map[string]propertyPhotoURLEntry{}}
}

func (cache *propertyPhotoURLCache) lookup(path string, now time.Time) (string, bool) {
	cache.mutex.Lock()
	defer cache.mutex.Unlock()
	entry, found := cache.entries[path]
	if !found || entry.expiresAt.Sub(now) < propertyPhotoAccessMinRemaining {
		return "", false
	}
	return entry.url, true
}

func (cache *propertyPhotoURLCache) store(path string, url string, expiresAt time.Time, now time.Time) {
	cache.mutex.Lock()
	defer cache.mutex.Unlock()
	if len(cache.entries) >= propertyPhotoAccessCacheLimit {
		for key, entry := range cache.entries {
			if entry.expiresAt.Sub(now) < propertyPhotoAccessMinRemaining {
				delete(cache.entries, key)
			}
		}
		if len(cache.entries) >= propertyPhotoAccessCacheLimit {
			cache.entries = map[string]propertyPhotoURLEntry{}
		}
	}
	cache.entries[path] = propertyPhotoURLEntry{url: url, expiresAt: expiresAt}
}

// createPhotoAccessURLs returns every URL it could obtain, plus the first error.
func (client storageClient) createPhotoAccessURLs(ctx context.Context, bucket string, paths []string) (map[string]string, error) {
	result := make(map[string]string, len(paths))
	missing := make([]string, 0, len(paths))
	now := time.Now()
	for _, path := range paths {
		if client.photoURLs != nil {
			if url, found := client.photoURLs.lookup(bucket+"/"+path, now); found {
				result[path] = url
				continue
			}
		}
		missing = append(missing, path)
	}
	var firstError error
	for start := 0; start < len(missing); start += propertyCoverSignedURLBatchSize {
		end := min(start+propertyCoverSignedURLBatchSize, len(missing))
		signedAt := time.Now()
		signed, err := client.createSignedURLs(ctx, bucket, missing[start:end], propertyPhotoAccessTTL)
		if err != nil {
			if firstError == nil {
				firstError = err
			}
			continue
		}
		for path, url := range signed {
			result[path] = url
			if client.photoURLs != nil {
				client.photoURLs.store(bucket+"/"+path, url, signedAt.Add(propertyPhotoAccessTTL), signedAt)
			}
		}
	}
	return result, firstError
}
