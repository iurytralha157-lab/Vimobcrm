package properties

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/url"
	"strconv"
	"strings"
	"time"
)

const (
	ownerPageDefaultLimit = 50
	ownerPageMaxLimit     = 100
	ownerSearchMaxLength  = 120
	ownerCursorMaxLength  = 2048
)

type OwnerListFilter struct {
	Search    string
	Limit     int
	Cursor    *ownerCursor
	Paginated bool
}

type OwnerPage struct {
	Items      []Owner
	NextCursor *string
	TotalCount int
}

type ownerCursor struct {
	NameKey   string    `json:"name"`
	CreatedAt time.Time `json:"created_at"`
	ID        string    `json:"id"`
}

func parseOwnerListFilter(values url.Values) (OwnerListFilter, error) {
	rawLimit := strings.TrimSpace(values.Get("limit"))
	rawCursor := strings.TrimSpace(values.Get("cursor"))
	search := strings.TrimSpace(values.Get("search"))
	paginated := rawLimit != "" || rawCursor != "" || search != ""
	if !paginated {
		return OwnerListFilter{}, nil
	}

	if len([]rune(search)) > ownerSearchMaxLength {
		return OwnerListFilter{}, fmt.Errorf("%w: owner search is too long", ErrInvalidInput)
	}

	limit := ownerPageDefaultLimit
	if rawLimit != "" {
		parsed, err := strconv.Atoi(rawLimit)
		if err != nil || parsed < 1 || parsed > ownerPageMaxLimit {
			return OwnerListFilter{}, fmt.Errorf("%w: owner page limit must be between 1 and %d", ErrInvalidInput, ownerPageMaxLimit)
		}
		limit = parsed
	}

	var cursor *ownerCursor
	if rawCursor != "" {
		decoded, err := decodeOwnerCursor(rawCursor)
		if err != nil {
			return OwnerListFilter{}, err
		}
		cursor = &decoded
	}

	return OwnerListFilter{
		Search:    search,
		Limit:     limit,
		Cursor:    cursor,
		Paginated: true,
	}, nil
}

func encodeOwnerCursor(cursor ownerCursor) (string, error) {
	cursor.ID = strings.TrimSpace(cursor.ID)
	if normalizedID, ok := normalizeUUID(cursor.ID); ok {
		cursor.ID = normalizedID
	} else {
		return "", fmt.Errorf("%w: owner cursor is invalid", ErrInvalidInput)
	}
	if cursor.CreatedAt.IsZero() || len([]rune(cursor.NameKey)) > 160 {
		return "", fmt.Errorf("%w: owner cursor is invalid", ErrInvalidInput)
	}

	payload, err := json.Marshal(cursor)
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(payload), nil
}

func decodeOwnerCursor(raw string) (ownerCursor, error) {
	if len(raw) > ownerCursorMaxLength {
		return ownerCursor{}, fmt.Errorf("%w: owner cursor is invalid", ErrInvalidInput)
	}

	payload, err := base64.RawURLEncoding.DecodeString(raw)
	if err != nil {
		return ownerCursor{}, fmt.Errorf("%w: owner cursor is invalid", ErrInvalidInput)
	}

	decoder := json.NewDecoder(strings.NewReader(string(payload)))
	decoder.DisallowUnknownFields()
	var cursor ownerCursor
	if err := decoder.Decode(&cursor); err != nil {
		return ownerCursor{}, fmt.Errorf("%w: owner cursor is invalid", ErrInvalidInput)
	}
	if err := decoder.Decode(&struct{}{}); err != io.EOF {
		return ownerCursor{}, fmt.Errorf("%w: owner cursor is invalid", ErrInvalidInput)
	}

	cursor.ID = strings.TrimSpace(cursor.ID)
	normalizedID, ok := normalizeUUID(cursor.ID)
	if !ok || cursor.CreatedAt.IsZero() || len([]rune(cursor.NameKey)) > 160 {
		return ownerCursor{}, fmt.Errorf("%w: owner cursor is invalid", ErrInvalidInput)
	}
	cursor.ID = normalizedID
	cursor.CreatedAt = cursor.CreatedAt.UTC()
	return cursor, nil
}
