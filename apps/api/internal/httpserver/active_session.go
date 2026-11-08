package httpserver

import (
	"context"
	"net/http"
	"strings"
	"time"
)

// ActiveSessionChecker checks whether a signed Supabase session still belongs
// to the authenticated user before a user route authorizes access.
type ActiveSessionChecker interface {
	IsActive(ctx context.Context, userID, sessionID string) (bool, error)
}

// RequireActiveSession runs after RequireAuth or RequirePasswordChangeAuth.
// Supabase sign-out removes the session row, but its JWT can remain valid until
// expiry. A failed lookup denies the operation rather than trusting that JWT.
func RequireActiveSession(checker ActiveSessionChecker, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, ok := UserFromContext(r.Context())
		if !ok || strings.TrimSpace(user.ID) == "" || strings.TrimSpace(user.SessionID) == "" {
			WriteError(w, r, http.StatusUnauthorized, "session_missing", "An active session is required.")
			return
		}
		if checker == nil {
			WriteError(w, r, http.StatusServiceUnavailable, "session_check_unavailable", "Session validation is unavailable.")
			return
		}

		checkCtx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
		active, err := checker.IsActive(checkCtx, user.ID, user.SessionID)
		cancel()
		if err != nil {
			WriteError(w, r, http.StatusServiceUnavailable, "session_check_unavailable", "Session validation is unavailable.")
			return
		}
		if !active {
			WriteError(w, r, http.StatusUnauthorized, "session_revoked", "The session is no longer active.")
			return
		}

		next.ServeHTTP(w, r)
	})
}
