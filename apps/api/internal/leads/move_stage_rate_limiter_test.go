package leads

import (
	"testing"
	"time"
)

func TestMoveStageRateLimiterLimitsBurstAndRecovers(t *testing.T) {
	now := time.Date(2026, time.July, 17, 12, 0, 0, 0, time.UTC)
	limiter := newMoveStageRateLimiter()
	limiter.now = func() time.Time { return now }

	for i := 0; i < 15; i++ {
		if !limiter.allow("org:user") {
			t.Fatalf("request %d was limited before the burst limit", i+1)
		}
	}

	if limiter.allow("org:user") {
		t.Fatal("expected the 16th move inside 2 seconds to be rate limited")
	}

	if !limiter.allow("org:other-user") {
		t.Fatal("limiter must be scoped per user and organization")
	}

	now = now.Add(2 * time.Second)
	if !limiter.allow("org:user") {
		t.Fatal("expected limiter to recover after the short window")
	}
}
