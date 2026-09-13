package site

import (
	"net/url"
	"strings"
)

func sanitizePublicPagePath(value string) string {
	normalized := strings.TrimSpace(value)
	if normalized == "" {
		return "/"
	}
	parsed, err := url.Parse(normalized)
	if err != nil {
		return "/"
	}
	path := parsed.EscapedPath()
	if path == "" || !strings.HasPrefix(path, "/") {
		return "/"
	}
	return truncatePublicNavigation(path, 2000)
}

func sanitizePublicNavigationPointer(value *string, maximumRunes int) *string {
	if value == nil {
		return nil
	}
	normalized := strings.TrimSpace(*value)
	if normalized == "" {
		return nil
	}
	parsed, err := url.Parse(normalized)
	if err != nil {
		return nil
	}

	var result string
	if parsed.IsAbs() {
		if parsed.Scheme != "http" && parsed.Scheme != "https" {
			return nil
		}
		if parsed.Host == "" {
			return nil
		}
		clean := url.URL{
			Scheme:  strings.ToLower(parsed.Scheme),
			Host:    strings.ToLower(parsed.Host),
			Path:    parsed.Path,
			RawPath: parsed.RawPath,
		}
		result = clean.String()
	} else {
		path := parsed.EscapedPath()
		if path == "" || !strings.HasPrefix(path, "/") {
			return nil
		}
		result = path
	}

	result = truncatePublicNavigation(result, maximumRunes)
	if result == "" {
		return nil
	}
	return &result
}

func truncatePublicNavigation(value string, maximumRunes int) string {
	runes := []rune(value)
	if len(runes) <= maximumRunes {
		return value
	}
	return string(runes[:maximumRunes])
}
