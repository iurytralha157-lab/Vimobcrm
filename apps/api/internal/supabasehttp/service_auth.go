package supabasehttp

import (
	"net/http"
	"strings"
)

// SetServiceAuth applies the Supabase service-key contract without exposing a
// newer opaque secret as a Bearer token. Legacy service-role JWTs still need
// Authorization for endpoints that validate the JWT payload.
func SetServiceAuth(request *http.Request, apiKey string) {
	request.Header.Set("apikey", apiKey)
	request.Header.Del("Authorization")

	segments := strings.Split(apiKey, ".")
	if len(segments) == 3 && segments[0] != "" && segments[1] != "" && segments[2] != "" {
		request.Header.Set("Authorization", "Bearer "+apiKey)
	}
}
