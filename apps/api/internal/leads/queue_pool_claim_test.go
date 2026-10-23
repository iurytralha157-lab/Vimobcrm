package leads

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestQueuePoolClaimRequiresExplicitCASAndStableRequestKey(t *testing.T) {
	revision := int64(1)
	valid := ClaimQueuePoolRequest{RoundRobinID: "11111111-1111-4111-8111-111111111111", EpisodeID: "22222222-2222-4222-8222-222222222222", ExpectedRevision: &revision}
	if _, err := valid.validate("synthetic-claim"); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"", " key", "key ", strings.Repeat("x", 201), "request\nother"} {
		if _, err := valid.validate(key); !errors.Is(err, ErrInvalidInput) {
			t.Fatalf("unsafe key accepted: %v", err)
		}
	}
	valid.ExpectedRevision = nil
	if _, err := valid.validate("synthetic-claim"); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("a stale UI without a revision must not claim: %v", err)
	}
}

func TestQueuePoolClaimOutcomeDoesNotExposePrivatePoolExistence(t *testing.T) {
	for _, reason := range []string{"forbidden", "not_found"} {
		if changed, err := decodeQueuePoolClaimResult([]byte(`{"success":false,"reason":"` + reason + `"}`)); changed || !errors.Is(err, ErrLeadNotFound) {
			t.Fatalf("private denial leaked a different outcome for %s: %v", reason, err)
		}
	}
	for _, reason := range []string{"revision_conflict", "idempotency_key_conflict", "not_in_pool", "queue_busy"} {
		if changed, err := decodeQueuePoolClaimResult([]byte(`{"success":false,"reason":"` + reason + `"}`)); changed || !errors.Is(err, ErrQueuePoolConflict) {
			t.Fatalf("concurrent claim must conflict for %s: %v", reason, err)
		}
	}
	for _, reason := range []string{"claimed", "already_claimed"} {
		if changed, err := decodeQueuePoolClaimResult([]byte(`{"success":true,"reason":"` + reason + `"}`)); err != nil || changed != (reason == "claimed") {
			t.Fatalf("claim/replay must preserve transition identity: changed=%v reason=%s err=%v", changed, reason, err)
		}
	}
	for _, raw := range []string{`{}`, `null`, `{"success":true}`, `{"success":false,"reason":"claimed"}`, `{"success":true,"reason":"unknown"}`} {
		if changed, err := decodeQueuePoolClaimResult([]byte(raw)); changed || err == nil {
			t.Fatalf("malformed claim acknowledgement accepted: %s", raw)
		}
	}
}

func TestQueuePoolShortTimeoutNeverProducesAnEarlyWarning(t *testing.T) {
	for timeout := 1; timeout <= 5; timeout++ {
		policy, err := decodeRedistributionPolicy([]byte(`{"enable_redistribution":true,"redistribution_timeout_minutes":` + strconv.Itoa(timeout) + `,"redistribution_warning_minutes":5}`))
		if err != nil || policy.WarningMinutes != 0 {
			t.Fatalf("stored short deadline must preserve transfers and suppress warning: %#v %v", policy, err)
		}
		if redistributionJobShouldReceiveWarning(redistributionJob{TimeoutMinutes: timeout, WarningMinutes: 1}) {
			t.Fatalf("short deadline %d generated a warning", timeout)
		}
	}
}

func TestQueuePoolWorkerPanicDoesNotEscapeItsCycle(t *testing.T) {
	err := runRedistributionCycle(context.Background(), func(context.Context) error { panic("synthetic failure") })
	if err == nil || strings.Contains(err.Error(), "synthetic failure") {
		t.Fatalf("panic must be recovered without exposing its data: %v", err)
	}
	if err := runRedistributionCycle(context.Background(), func(context.Context) error { return nil }); err != nil {
		t.Fatalf("subsequent work must still run: %v", err)
	}
}

func TestQueuePoolClaimRequiresReadAndOperateAtRepositoryBoundary(t *testing.T) {
	actor := tenant.Context{OrganizationID: "11111111-1111-4111-8111-111111111111", UserID: "22222222-2222-4222-8222-222222222222", MemberRole: "broker"}
	for _, granted := range [][]string{{}, {permissions.LeadOperate}, {permissions.LeadViewOwn}} {
		actor.Permissions = granted
		if canClaimQueuePool(actor) {
			t.Fatalf("partial permissions may not claim: %v", granted)
		}
	}
	actor.Permissions = []string{permissions.LeadViewOwn, permissions.LeadOperate}
	if !canClaimQueuePool(actor) {
		t.Fatal("a broker with read/operate may proceed to the SQL audience check")
	}
}
