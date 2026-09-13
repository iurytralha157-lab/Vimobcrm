package supabasehttp

import (
	"fmt"
	"net/url"
	"strings"
)

// EscapeObjectPath escapes each Storage object-name segment independently so
// path separators remain separators instead of becoming part of one segment.
func EscapeObjectPath(value string) string {
	parts := strings.Split(strings.Trim(value, "/"), "/")
	for index, part := range parts {
		parts[index] = url.PathEscape(part)
	}

	return strings.Join(parts, "/")
}

// PublicObjectURL builds the conventional unauthenticated URL for an object in
// a public bucket. Private objects must use an authenticated or signed URL.
func PublicObjectURL(projectURL string, bucket string, objectPath string) string {
	projectURL = strings.TrimRight(strings.TrimSpace(projectURL), "/")
	if projectURL == "" {
		return ""
	}

	return fmt.Sprintf(
		"%s/storage/v1/object/public/%s/%s",
		projectURL,
		url.PathEscape(bucket),
		EscapeObjectPath(objectPath),
	)
}
