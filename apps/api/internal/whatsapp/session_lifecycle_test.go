package whatsapp

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/evolutionroute"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
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

func TestCreateSessionRequestValidatesOptionalCanaryID(t *testing.T) {
	const sessionID = "7ec1c269-e28a-41ca-82e7-237df52c550d"
	request := CreateSessionRequest{DisplayName: "Piloto", SessionID: ptrString(strings.ToUpper(sessionID))}
	input, err := request.Validate()
	if err != nil || input.SessionID != sessionID {
		t.Fatalf("validated pilot ID = %q, %v", input.SessionID, err)
	}
	for _, invalid := range []string{"", "not-a-uuid"} {
		request.SessionID = &invalid
		if _, err := request.Validate(); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("explicit invalid session ID %q should fail: %v", invalid, err)
		}
	}
	request.SessionID = nil
	input, err = request.Validate()
	if err != nil || input.SessionID != "" {
		t.Fatalf("ordinary create should leave session ID unassigned: %q, %v", input.SessionID, err)
	}
}

func TestCreateSessionIDOnlyAcceptsConfiguredCanary(t *testing.T) {
	const sessionID = "7ec1c269-e28a-41ca-82e7-237df52c550d"
	repo := Repository{functions: functionsClient{providerRoutes: evolutionroute.Config{
		Production: evolutionroute.Destination{
			APIURL: "https://evogo-prod.example.test", APIKey: "production-key",
			CallMediaHMACSecret: strings.Repeat("p", 32), ImageDigest: "sha256:" + strings.Repeat("a", 64),
		},
		Canary: evolutionroute.Destination{
			APIURL: "https://evogo-canary.example.test", APIKey: "canary-key",
			CallMediaHMACSecret: strings.Repeat("c", 32), ImageDigest: "sha256:" + strings.Repeat("b", 64),
		},
		CanarySessionIDs: []string{sessionID},
	}}}
	allowed, err := repo.sessionIDForCreate(createSessionInput{SessionID: sessionID})
	if err != nil || allowed != sessionID {
		t.Fatalf("allowlisted canary ID = %q, %v", allowed, err)
	}
	for _, rejected := range []string{"not-a-uuid", "42187162-cc3f-4945-afde-7af7b4483880"} {
		if _, err := repo.sessionIDForCreate(createSessionInput{SessionID: rejected}); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("unreserved ID %q should fail before DB/provider: %v", rejected, err)
		}
		if _, err := repo.CreateSession(context.Background(), tenant.Context{}, createSessionInput{SessionID: rejected}); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("unreserved ID %q reached DB/provider: %v", rejected, err)
		}
	}
	repo.functions.providerRoutes.Canary.APIKey = ""
	if _, err := repo.sessionIDForCreate(createSessionInput{SessionID: sessionID}); !errors.Is(err, ErrProviderFailed) {
		t.Fatalf("incomplete canary route should fail closed: %v", err)
	}
	ordinary, err := repo.sessionIDForCreate(createSessionInput{})
	if err != nil || ordinary == sessionID {
		t.Fatalf("ordinary create should allocate a distinct UUID: %q, %v", ordinary, err)
	}
}

func ptrString(value string) *string { return &value }
