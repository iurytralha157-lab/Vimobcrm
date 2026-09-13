package analytics

import (
	"sync"
	"time"

	dbpkg "github.com/vimob-crm/vimob-crm/packages/db"
)

const siteAnalyticsCapabilitiesTTL = 5 * time.Minute

type siteAnalyticsCapabilities struct {
	mu        sync.Mutex
	expiresAt time.Time
	value     siteAnalyticsSchemaCapabilities
}

type siteAnalyticsSchemaCapabilities struct {
	trackingV2 bool
	lastSeenAt bool
}

func (capabilities *siteAnalyticsCapabilities) resolve(
	now time.Time,
	loader func() (siteAnalyticsSchemaCapabilities, error),
) (siteAnalyticsSchemaCapabilities, error) {
	capabilities.mu.Lock()
	defer capabilities.mu.Unlock()

	if now.Before(capabilities.expiresAt) {
		return capabilities.value, nil
	}

	value, err := loader()
	if err != nil {
		// A transient database/context error must remain retryable rather than
		// poisoning every analytics request for the full cache window.
		return siteAnalyticsSchemaCapabilities{}, err
	}

	capabilities.value = value
	capabilities.expiresAt = now.Add(siteAnalyticsCapabilitiesTTL)
	return value, nil
}

type Repository struct {
	db                        *dbpkg.Postgres
	siteAnalyticsCapabilities *siteAnalyticsCapabilities
}

func NewRepository(db *dbpkg.Postgres) Repository {
	return Repository{
		db:                        db,
		siteAnalyticsCapabilities: &siteAnalyticsCapabilities{},
	}
}
