package stageconfig

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"
)

const (
	InactivityClockStageEntry      = "stage_entry"
	InactivityClockLastInteraction = "last_interaction"
	InactivityStartAtActivation    = "activation"
	InactivityIncludeOverdue       = "include_overdue"
	inactivityMaximumAttempts      = 5
)

var ErrInactivityPolicyIncomplete = errors.New("stage inactivity requires an explicit policy")

// StageInactivityPolicy is a durable, explicit opt-in. The legacy automation
// updated_at is a CAS fence, never an activation timestamp or an activity clock.
type StageInactivityPolicy struct {
	AutomationID            string
	OrganizationID          string
	StageID                 string
	Epoch                   string
	Revision                int64
	Clock                   string
	StartMode               string
	ActivatedAt             time.Time
	AutomationUpdatedAt     time.Time
	InteractionCoverageFrom *time.Time
	Days                    int
	Message                 string
	Enabled                 bool
}

func (policy StageInactivityPolicy) Validate() error {
	for _, id := range []string{policy.AutomationID, policy.OrganizationID, policy.StageID, policy.Epoch} {
		if _, valid := normalizeUUID(id); !valid {
			return ErrInactivityPolicyIncomplete
		}
	}
	if policy.Revision < 1 || policy.ActivatedAt.IsZero() || policy.AutomationUpdatedAt.IsZero() || policy.Days < 1 || policy.Days > 3650 {
		return ErrInactivityPolicyIncomplete
	}
	if policy.Clock != InactivityClockStageEntry && policy.Clock != InactivityClockLastInteraction {
		return ErrInactivityPolicyIncomplete
	}
	if policy.StartMode != InactivityStartAtActivation && policy.StartMode != InactivityIncludeOverdue {
		return ErrInactivityPolicyIncomplete
	}
	if policy.Clock == InactivityClockLastInteraction && (policy.InteractionCoverageFrom == nil || policy.InteractionCoverageFrom.IsZero()) {
		return ErrInactivityPolicyIncomplete
	}
	if len([]rune(policy.Message)) > 1000 {
		return ErrInactivityPolicyIncomplete
	}
	return nil
}

type inactivityLeadState struct {
	OrganizationID string
	LeadID         string
	StageID        string
	ScopeCycle     string
	StageEnteredAt time.Time
	ScopeStartedAt time.Time
	LastActionAt   *time.Time
	LastActionID   *string
	IsOpen         bool
}

type inactivityEpisode struct {
	Key      string
	Baseline time.Time
	DueAt    time.Time
}

func evaluateInactivityEpisode(policy StageInactivityPolicy, lead inactivityLeadState) (inactivityEpisode, bool, error) {
	if err := policy.Validate(); err != nil {
		return inactivityEpisode{}, false, err
	}
	if !policy.Enabled || !lead.IsOpen || lead.OrganizationID != policy.OrganizationID || lead.StageID != policy.StageID {
		return inactivityEpisode{}, false, nil
	}
	if _, valid := normalizeUUID(lead.LeadID); !valid {
		return inactivityEpisode{}, false, ErrInactivityPolicyIncomplete
	}
	if _, valid := normalizeUUID(lead.ScopeCycle); !valid {
		return inactivityEpisode{}, false, ErrInactivityPolicyIncomplete
	}
	if lead.StageEnteredAt.IsZero() || lead.ScopeStartedAt.IsZero() {
		return inactivityEpisode{}, false, ErrInactivityPolicyIncomplete
	}
	baseline := laterTime(lead.StageEnteredAt, lead.ScopeStartedAt)
	if policy.Clock == InactivityClockLastInteraction {
		// Absence of old, partially enrolled facts is not proof of inactivity.
		// A server-verified coverage fence bounds the earliest provable clock.
		baseline = laterTime(baseline, *policy.InteractionCoverageFrom)
	}
	if policy.StartMode == InactivityStartAtActivation {
		baseline = laterTime(baseline, policy.ActivatedAt)
	}
	actionID := ""
	if policy.Clock == InactivityClockLastInteraction && lead.LastActionAt != nil && !lead.LastActionAt.Before(baseline) {
		baseline = *lead.LastActionAt
		if lead.LastActionID != nil {
			actionID = *lead.LastActionID
		}
	}
	// A new action at the same timestamp is still a different episode. Including
	// the stable fact ID avoids collapsing two durable interactions into one.
	// Ordinary policy revisions fence pending jobs but must not send the same
	// already-notified episode again after a message/threshold edit.
	keyParts := fmt.Sprintf("%s/%s/%s/%s/%s/%s/%s", policy.OrganizationID, policy.AutomationID, policy.Epoch, lead.LeadID, lead.ScopeCycle, baseline.UTC().Format(time.RFC3339Nano), actionID)
	hash := sha256.Sum256([]byte(keyParts))
	return inactivityEpisode{Key: hex.EncodeToString(hash[:]), Baseline: baseline, DueAt: baseline.Add(time.Duration(policy.Days) * 24 * time.Hour)}, true, nil
}

func inactivityNotificationDedupeKey(episodeKey, userID string, membershipGeneration int64) string {
	return fmt.Sprintf("stage-inactivity:%s:%s:%d", episodeKey, userID, membershipGeneration)
}

func inactivityRetry(attempt int, now time.Time) (string, time.Time) {
	if attempt >= inactivityMaximumAttempts {
		return "dead", now
	}
	if attempt < 1 {
		attempt = 1
	}
	return "pending", now.Add(time.Minute * time.Duration(1<<(attempt-1)))
}

func inactivityNotificationTitle(clock string) string {
	if clock == InactivityClockStageEntry {
		return "Prazo da etapa atingido"
	}
	return "Lead sem interação"
}

func inactivityNotificationContent(message string, days int, clock string) string {
	if message = strings.TrimSpace(message); message != "" {
		return message
	}
	unit := "dias"
	if days == 1 {
		unit = "dia"
	}
	if clock == InactivityClockStageEntry {
		return fmt.Sprintf("Este lead atingiu o prazo configurado de %d %s na etapa. Revise o atendimento.", days, unit)
	}
	return fmt.Sprintf("Este lead atingiu o prazo de inatividade configurado de %d %s. Revise o atendimento.", days, unit)
}

func laterTime(left, right time.Time) time.Time {
	if right.After(left) {
		return right
	}
	return left
}
