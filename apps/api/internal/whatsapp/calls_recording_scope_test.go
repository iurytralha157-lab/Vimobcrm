package whatsapp

import (
	"strings"
	"testing"

	"github.com/jackc/pgx/v5/pgtype"
)

func TestCallRecordingWorkerScopeFailsClosedOutsideExactCanaryUUIDs(t *testing.T) {
	full, err := newCallRecordingWorkerScope(false, nil)
	if err != nil || full.restricted || len(full.sessionIDs) != 0 {
		t.Fatalf("normal worker scope = %+v, %v; want unrestricted", full, err)
	}

	for _, invalid := range [][]string{
		nil,
		{},
		{"*"},
		{""},
		{"not-a-uuid"},
		{"13eea7e8-a74f-4bfb-bb36-024e3d26ccc9", "*"},
	} {
		if scope, err := newCallRecordingWorkerScope(true, invalid); err == nil || scope.restricted {
			t.Fatalf("recording-only scope accepted invalid allowlist %q: %+v, %v", invalid, scope, err)
		}
	}

	scope, err := newCallRecordingWorkerScope(true, []string{
		"13EEA7E8-A74F-4BFB-BB36-024E3D26CCC9",
		"13eea7e8-a74f-4bfb-bb36-024e3d26ccc9",
		" 55f02ce7-4290-47f8-9ee3-61fc84619747 ",
	})
	if err != nil || !scope.restricted || len(scope.sessionIDs) != 2 ||
		scope.sessionIDs[0].String() != "13eea7e8-a74f-4bfb-bb36-024e3d26ccc9" ||
		scope.sessionIDs[1].String() != "55f02ce7-4290-47f8-9ee3-61fc84619747" {
		t.Fatalf("recording-only scope = %+v, %v; want two canonical UUIDs", scope, err)
	}

	// The claim queries cast the bound array to uuid[], so verify pgx can
	// encode the exact value passed by both worker lanes.
	codec := pgtype.NewMap()
	encoded, err := codec.Encode(pgtype.UUIDArrayOID, pgtype.BinaryFormatCode, scope.sessionIDs, nil)
	if err != nil || len(encoded) == 0 {
		t.Fatalf("encode scoped uuid[] parameter: bytes=%d err=%v", len(encoded), err)
	}
}

func TestCallRecordingWorkerClaimsApplyTheSameSessionPredicate(t *testing.T) {
	for name, query := range map[string]string{
		"call webhook retry": callWebhookRetryClaimSQL,
		"pending recording":  callRecordingClaimSQL,
	} {
		normalized := strings.Join(strings.Fields(strings.ToLower(query)), " ")
		if !strings.Contains(normalized, "$1::boolean = false or ") ||
			!strings.Contains(normalized, "session_id = any($2::uuid[])") ||
			!strings.Contains(normalized, "for update") ||
			!strings.Contains(normalized, "skip locked") {
			t.Errorf("%s claim must lock only eligible rows and require an exact uuid[] session match in recording-only mode", name)
		}
	}
}
