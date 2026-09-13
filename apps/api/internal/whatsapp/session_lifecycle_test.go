package whatsapp

import (
	"errors"
	"testing"
)

type lifecycleCommandTag int64

func (tag lifecycleCommandTag) RowsAffected() int64 {
	return int64(tag)
}

func TestRequireSessionLifecycleWriteFailsClosedOnLostFence(t *testing.T) {
	if err := requireSessionLifecycleWrite(lifecycleCommandTag(1), nil); err != nil {
		t.Fatalf("one fenced row should converge: %v", err)
	}

	err := requireSessionLifecycleWrite(lifecycleCommandTag(0), nil)
	if !errors.Is(err, errWhatsAppSessionLifecycleConflict) || !errors.Is(err, ErrProviderFailed) {
		t.Fatalf("zero-row CAS error = %v, want lifecycle conflict and provider failure", err)
	}

	storageErr := errors.New("storage unavailable")
	if err := requireSessionLifecycleWrite(lifecycleCommandTag(0), storageErr); !errors.Is(err, storageErr) {
		t.Fatalf("storage error = %v, want original error", err)
	}
}

func TestCreateWhatsAppSessionIDAllocatesCanonicalUniqueUUIDs(t *testing.T) {
	first, err := createWhatsAppSessionID()
	if err != nil {
		t.Fatal(err)
	}
	second, err := createWhatsAppSessionID()
	if err != nil {
		t.Fatal(err)
	}
	if first == second {
		t.Fatalf("session UUID collision: %q", first)
	}
	if normalized, ok := normalizeUUID(first); !ok || normalized != first {
		t.Fatalf("session ID = %q, want canonical UUID", first)
	}
}
