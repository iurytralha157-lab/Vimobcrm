package httpserver

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
)

const StatusClientClosedRequest = 499

type ErrorEnvelope struct {
	Error APIError `json:"error"`
}

type APIError struct {
	Code      string `json:"code"`
	Message   string `json:"message"`
	RequestID string `json:"requestId,omitempty"`
}

func WriteJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func WriteError(w http.ResponseWriter, r *http.Request, status int, code string, message string) {
	if err := r.Context().Err(); errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		w.WriteHeader(StatusClientClosedRequest)
		return
	}

	WriteJSON(w, status, ErrorEnvelope{
		Error: APIError{
			Code:      code,
			Message:   message,
			RequestID: RequestIDFromContext(r.Context()),
		},
	})
}
