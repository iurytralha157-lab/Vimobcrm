package leads

import (
	"strings"
	"sync"
	"time"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

const moveStageRateLimitCleanupEvery = 1024

var defaultMoveStageRateLimiter = newMoveStageRateLimiter()

type moveStageRateLimitRule struct {
	limit  int
	window time.Duration
}

type moveStageRateLimiter struct {
	mu                   sync.Mutex
	now                  func() time.Time
	requestsByKey        map[string][]time.Time
	requestsSinceCleanup int
	rules                []moveStageRateLimitRule
	maxWindow            time.Duration
}

func newMoveStageRateLimiter() *moveStageRateLimiter {
	rules := []moveStageRateLimitRule{
		{limit: 15, window: 2 * time.Second},
		{limit: 120, window: time.Minute},
	}

	return &moveStageRateLimiter{
		now:           time.Now,
		requestsByKey: make(map[string][]time.Time),
		rules:         rules,
		maxWindow:     maxRateLimitWindow(rules),
	}
}

func (handler Handler) allowMoveStageRequest(tenantContext tenant.Context) bool {
	limiter := handler.moveStageLimiter
	if limiter == nil {
		limiter = defaultMoveStageRateLimiter
	}

	return limiter.allow(moveStageRateLimitKey(tenantContext))
}

func (limiter *moveStageRateLimiter) allow(key string) bool {
	if limiter == nil {
		return true
	}

	key = strings.TrimSpace(key)
	if key == "" {
		key = "anonymous"
	}

	now := limiter.now()

	limiter.mu.Lock()
	defer limiter.mu.Unlock()

	recent := limiter.pruneLocked(key, now)
	for _, rule := range limiter.rules {
		count := 0
		for _, happenedAt := range recent {
			if now.Sub(happenedAt) < rule.window {
				count++
			}
		}
		if count >= rule.limit {
			limiter.requestsByKey[key] = recent
			return false
		}
	}

	limiter.requestsByKey[key] = append(recent, now)
	limiter.requestsSinceCleanup++
	if limiter.requestsSinceCleanup >= moveStageRateLimitCleanupEvery {
		limiter.cleanupLocked(now)
	}

	return true
}

func (limiter *moveStageRateLimiter) pruneLocked(key string, now time.Time) []time.Time {
	requests := limiter.requestsByKey[key]
	if len(requests) == 0 {
		return requests
	}

	recent := requests[:0]
	for _, happenedAt := range requests {
		if now.Sub(happenedAt) < limiter.maxWindow {
			recent = append(recent, happenedAt)
		}
	}

	return recent
}

func (limiter *moveStageRateLimiter) cleanupLocked(now time.Time) {
	for key, requests := range limiter.requestsByKey {
		recent := requests[:0]
		for _, happenedAt := range requests {
			if now.Sub(happenedAt) < limiter.maxWindow {
				recent = append(recent, happenedAt)
			}
		}
		if len(recent) == 0 {
			delete(limiter.requestsByKey, key)
			continue
		}
		limiter.requestsByKey[key] = recent
	}
	limiter.requestsSinceCleanup = 0
}

func moveStageRateLimitKey(tenantContext tenant.Context) string {
	return strings.Join([]string{
		strings.TrimSpace(tenantContext.OrganizationID),
		strings.TrimSpace(tenantContext.UserID),
	}, ":")
}

func maxRateLimitWindow(rules []moveStageRateLimitRule) time.Duration {
	var maxWindow time.Duration
	for _, rule := range rules {
		if rule.window > maxWindow {
			maxWindow = rule.window
		}
	}
	return maxWindow
}
