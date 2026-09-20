package leads

import (
	"context"
	pathpkg "path"
	"strings"
	"sync"
	"time"
	"unicode"
)

const (
	whatsAppAvatarBucket                   = "whatsapp-media"
	whatsAppAvatarSignedURLTTLSeconds      = 60 * 60
	whatsAppAvatarSigningConcurrency       = 6
	whatsAppAvatarSignedURLCacheMaxEntries = 4096
)

const (
	// A URL returned near the end of the backend cache must still outlive the
	// browser's 10-minute React Query stale window. Keep at least 15 minutes of
	// bearer validity while caching each signature for up to 45 minutes.
	whatsAppAvatarSignedURLCacheSkew  = 15 * time.Minute
	whatsAppAvatarSigningFailureCache = 20 * time.Second
	whatsAppAvatarSigningBatchTimeout = 2 * time.Second
)

type cachedWhatsAppAvatarSignedURL struct {
	url       string
	expiresAt time.Time
}

type boundedWhatsAppAvatarSignedURLCache struct {
	mu         sync.Mutex
	maxEntries int
	entries    map[string]cachedWhatsAppAvatarSignedURL
}

func newBoundedWhatsAppAvatarSignedURLCache(maxEntries int) *boundedWhatsAppAvatarSignedURLCache {
	if maxEntries < 1 {
		maxEntries = whatsAppAvatarSignedURLCacheMaxEntries
	}
	return &boundedWhatsAppAvatarSignedURLCache{
		maxEntries: maxEntries,
		entries:    make(map[string]cachedWhatsAppAvatarSignedURL, maxEntries),
	}
}

func (cache *boundedWhatsAppAvatarSignedURLCache) load(key string) (cachedWhatsAppAvatarSignedURL, bool) {
	if cache == nil {
		return cachedWhatsAppAvatarSignedURL{}, false
	}
	cache.mu.Lock()
	defer cache.mu.Unlock()
	entry, ok := cache.entries[key]
	if !ok {
		return cachedWhatsAppAvatarSignedURL{}, false
	}
	if !entry.expiresAt.After(time.Now()) {
		delete(cache.entries, key)
		return cachedWhatsAppAvatarSignedURL{}, false
	}
	return entry, true
}

func (cache *boundedWhatsAppAvatarSignedURLCache) store(key string, entry cachedWhatsAppAvatarSignedURL) {
	if cache == nil {
		return
	}
	cache.mu.Lock()
	defer cache.mu.Unlock()

	if _, exists := cache.entries[key]; !exists && len(cache.entries) >= cache.maxEntries {
		now := time.Now()
		oldestKey := ""
		var oldestExpiry time.Time
		for candidateKey, candidate := range cache.entries {
			if !candidate.expiresAt.After(now) {
				delete(cache.entries, candidateKey)
				continue
			}
			if oldestKey == "" || candidate.expiresAt.Before(oldestExpiry) {
				oldestKey = candidateKey
				oldestExpiry = candidate.expiresAt
			}
		}
		if len(cache.entries) >= cache.maxEntries && oldestKey != "" {
			delete(cache.entries, oldestKey)
		}
	}
	cache.entries[key] = entry
}

func (cache *boundedWhatsAppAvatarSignedURLCache) len() int {
	if cache == nil {
		return 0
	}
	cache.mu.Lock()
	defer cache.mu.Unlock()
	return len(cache.entries)
}

func whatsAppAvatarStoragePathBelongsToLead(objectPath string, organizationID string, leadID string) bool {
	if objectPath == "" || strings.TrimSpace(objectPath) != objectPath {
		return false
	}
	if strings.ContainsAny(objectPath, `\?#%`) || pathpkg.Clean(objectPath) != objectPath {
		return false
	}
	for _, character := range objectPath {
		if unicode.IsControl(character) {
			return false
		}
	}

	normalizedOrganizationID, organizationOK := normalizeUUID(organizationID)
	normalizedLeadID, leadOK := normalizeUUID(leadID)
	if !organizationOK || !leadOK {
		return false
	}
	prefix := "orgs/" + normalizedOrganizationID + "/profile-pictures/" + normalizedLeadID + "/"
	if !strings.HasPrefix(objectPath, prefix) {
		return false
	}

	suffix := strings.TrimPrefix(objectPath, prefix)
	if suffix == "" || strings.Contains(suffix, "/") {
		return false
	}
	extension := pathpkg.Ext(suffix)
	if extension != ".jpg" && extension != ".png" && extension != ".webp" {
		return false
	}
	digest := strings.TrimSuffix(suffix, extension)
	if len(digest) != 64 {
		return false
	}
	for _, character := range digest {
		if !((character >= '0' && character <= '9') || (character >= 'a' && character <= 'f')) {
			return false
		}
	}
	return true
}

func (repo Repository) signedWhatsAppAvatarURL(ctx context.Context, organizationID string, leadID string, objectPath string) (string, error) {
	if !whatsAppAvatarStoragePathBelongsToLead(objectPath, organizationID, leadID) {
		return "", nil
	}

	cache := repo.whatsAppAvatarURLs
	if cached, ok := cache.load(objectPath); ok {
		return cached.url, nil
	}
	if repo.whatsAppAvatarSlots != nil {
		select {
		case repo.whatsAppAvatarSlots <- struct{}{}:
			defer func() { <-repo.whatsAppAvatarSlots }()
		case <-ctx.Done():
			return "", ctx.Err()
		}
		// Another request may have signed the same object while this request was
		// waiting for a global slot.
		if cached, ok := cache.load(objectPath); ok {
			return cached.url, nil
		}
	}

	signedURL, err := repo.storage.signedURL(ctx, whatsAppAvatarBucket, objectPath, whatsAppAvatarSignedURLTTLSeconds)
	if err != nil {
		if ctx.Err() == nil {
			cache.store(objectPath, cachedWhatsAppAvatarSignedURL{
				expiresAt: time.Now().Add(whatsAppAvatarSigningFailureCache),
			})
		}
		return "", err
	}
	if strings.TrimSpace(signedURL) == "" {
		cache.store(objectPath, cachedWhatsAppAvatarSignedURL{
			expiresAt: time.Now().Add(whatsAppAvatarSigningFailureCache),
		})
		return "", nil
	}

	cacheTTL := time.Duration(whatsAppAvatarSignedURLTTLSeconds)*time.Second - whatsAppAvatarSignedURLCacheSkew
	if cacheTTL <= 0 {
		cacheTTL = time.Duration(whatsAppAvatarSignedURLTTLSeconds) * time.Second
	}
	cache.store(objectPath, cachedWhatsAppAvatarSignedURL{
		url:       signedURL,
		expiresAt: time.Now().Add(cacheTTL),
	})
	return signedURL, nil
}

type whatsAppAvatarReadModel struct {
	organizationID string
	leadID         string
	storagePath    *string
	avatarURL      **string
}

func (repo Repository) hydrateWhatsAppAvatarReadModels(ctx context.Context, authorizedOrganizationID string, records []whatsAppAvatarReadModel) {
	normalizedOrganizationID, ok := normalizeUUID(authorizedOrganizationID)
	if !ok {
		for _, record := range records {
			if record.avatarURL != nil {
				*record.avatarURL = nil
			}
		}
		return
	}

	pathsByRecord := make([]string, len(records))
	uniquePaths := make(map[string]whatsAppAvatarReadModel, len(records))
	for index, record := range records {
		if record.avatarURL == nil {
			continue
		}
		*record.avatarURL = nil
		recordOrganizationID, recordOrganizationOK := normalizeUUID(record.organizationID)
		if !recordOrganizationOK || recordOrganizationID != normalizedOrganizationID || record.storagePath == nil {
			continue
		}
		objectPath := *record.storagePath
		if !whatsAppAvatarStoragePathBelongsToLead(objectPath, normalizedOrganizationID, record.leadID) {
			continue
		}
		pathsByRecord[index] = objectPath
		uniquePaths[objectPath] = record
	}
	if len(uniquePaths) == 0 {
		return
	}
	signingCtx, cancelSigning := context.WithTimeout(ctx, whatsAppAvatarSigningBatchTimeout)
	defer cancelSigning()

	type signedAvatarResult struct {
		path string
		url  string
	}
	jobs := make(chan whatsAppAvatarReadModel, len(uniquePaths))
	results := make(chan signedAvatarResult, len(uniquePaths))
	for _, record := range uniquePaths {
		jobs <- record
	}
	close(jobs)

	workerCount := whatsAppAvatarSigningConcurrency
	if workerCount > len(uniquePaths) {
		workerCount = len(uniquePaths)
	}
	var workers sync.WaitGroup
	workers.Add(workerCount)
	for worker := 0; worker < workerCount; worker++ {
		go func() {
			defer workers.Done()
			for record := range jobs {
				if signingCtx.Err() != nil || record.storagePath == nil {
					continue
				}
				signedURL, err := repo.signedWhatsAppAvatarURL(signingCtx, normalizedOrganizationID, record.leadID, *record.storagePath)
				if err != nil || signedURL == "" {
					continue
				}
				results <- signedAvatarResult{path: *record.storagePath, url: signedURL}
			}
		}()
	}
	workers.Wait()
	close(results)

	signedURLs := make(map[string]string, len(uniquePaths))
	for result := range results {
		signedURLs[result.path] = result.url
	}
	for index, record := range records {
		signedURL := signedURLs[pathsByRecord[index]]
		if record.avatarURL == nil || signedURL == "" {
			continue
		}
		urlCopy := signedURL
		*record.avatarURL = &urlCopy
	}
}

func (repo Repository) hydrateLeadAvatar(ctx context.Context, authorizedOrganizationID string, lead *Lead) {
	if lead == nil {
		return
	}
	repo.hydrateWhatsAppAvatarReadModels(ctx, authorizedOrganizationID, []whatsAppAvatarReadModel{{
		organizationID: lead.OrganizationID,
		leadID:         lead.ID,
		storagePath:    lead.WhatsAppAvatarStoragePath,
		avatarURL:      &lead.WhatsAppAvatarURL,
	}})
}

func (repo Repository) hydrateLeadAvatars(ctx context.Context, authorizedOrganizationID string, leads []Lead) {
	records := make([]whatsAppAvatarReadModel, 0, len(leads))
	for index := range leads {
		records = append(records, whatsAppAvatarReadModel{
			organizationID: leads[index].OrganizationID,
			leadID:         leads[index].ID,
			storagePath:    leads[index].WhatsAppAvatarStoragePath,
			avatarURL:      &leads[index].WhatsAppAvatarURL,
		})
	}
	repo.hydrateWhatsAppAvatarReadModels(ctx, authorizedOrganizationID, records)
}

func (repo Repository) hydratePipelineBoardLeadAvatars(ctx context.Context, authorizedOrganizationID string, leads []*PipelineBoardLead) {
	records := make([]whatsAppAvatarReadModel, 0, len(leads))
	for _, lead := range leads {
		if lead == nil {
			continue
		}
		records = append(records, whatsAppAvatarReadModel{
			organizationID: lead.OrganizationID,
			leadID:         lead.ID,
			storagePath:    lead.WhatsAppAvatarStoragePath,
			avatarURL:      &lead.WhatsAppAvatarURL,
		})
	}
	repo.hydrateWhatsAppAvatarReadModels(ctx, authorizedOrganizationID, records)
}

func (repo Repository) hydrateContactAvatars(ctx context.Context, authorizedOrganizationID string, contacts []Contact) {
	records := make([]whatsAppAvatarReadModel, 0, len(contacts))
	for index := range contacts {
		records = append(records, whatsAppAvatarReadModel{
			organizationID: authorizedOrganizationID,
			leadID:         contacts[index].ID,
			storagePath:    contacts[index].WhatsAppAvatarStoragePath,
			avatarURL:      &contacts[index].WhatsAppAvatarURL,
		})
	}
	repo.hydrateWhatsAppAvatarReadModels(ctx, authorizedOrganizationID, records)
}
