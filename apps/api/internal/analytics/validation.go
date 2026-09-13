package analytics

import (
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
)

var ErrInvalidInput = errors.New("invalid analytics input")

func dateOnly(values url.Values, key string) string {
	value := strings.TrimSpace(values.Get(key))
	if len(value) >= 10 {
		return value[:10]
	}
	return value
}

func validateSiteAnalyticsValues(values url.Values) error {
	const dateLayout = "2006-01-02"

	dates := make(map[string]time.Time, 2)
	for _, key := range []string{"dateFrom", "dateTo"} {
		value := strings.TrimSpace(values.Get(key))
		if value == "" {
			continue
		}

		parsed, err := time.Parse(dateLayout, value)
		if err != nil || parsed.Format(dateLayout) != value {
			return fmt.Errorf("%w: %s must use YYYY-MM-DD", ErrInvalidInput, key)
		}
		dates[key] = parsed
	}

	start, hasStart := dates["dateFrom"]
	end, hasEnd := dates["dateTo"]
	if hasStart != hasEnd {
		return fmt.Errorf("%w: dateFrom and dateTo must be provided together", ErrInvalidInput)
	}
	if !hasStart {
		return nil
	}
	if end.Before(start) {
		return fmt.Errorf("%w: dateTo must be on or after dateFrom", ErrInvalidInput)
	}
	if end.Sub(start) > 365*24*time.Hour {
		return fmt.Errorf("%w: date range cannot exceed 366 days", ErrInvalidInput)
	}

	return nil
}

func validateCampaignInsightsValues(values url.Values) error {
	const dateLayout = "2006-01-02"

	dates := make(map[string]time.Time, 2)
	for _, key := range []string{"dateFrom", "dateTo"} {
		value := strings.TrimSpace(values.Get(key))
		if value == "" {
			continue
		}

		parsed, err := time.Parse(dateLayout, value)
		if err != nil || parsed.Format(dateLayout) != value {
			return fmt.Errorf("%w: %s must use YYYY-MM-DD", ErrInvalidInput, key)
		}
		dates[key] = parsed
	}

	start, hasStart := dates["dateFrom"]
	end, hasEnd := dates["dateTo"]
	if !hasStart || !hasEnd {
		return fmt.Errorf("%w: dateFrom and dateTo are required", ErrInvalidInput)
	}
	if end.Before(start) {
		return fmt.Errorf("%w: dateTo must be on or after dateFrom", ErrInvalidInput)
	}
	if end.Sub(start) > 365*24*time.Hour {
		return fmt.Errorf("%w: date range cannot exceed 366 days", ErrInvalidInput)
	}

	for _, key := range []string{"teamId", "userId", "tagId"} {
		value := strings.TrimSpace(values.Get(key))
		if value == "" {
			continue
		}
		var id pgtype.UUID
		if err := id.Scan(value); err != nil || !id.Valid {
			return fmt.Errorf("%w: %s must be a UUID", ErrInvalidInput, key)
		}
	}

	for key, maximumLength := range map[string]int{
		"source":     120,
		"accountId":  255,
		"objective":  255,
		"campaignId": 255,
		"adSetId":    255,
		"adId":       255,
	} {
		value := strings.TrimSpace(values.Get(key))
		if len(value) > maximumLength || strings.ContainsRune(value, '\x00') {
			return fmt.Errorf("%w: %s is invalid", ErrInvalidInput, key)
		}
	}

	dealStatus := strings.TrimSpace(values.Get("dealStatus"))
	if dealStatus != "" && dealStatus != "open" && dealStatus != "won" && dealStatus != "lost" {
		return fmt.Errorf("%w: dealStatus is invalid", ErrInvalidInput)
	}

	return nil
}
