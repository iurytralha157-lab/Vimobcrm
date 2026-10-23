package whatsapp

import (
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"
	"unicode/utf8"
)

const quickReplyLimit = 200

var (
	quickReplyShortcutPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$`)
	ErrQuickReplyNotFound     = errors.New("quick reply not found")
	ErrQuickReplyConflict     = errors.New("quick reply shortcut already exists")
	ErrQuickReplyLimit        = errors.New("quick reply limit reached")
)

// QuickReply is personal to the authenticated user in the active organization.
// Ownership and internal quota slots are never accepted or returned by this API.
type QuickReply struct {
	ID        string    `json:"id"`
	Shortcut  string    `json:"shortcut"`
	Content   string    `json:"content"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type QuickReplyRequest struct {
	Shortcut string `json:"shortcut"`
	Content  string `json:"content"`
}

type QuickReplyPatchRequest struct {
	Shortcut quickReplyPatchString `json:"shortcut"`
	Content  quickReplyPatchString `json:"content"`
}

type quickReplyPatchString struct {
	Set   bool
	Value *string
}

type quickReplyInput struct {
	Shortcut string
	Content  string
}

type quickReplyPatchInput struct {
	ShortcutSet bool
	Shortcut    string
	ContentSet  bool
	Content     string
}

func (field *quickReplyPatchString) UnmarshalJSON(data []byte) error {
	field.Set = true
	return json.Unmarshal(data, &field.Value)
}

func normalizeQuickReplyShortcut(value string) (string, error) {
	value = strings.TrimPrefix(strings.TrimSpace(value), "/")
	// Validate ASCII before lowercasing, so Unicode lookalikes cannot become aliases.
	if !quickReplyShortcutPattern.MatchString(value) {
		return "", fmt.Errorf("%w: shortcut must contain 1 to 40 ASCII letters, numbers, underscores or hyphens and start with a letter or number", ErrInvalidInput)
	}
	return strings.ToLower(value), nil
}

func validateQuickReplyContent(value string) error {
	if !utf8.ValidString(value) || strings.ContainsRune(value, '\x00') || strings.TrimSpace(value) == "" || utf8.RuneCountInString(value) > 4000 {
		return fmt.Errorf("%w: content must contain 1 to 4000 characters and cannot be blank", ErrInvalidInput)
	}
	return nil
}

func (request QuickReplyRequest) Validate() (quickReplyInput, error) {
	shortcut, err := normalizeQuickReplyShortcut(request.Shortcut)
	if err != nil {
		return quickReplyInput{}, err
	}
	if err := validateQuickReplyContent(request.Content); err != nil {
		return quickReplyInput{}, err
	}
	return quickReplyInput{Shortcut: shortcut, Content: request.Content}, nil
}

func (request QuickReplyPatchRequest) Validate() (quickReplyPatchInput, error) {
	input := quickReplyPatchInput{}
	if request.Shortcut.Set {
		if request.Shortcut.Value == nil {
			return input, fmt.Errorf("%w: shortcut cannot be null", ErrInvalidInput)
		}
		shortcut, err := normalizeQuickReplyShortcut(*request.Shortcut.Value)
		if err != nil {
			return input, err
		}
		input.ShortcutSet, input.Shortcut = true, shortcut
	}
	if request.Content.Set {
		if request.Content.Value == nil {
			return input, fmt.Errorf("%w: content cannot be null", ErrInvalidInput)
		}
		if err := validateQuickReplyContent(*request.Content.Value); err != nil {
			return input, err
		}
		input.ContentSet, input.Content = true, *request.Content.Value
	}
	if !input.ShortcutSet && !input.ContentSet {
		return input, fmt.Errorf("%w: at least one field is required", ErrInvalidInput)
	}
	return input, nil
}
