package meta

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/vimob-crm/vimob-crm/packages/db"
)

const (
	marketingSyncGraphVersion       = "v25.0"
	marketingSyncGraphOrigin        = "https://graph.facebook.com"
	marketingSyncRuntimeLimit       = 135 * time.Second
	marketingSyncRequestTimeout     = 20 * time.Second
	marketingSyncDatabaseTimeout    = 10 * time.Second
	marketingSyncMaxGraphPages      = 60
	marketingSyncMaxGraphItems      = 20_000
	marketingSyncMaxSocialMedia     = 750
	marketingSyncDatabaseChunkSize  = 200
	marketingSyncGraphConcurrency   = 4
	marketingSyncAccountConcurrency = 2
	marketingSyncCreativeWorkers    = 4
	marketingSyncSocialWorkers      = 3
	marketingSyncInsightChunkDays   = 30
	marketingSyncMaxRangeDays       = 90
	marketingSyncMaxErrorCount      = 50
	marketingSyncMaxErrorLength     = 2_000
	marketingSyncMaxResponseBytes   = 16 << 20
)

var (
	marketingSyncUUIDPattern         = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$`)
	marketingSyncGraphVersionPattern = regexp.MustCompile(`^v\d+\.\d+$`)
)

// MarketingSyncRequest is intentionally organization-scoped. Authentication
// and the owner/admin permission check happen in the HTTP handler before this
// service is called; the service validates the identifiers again before any
// database or Meta request.
type MarketingSyncRequest struct {
	OrganizationID string `json:"organization_id"`
	UserID         string `json:"user_id"`
	DateFrom       string `json:"date_from"`
	DateTo         string `json:"date_to"`
}

type MarketingSyncResult struct {
	Success      bool     `json:"success"`
	Synced       int      `json:"synced"`
	MediaSynced  int      `json:"media_synced"`
	SocialSynced int      `json:"social_synced"`
	Errors       []string `json:"errors"`
}

// MarketingSyncFailure exposes only a stable error code to handlers. Raw Meta
// responses and credentials never cross this boundary.
type MarketingSyncFailure struct {
	Code       string
	HTTPStatus int
	cause      error
}

func (failure *MarketingSyncFailure) Error() string {
	if failure == nil || strings.TrimSpace(failure.Code) == "" {
		return "meta_marketing_sync_failed"
	}
	return failure.Code
}

func (failure *MarketingSyncFailure) Unwrap() error {
	if failure == nil {
		return nil
	}
	return failure.cause
}

func newMarketingSyncFailure(code string, status int, cause error) *MarketingSyncFailure {
	if strings.TrimSpace(code) == "" {
		code = "meta_marketing_sync_failed"
	}
	if status == 0 {
		status = http.StatusInternalServerError
	}
	return &MarketingSyncFailure{Code: code, HTTPStatus: status, cause: cause}
}

func marketingSyncErrorCode(err error) string {
	var failure *MarketingSyncFailure
	if errors.As(err, &failure) {
		return failure.Code
	}
	return "unexpected_sync_error"
}

type marketingSyncDateRange struct {
	From time.Time
	To   time.Time
}

func (dateRange marketingSyncDateRange) fromText() string {
	return dateRange.From.Format(time.DateOnly)
}

func (dateRange marketingSyncDateRange) toText() string {
	return dateRange.To.Format(time.DateOnly)
}

type marketingSyncTarget struct {
	IntegrationID              string
	OrganizationID             string
	PageID                     string
	PageName                   string
	InstagramBusinessAccountID string
	InstagramUsername          string
	AdAccountID                string
	SelectedAdAccounts         []any
	AccessToken                string
}

type marketingSyncAggregate struct {
	Synced       int
	MediaSynced  int
	SocialSynced int
	Errors       []string
}

type marketingSyncAccountResult struct {
	Synced      int
	MediaSynced int
	Errors      []string
}

type marketingSyncSocialResult struct {
	SocialSynced int
	MediaSynced  int
	Errors       []string
}

type marketingSyncDB interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
	QueryRow(context.Context, string, ...any) pgx.Row
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
	SendBatch(context.Context, *pgx.Batch) pgx.BatchResults
}

type MarketingSyncService struct {
	db             marketingSyncDB
	graphBaseURL   string
	graphVersion   string
	appSecret      string
	httpClient     *http.Client
	runtimeLimit   time.Duration
	requestTimeout time.Duration
	now            func() time.Time
	sleep          func(context.Context, time.Duration) error
}

// NewMarketingSyncService creates the Meta Marketing synchronizer used by the
// Go BFF. The database is used directly through pgx; no PostgREST, service-role
// key, or Edge Function is involved.
func NewMarketingSyncService(database *db.Postgres, config Config, client *http.Client) *MarketingSyncService {
	if database == nil {
		return newMarketingSyncService(nil, config, client)
	}
	return newMarketingSyncService(database.Pool(), config, client)
}

func newMarketingSyncService(database marketingSyncDB, config Config, client *http.Client) *MarketingSyncService {
	graphBaseURL := normalizeMarketingSyncGraphBaseURL(config.GraphBaseURL)
	graphVersion := strings.TrimSpace(config.GraphVersion)
	if !marketingSyncGraphVersionPattern.MatchString(graphVersion) {
		graphVersion = marketingSyncGraphVersion
	}
	if client == nil {
		client = &http.Client{}
	}
	return &MarketingSyncService{
		db:             database,
		graphBaseURL:   graphBaseURL,
		graphVersion:   graphVersion,
		appSecret:      strings.TrimSpace(config.AppSecret),
		httpClient:     client,
		runtimeLimit:   marketingSyncRuntimeLimit,
		requestTimeout: marketingSyncRequestTimeout,
		now:            time.Now,
		sleep: func(ctx context.Context, delay time.Duration) error {
			timer := time.NewTimer(delay)
			defer timer.Stop()
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-timer.C:
				return nil
			}
		},
	}
}

func normalizeMarketingSyncGraphBaseURL(value string) string {
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil || parsed.Scheme == "" {
		return marketingSyncGraphOrigin
	}
	if !strings.EqualFold(parsed.Scheme, "https") ||
		!strings.EqualFold(parsed.Hostname(), "graph.facebook.com") ||
		parsed.Port() != "" || parsed.User != nil || parsed.RawQuery != "" ||
		parsed.Fragment != "" || (parsed.EscapedPath() != "" && parsed.EscapedPath() != "/") {
		return marketingSyncGraphOrigin
	}
	// Return the constant instead of the configured spelling so there is one
	// auditable destination for every token-bearing production request.
	return marketingSyncGraphOrigin
}

func parseMarketingSyncRequest(request MarketingSyncRequest) (marketingSyncDateRange, error) {
	if !marketingSyncUUIDPattern.MatchString(strings.TrimSpace(request.OrganizationID)) {
		return marketingSyncDateRange{}, newMarketingSyncFailure("invalid_organization_id", http.StatusBadRequest, nil)
	}
	if !marketingSyncUUIDPattern.MatchString(strings.TrimSpace(request.UserID)) {
		return marketingSyncDateRange{}, newMarketingSyncFailure("invalid_user_id", http.StatusBadRequest, nil)
	}
	from, err := time.Parse(time.DateOnly, strings.TrimSpace(request.DateFrom))
	if err != nil || from.Format(time.DateOnly) != strings.TrimSpace(request.DateFrom) {
		return marketingSyncDateRange{}, newMarketingSyncFailure("invalid_date_range", http.StatusBadRequest, err)
	}
	to, err := time.Parse(time.DateOnly, strings.TrimSpace(request.DateTo))
	if err != nil || to.Format(time.DateOnly) != strings.TrimSpace(request.DateTo) {
		return marketingSyncDateRange{}, newMarketingSyncFailure("invalid_date_range", http.StatusBadRequest, err)
	}
	days := int(to.Sub(from).Hours()/24) + 1
	if days < 1 {
		return marketingSyncDateRange{}, newMarketingSyncFailure("invalid_date_range", http.StatusBadRequest, nil)
	}
	if days > marketingSyncMaxRangeDays {
		return marketingSyncDateRange{}, newMarketingSyncFailure("date_range_exceeds_90_days", http.StatusBadRequest, nil)
	}
	return marketingSyncDateRange{From: from.UTC(), To: to.UTC()}, nil
}

func chunkMarketingSyncDateRange(dateRange marketingSyncDateRange, maximumDays int) []marketingSyncDateRange {
	if maximumDays < 1 {
		maximumDays = 1
	}
	var chunks []marketingSyncDateRange
	for from := dateRange.From; !from.After(dateRange.To); {
		to := from.AddDate(0, 0, maximumDays-1)
		if to.After(dateRange.To) {
			to = dateRange.To
		}
		chunks = append(chunks, marketingSyncDateRange{From: from, To: to})
		from = to.AddDate(0, 0, 1)
	}
	return chunks
}

func marketingSyncScopedError(scope string, err error) string {
	return fmt.Sprintf("%s:%s", strings.TrimSpace(scope), marketingSyncErrorCode(err))
}

func deduplicateMarketingSyncErrors(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, min(len(values), marketingSyncMaxErrorCount))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
		if len(result) == marketingSyncMaxErrorCount {
			break
		}
	}
	return result
}

func truncateMarketingSyncText(value string, maximum int) string {
	value = strings.TrimSpace(value)
	if maximum <= 0 || len(value) <= maximum {
		return value
	}
	return value[:maximum]
}
