package publications

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
)

const (
	SiteChannel           = "site"
	GrupoOLXChannel       = "grupo_olx"
	DefaultChannelAccount = "default"
	PayloadSchemaVersion  = 1
)

const (
	SiteLabel     = "Site"
	GrupoOLXLabel = "Grupo OLX · ZAP · Viva Real"
)

const (
	DesiredPublished   = "published"
	DesiredPaused      = "paused"
	DesiredUnpublished = "unpublished"
)

const (
	ObservedDraft        = "draft"
	ObservedQueued       = "queued"
	ObservedPublishing   = "publishing"
	ObservedPublished    = "published"
	ObservedPausing      = "pausing"
	ObservedPaused       = "paused"
	ObservedUnpublishing = "unpublishing"
	ObservedUnpublished  = "unpublished"
	ObservedError        = "error"
)

const (
	ReadinessUnknown = "unknown"
	ReadinessReady   = "ready"
	ReadinessBlocked = "blocked"
)

const (
	ActionPublish    = "publish"
	ActionUpdate     = "update"
	ActionUnpublish  = "unpublish"
	ActionRevalidate = "revalidate"
)

const (
	JobPending    = "pending"
	JobProcessing = "processing"
	JobRetry      = "retry"
	JobSucceeded  = "succeeded"
	JobSuperseded = "superseded"
	JobDead       = "dead"
)

var (
	ErrInvalidInput          = errors.New("invalid publication input")
	ErrPropertyNotFound      = errors.New("publication property not found")
	ErrPublicationNotFound   = errors.New("property publication not found")
	ErrPublicationConflict   = errors.New("property publication revision conflict")
	ErrIdempotencyConflict   = errors.New("publication idempotency conflict")
	ErrIdempotencyKeyMissing = errors.New("publication idempotency key is required")
	ErrPublicationNotReady   = errors.New("property publication is not ready")
	ErrSiteUnavailable       = errors.New("property publication site is unavailable")
	ErrGrupoOLXUnavailable   = errors.New("property publication Grupo OLX account is unavailable")
	ErrMediaNotFound         = errors.New("published media not found")
	ErrStorageNotConfigured  = errors.New("publication storage is not configured")
)

type Config struct {
	PublicBaseURL string
	AppURL        string
	StorageURL    string
	StorageAPIKey string
	Worker        WorkerConfig
}

type WorkerConfig struct {
	Enabled     bool
	Interval    time.Duration
	BatchSize   int
	Lease       time.Duration
	MaxAttempts int
}

type PublishInput struct {
	ExpectedPropertyUpdatedAt string `json:"expected_property_updated_at"`
}

type PublicationRevisionInput struct {
	ExpectedPublicationUpdatedAt string `json:"expected_publication_updated_at"`
}

func (input PublishInput) Validate() error {
	return validateRequiredTimestamp(input.ExpectedPropertyUpdatedAt, "expected_property_updated_at")
}

func (input PublicationRevisionInput) Validate() error {
	return validateRequiredTimestamp(input.ExpectedPublicationUpdatedAt, "expected_publication_updated_at")
}

func validateRequiredTimestamp(value string, field string) error {
	value = strings.TrimSpace(value)
	if value == "" {
		return fmt.Errorf("%w: %s is required", ErrInvalidInput, field)
	}
	if _, err := time.Parse(time.RFC3339Nano, value); err != nil {
		return fmt.Errorf("%w: %s is invalid", ErrInvalidInput, field)
	}
	return nil
}

type Check struct {
	Code     string  `json:"code"`
	Label    string  `json:"label"`
	Severity string  `json:"severity"`
	Resolved bool    `json:"resolved"`
	Message  *string `json:"message,omitempty"`
}

type LastError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type Capabilities struct {
	CanPublish   bool `json:"can_publish"`
	CanUnpublish bool `json:"can_unpublish"`
	CanRetry     bool `json:"can_retry"`
	CanPreview   bool `json:"can_preview"`
}

type Preview struct {
	Title           *string  `json:"title,omitempty"`
	Description     *string  `json:"description,omitempty"`
	Price           *float64 `json:"price,omitempty"`
	PriceLabel      *string  `json:"price_label,omitempty"`
	Address         *string  `json:"address,omitempty"`
	ImageURLs       []string `json:"image_urls,omitempty"`
	PrimaryImageURL *string  `json:"primary_image_url,omitempty"`
	Bedrooms        *int     `json:"bedrooms,omitempty"`
	Bathrooms       *int     `json:"bathrooms,omitempty"`
	ParkingSpaces   *int     `json:"parking_spaces,omitempty"`
	Area            *float64 `json:"area,omitempty"`
	PublicURL       *string  `json:"public_url,omitempty"`
}

type RecentJob struct {
	ID            string     `json:"id"`
	Action        string     `json:"action"`
	Status        string     `json:"status"`
	Version       *int64     `json:"version"`
	Attempts      int        `json:"attempts"`
	MaxAttempts   int        `json:"max_attempts"`
	NextAttemptAt *string    `json:"next_attempt_at"`
	LastError     *LastError `json:"last_error"`
	CompletedAt   *string    `json:"completed_at"`
	CreatedAt     string     `json:"created_at"`
}

type ProviderFeedback struct {
	Scope              string   `json:"scope"`
	VersionBound       bool     `json:"version_bound"`
	ListingID          string   `json:"listing_id"`
	ReportID           string   `json:"report_id"`
	Severity           string   `json:"severity"`
	Messages           []string `json:"messages"`
	ProviderOccurredAt *string  `json:"provider_occurred_at"`
	ReceivedAt         string   `json:"received_at"`
}

type PublicationView struct {
	ID                *string           `json:"id"`
	Channel           string            `json:"channel"`
	ChannelAccountKey string            `json:"channel_account_key"`
	Label             string            `json:"label"`
	Available         bool              `json:"available"`
	DesiredState      string            `json:"desired_state"`
	ObservedState     string            `json:"observed_state"`
	ReadinessState    string            `json:"readiness_state"`
	ReadinessScore    int               `json:"readiness_score"`
	Checks            []Check           `json:"checks"`
	CurrentVersion    int64             `json:"current_version"`
	PublishedVersion  *int64            `json:"published_version"`
	IsOutdated        bool              `json:"is_outdated"`
	PublicURL         *string           `json:"public_url"`
	Preview           Preview           `json:"preview"`
	Capabilities      Capabilities      `json:"capabilities"`
	LastError         *LastError        `json:"last_error"`
	LastRequestedAt   *string           `json:"last_requested_at"`
	LastAttemptAt     *string           `json:"last_attempt_at"`
	LastSucceededAt   *string           `json:"last_succeeded_at"`
	UpdatedAt         *string           `json:"updated_at"`
	RecentJobs        []RecentJob       `json:"recent_jobs"`
	ProviderFeedback  *ProviderFeedback `json:"provider_feedback,omitempty"`
}

type OverviewData struct {
	PropertyID        string            `json:"property_id"`
	PropertyUpdatedAt string            `json:"property_updated_at"`
	Publications      []PublicationView `json:"publications"`
}

type OverviewMeta struct {
	CanManage bool `json:"can_manage"`
}

type OverviewResponse struct {
	Data OverviewData `json:"data"`
	Meta OverviewMeta `json:"meta"`
}

type commandResult struct {
	Response OverviewResponse
	Replay   bool
}

type publicationRecord struct {
	ID                      string
	OrganizationID          string
	PropertyID              string
	Channel                 string
	ChannelAccountKey       string
	DesiredState            string
	ObservedState           string
	ReadinessState          string
	CurrentVersion          int64
	PublishedVersion        *int64
	ValidationErrors        []Check
	ProviderListingID       *string
	ProviderPublicationType string
	PublicURL               *string
	LastErrorCode           *string
	LastErrorMessage        *string
	LastRequestedAt         *time.Time
	LastAttemptAt           *time.Time
	LastSucceededAt         *time.Time
	PublishedAt             *time.Time
	UnpublishedAt           *time.Time
	UpdatedAt               time.Time
}

type publicationScope struct {
	Channel    string
	AccountKey string
	Label      string
}

func sitePublicationScope() publicationScope {
	return publicationScope{Channel: SiteChannel, AccountKey: DefaultChannelAccount, Label: SiteLabel}
}

func grupoOLXPublicationScope(accountKey string) publicationScope {
	accountKey = strings.TrimSpace(accountKey)
	if accountKey == "" {
		// A virtual unavailable overview still needs a stable account key. No
		// canonical record is ever persisted with this fallback value.
		accountKey = DefaultChannelAccount
	}
	return publicationScope{Channel: GrupoOLXChannel, AccountKey: accountKey, Label: GrupoOLXLabel}
}

type versionRecord struct {
	ID                      string
	PublicationID           string
	Version                 int64
	SourcePropertyUpdatedAt time.Time
	Payload                 map[string]any
	PayloadHash             string
	ReadinessErrors         []Check
}

type pendingJob struct {
	ID                      string
	PublicationID           string
	VersionID               *string
	OrganizationID          string
	PropertyID              string
	Channel                 string
	ChannelAccountKey       string
	Action                  string
	Status                  string
	RequestHash             string
	Attempts                int
	MaxAttempts             int
	LeaseToken              string
	RequestedBy             *string
	DesiredState            string
	ObservedState           string
	CurrentVersion          int64
	PublishedVersion        *int64
	Version                 *int64
	SourcePropertyUpdatedAt *time.Time
	PayloadHash             *string
	Payload                 map[string]any
}

type siteSnapshot struct {
	Property map[string]any  `json:"property"`
	Preview  Preview         `json:"preview"`
	Media    []snapshotMedia `json:"media"`
}

type grupoOLXSnapshot struct {
	Property      map[string]any        `json:"property"`
	Preview       Preview               `json:"preview"`
	Media         []snapshotMedia       `json:"media"`
	ChannelConfig grupoOLXChannelConfig `json:"channel_config"`
}

type grupoOLXChannelConfig struct {
	ClientListingID string `json:"client_listing_id"`
	PublicationType string `json:"publication_type"`
}

type snapshotMedia struct {
	AssetID        string `json:"asset_id"`
	URL            string `json:"url"`
	Kind           string `json:"kind"`
	Primary        bool   `json:"is_primary"`
	Position       int    `json:"position"`
	SourceHash     string `json:"source_hash"`
	MIMEType       string `json:"mime_type"`
	FileSizeBytes  *int64 `json:"file_size_bytes"`
	ServerVerified bool   `json:"server_verified"`
}

type publicMediaTarget struct {
	StoragePath string
	ExternalURL string
}

func normalizeUUID(value string) (string, bool) {
	var uuid pgtype.UUID
	if err := uuid.Scan(strings.TrimSpace(value)); err != nil || !uuid.Valid {
		return "", false
	}
	return uuid.String(), true
}

func normalizeIdempotencyKey(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", ErrIdempotencyKeyMissing
	}
	if len(value) > 200 {
		return "", fmt.Errorf("%w: Idempotency-Key is too long", ErrInvalidInput)
	}
	return value, nil
}

func canonicalRequestHash(scope publicationScope, action string, propertyID string, expectedRevision string) string {
	payload, _ := json.Marshal(map[string]string{
		"action":            strings.TrimSpace(action),
		"channel":           strings.TrimSpace(scope.Channel),
		"account_key":       strings.TrimSpace(scope.AccountKey),
		"property_id":       strings.TrimSpace(propertyID),
		"expected_revision": strings.TrimSpace(expectedRevision),
	})
	sum := sha256.Sum256(payload)
	return hex.EncodeToString(sum[:])
}

func payloadHash(payload []byte) string {
	sum := sha256.Sum256(payload)
	return hex.EncodeToString(sum[:])
}

func stringPointer(value string) *string {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return &value
}
