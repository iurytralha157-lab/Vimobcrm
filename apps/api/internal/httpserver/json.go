package httpserver

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
)

const DefaultJSONBodyLimit int64 = 1 << 20

var errMultipleJSONValues = errors.New("request body must contain a single JSON value")

// DecodeJSON decodes one strict, size-limited JSON object and writes the
// canonical public error response when the request body is invalid.
func DecodeJSON(
	w http.ResponseWriter,
	r *http.Request,
	target any,
	maxBytes int64,
) error {
	if maxBytes < 1 {
		maxBytes = DefaultJSONBodyLimit
	}
	if r.Body == nil {
		return writeInvalidJSON(w, r, io.EOF)
	}
	defer r.Body.Close()

	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, maxBytes))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil {
		return writeInvalidJSON(w, r, err)
	}

	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		if err == nil {
			err = errMultipleJSONValues
		}
		return writeInvalidJSON(w, r, err)
	}

	return nil
}

func DecodeJSONValue[T any](
	w http.ResponseWriter,
	r *http.Request,
	maxBytes int64,
) (T, bool) {
	var target T
	if err := DecodeJSON(w, r, &target, maxBytes); err != nil {
		return target, false
	}
	return target, true
}

func DecodeJSONMap(
	w http.ResponseWriter,
	r *http.Request,
	maxBytes int64,
) (map[string]any, bool) {
	payload, ok := DecodeJSONValue[map[string]any](w, r, maxBytes)
	if payload == nil {
		payload = map[string]any{}
	}
	return payload, ok
}

func writeInvalidJSON(w http.ResponseWriter, r *http.Request, err error) error {
	WriteError(w, r, http.StatusBadRequest, "invalid_json", "Request body is invalid.")
	return err
}
