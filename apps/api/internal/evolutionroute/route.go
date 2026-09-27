package evolutionroute

import (
	"errors"
	"net/url"
	"strings"
)

var ErrCanaryUnavailable = errors.New("Evolution Go canary route is unavailable")

type Destination struct {
	APIURL              string
	APIKey              string
	CallMediaHMACSecret string
	ImageDigest         string
}

type Config struct {
	Production       Destination
	Canary           Destination
	CanarySessionIDs []string
}

// ForSession selects only from server-owned UUIDs. Missing canary settings
// must never cause an allowlisted session to fall through to production.
func (config Config) ForSession(sessionID string) (Destination, error) {
	if config.IsCanarySession(sessionID) {
		canary := config.Canary
		canaryOrigin, validCanaryOrigin := normalizedOrigin(canary.APIURL)
		productionOrigin, validProductionOrigin := normalizedOrigin(config.Production.APIURL)
		if !validCanaryOrigin || strings.TrimSpace(canary.APIKey) == "" ||
			len(strings.TrimSpace(canary.CallMediaHMACSecret)) < 32 ||
			!validDigest(canary.ImageDigest) ||
			(validCanaryOrigin && validProductionOrigin && canaryOrigin == productionOrigin) ||
			canary.APIKey == config.Production.APIKey ||
			(config.Production.CallMediaHMACSecret != "" && canary.CallMediaHMACSecret == config.Production.CallMediaHMACSecret) {
			return Destination{}, ErrCanaryUnavailable
		}
		return canary, nil
	}
	return config.Production, nil
}

func (config Config) IsCanarySession(sessionID string) bool {
	if strings.TrimSpace(sessionID) == "" {
		return false
	}
	for _, allowedID := range config.CanarySessionIDs {
		if strings.EqualFold(strings.TrimSpace(allowedID), strings.TrimSpace(sessionID)) {
			return true
		}
	}
	return false
}

func validOrigin(raw string) bool {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	return err == nil && parsed != nil && (parsed.Scheme == "https" || parsed.Scheme == "http") &&
		parsed.Hostname() != "" && parsed.User == nil && parsed.RawQuery == "" && parsed.Fragment == "" &&
		(parsed.Path == "" || parsed.Path == "/")
}

func normalizedOrigin(raw string) (string, bool) {
	if !validOrigin(raw) {
		return "", false
	}
	parsed, _ := url.Parse(strings.TrimSpace(raw))
	port := parsed.Port()
	if port == "" {
		if parsed.Scheme == "https" {
			port = "443"
		} else {
			port = "80"
		}
	}
	return parsed.Scheme + "://" + strings.ToLower(parsed.Hostname()) + ":" + port, true
}

func validDigest(raw string) bool {
	raw = strings.TrimSpace(raw)
	if len(raw) != len("sha256:")+64 || !strings.HasPrefix(raw, "sha256:") {
		return false
	}
	for _, character := range strings.TrimPrefix(raw, "sha256:") {
		if (character < '0' || character > '9') && (character < 'a' || character > 'f') {
			return false
		}
	}
	return true
}
