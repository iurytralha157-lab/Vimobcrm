package httpserver

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"net/http"

	authpkg "github.com/vimob-crm/vimob-crm/packages/auth"
)

type contextKey string

const (
	requestIDKey contextKey = "request_id"
	userKey      contextKey = "auth_user"
)

func ContextWithRequestID(ctx context.Context, requestID string) context.Context {
	return context.WithValue(ctx, requestIDKey, requestID)
}

func RequestIDFromContext(ctx context.Context) string {
	value, _ := ctx.Value(requestIDKey).(string)
	return value
}

func ContextWithUser(ctx context.Context, user authpkg.User) context.Context {
	return context.WithValue(ctx, userKey, user)
}

func UserFromContext(ctx context.Context) (authpkg.User, bool) {
	value, ok := ctx.Value(userKey).(authpkg.User)
	return value, ok
}

func RequestID(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestID := r.Header.Get("X-Request-ID")
		if requestID == "" {
			requestID = newRequestID()
		}

		w.Header().Set("X-Request-ID", requestID)
		next.ServeHTTP(w, r.WithContext(ContextWithRequestID(r.Context(), requestID)))
	})
}

func newRequestID() string {
	var bytes [16]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "request-id-unavailable"
	}

	return hex.EncodeToString(bytes[:])
}
