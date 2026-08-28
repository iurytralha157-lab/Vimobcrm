package httpserver

import (
	"log/slog"
	"net/http"
	"net/url"
	"runtime/debug"
	"strings"
	"time"

	authpkg "github.com/vimob-crm/vimob-crm/packages/auth"
)

type Middleware func(http.Handler) http.Handler

func Chain(handler http.Handler, middlewares ...Middleware) http.Handler {
	for i := len(middlewares) - 1; i >= 0; i-- {
		handler = middlewares[i](handler)
	}

	return handler
}

func Recover(logger *slog.Logger) Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				if recovered := recover(); recovered != nil {
					logger.Error("panic recovered",
						"error", recovered,
						"request_id", RequestIDFromContext(r.Context()),
						"stack", string(debug.Stack()),
					)
					WriteError(w, r, http.StatusInternalServerError, "internal_error", "Unexpected server error.")
				}
			}()

			next.ServeHTTP(w, r)
		})
	}
}

func LogRequests(logger *slog.Logger) Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			start := time.Now()
			recorder := &statusRecorder{ResponseWriter: w, status: http.StatusOK}

			next.ServeHTTP(recorder, r)

			logger.Info("http request",
				"method", r.Method,
				"path", safeRequestPath(r),
				"status", recorder.status,
				"duration_ms", time.Since(start).Milliseconds(),
				"request_id", RequestIDFromContext(r.Context()),
				"remote_addr", r.RemoteAddr,
			)
		})
	}
}

func safeRequestPath(r *http.Request) string {
	if r == nil || r.URL == nil {
		return ""
	}
	// Go 1.22+ fills Pattern after ServeMux dispatch. Prefer that stable route
	// template so path credentials never reach logs.
	if pattern := strings.TrimSpace(r.Pattern); pattern != "" {
		if _, route, found := strings.Cut(pattern, " "); found && strings.HasPrefix(route, "/") {
			return route
		}
		return pattern
	}

	// Preserve the safety property for requests that do not pass through a
	// ServeMux (including 404s and isolated handlers).
	segments := strings.Split(r.URL.Path, "/")
	grupoOLX := false
	for index, segment := range segments {
		if segment == "grupo-olx" {
			grupoOLX = true
			continue
		}
		if !grupoOLX || index+1 >= len(segments) {
			continue
		}
		switch segment {
		case "feed", "leads", "import-reports":
			segments[index+1] = "{token}"
		}
	}
	return strings.Join(segments, "/")
}

func CORS(allowedOrigins []string) Middleware {
	allowAll := false
	allowPrivateDevOrigins := false
	allowed := make(map[string]struct{}, len(allowedOrigins))
	for _, origin := range allowedOrigins {
		origin = strings.TrimSpace(origin)
		if origin == "*" {
			allowAll = true
			continue
		}
		if origin != "" {
			allowed[origin] = struct{}{}
			if isPrivateDevOrigin(origin) {
				allowPrivateDevOrigins = true
			}
		}
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			origin := r.Header.Get("Origin")
			if origin != "" {
				if allowAll {
					w.Header().Set("Access-Control-Allow-Origin", "*")
				} else if _, ok := allowed[origin]; ok || (allowPrivateDevOrigins && isPrivateDevOrigin(origin)) {
					w.Header().Set("Access-Control-Allow-Origin", origin)
					w.Header().Set("Vary", "Origin")
				}
			}

			w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization,Content-Type,Idempotency-Key,Last-Event-ID,X-Organization-ID,X-Request-ID,X-Webhook-Token")
			w.Header().Set("Access-Control-Expose-Headers", "X-Request-ID")
			w.Header().Set("Access-Control-Max-Age", "600")

			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}

			next.ServeHTTP(w, r)
		})
	}
}

func isPrivateDevOrigin(origin string) bool {
	parsed, err := url.Parse(origin)
	if err != nil || parsed.Scheme != "http" {
		return false
	}

	port := parsed.Port()
	if port != "" && port != "3000" && port != "3001" {
		return false
	}

	host := strings.ToLower(parsed.Hostname())
	if host == "localhost" || host == "127.0.0.1" || host == "0.0.0.0" {
		return true
	}
	if strings.HasPrefix(host, "192.168.") || strings.HasPrefix(host, "10.") {
		return true
	}
	if strings.HasPrefix(host, "172.") {
		secondOctet, _, ok := strings.Cut(strings.TrimPrefix(host, "172."), ".")
		if ok {
			switch secondOctet {
			case "16", "17", "18", "19", "20", "21", "22", "23", "24", "25", "26", "27", "28", "29", "30", "31":
				return true
			}
		}
	}

	return false
}

func RequireAuth(verifier *authpkg.Verifier, next http.Handler) http.Handler {
	return requireAuth(verifier, false, next)
}

// RequirePasswordChangeAuth permits a recovery session only for the exact
// password-change endpoint. All other authenticated routes must use RequireAuth.
func RequirePasswordChangeAuth(verifier *authpkg.Verifier, next http.Handler) http.Handler {
	return requireAuth(verifier, true, next)
}

func requireAuth(verifier *authpkg.Verifier, allowPasswordRecovery bool, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token := bearerToken(r.Header.Get("Authorization"))
		if token == "" {
			WriteError(w, r, http.StatusUnauthorized, "unauthorized", "Missing bearer token.")
			return
		}

		user, err := verifier.Verify(r.Context(), token)
		if err != nil {
			WriteError(w, r, http.StatusUnauthorized, "unauthorized", "Invalid or expired bearer token.")
			return
		}
		passwordRecoveryAllowed := allowPasswordRecovery &&
			r.Method == http.MethodPost &&
			r.URL.Path == "/v1/settings/password"
		if user.IsPasswordRecovery() && !passwordRecoveryAllowed {
			WriteError(w, r, http.StatusForbidden, "recovery_session_restricted", "Password recovery sessions cannot access this resource.")
			return
		}

		next.ServeHTTP(w, r.WithContext(ContextWithUser(r.Context(), user)))
	})
}

func bearerToken(header string) string {
	const prefix = "Bearer "
	if !strings.HasPrefix(header, prefix) {
		return ""
	}

	return strings.TrimSpace(strings.TrimPrefix(header, prefix))
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (recorder *statusRecorder) WriteHeader(status int) {
	recorder.status = status
	recorder.ResponseWriter.WriteHeader(status)
}

func (recorder *statusRecorder) Flush() {
	if flusher, ok := recorder.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

func (recorder *statusRecorder) Unwrap() http.ResponseWriter {
	return recorder.ResponseWriter
}
