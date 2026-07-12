package gamification

import "time"

type Envelope[T any] struct {
	Data T `json:"data"`
}

type RankingEntry struct {
	UserID         string  `json:"userId"`
	Name           string  `json:"name"`
	AvatarURL      *string `json:"avatarUrl"`
	Points         int64   `json:"points"`
	XP             int64   `json:"xp"`
	Level          int     `json:"level"`
	Rank           string  `json:"rank"`
	StreakDays     int     `json:"streakDays"`
	XPCurrentLevel int64   `json:"xpCurrentLevel"`
	XPNextLevel    int64   `json:"xpNextLevel"`
	LastActivityAt *string `json:"lastActivityAt"`
	Position       int     `json:"position"`
	IsCurrentUser  bool    `json:"isCurrentUser"`
}

// RankingQuery is the server-side filter used by the Arena ranking. From and
// To form a half-open interval [From, To); an empty ActionTypes slice includes
// every canonical action in the active season.
type RankingQuery struct {
	From        *time.Time
	To          *time.Time
	ActionTypes []string
}

type Event struct {
	ID        string  `json:"id"`
	UserID    *string `json:"userId"`
	UserName  string  `json:"userName"`
	EventType string  `json:"eventType"`
	Points    int64   `json:"points"`
	CreatedAt *string `json:"createdAt"`
	Details   *string `json:"details"`
	Source    *string `json:"source"`
}

type EventPage struct {
	Events     []Event `json:"events"`
	Total      int64   `json:"total"`
	NextCursor *string `json:"nextCursor"`
}

type EventQuery struct {
	From             *time.Time
	To               *time.Time
	UserID           string
	Limit            int
	CursorOccurredAt *time.Time
	CursorID         string
}

type Mission struct {
	ID              string  `json:"id"`
	Title           string  `json:"title"`
	Description     *string `json:"description"`
	ActionType      *string `json:"actionType"`
	TargetCount     int64   `json:"targetCount"`
	CurrentProgress int64   `json:"currentProgress"`
	BonusPoints     int64   `json:"bonusPoints"`
	Period          *string `json:"period"`
	IsActive        bool    `json:"isActive"`
	TargetScope     string  `json:"targetScope"`
	TargetUserID    *string `json:"targetUserId"`
	CreatedAt       *string `json:"createdAt"`
	UpdatedAt       *string `json:"updatedAt"`
}

type PerformanceDay struct {
	Name    string `json:"name"`
	Points  int64  `json:"points"`
	Actions int    `json:"actions"`
}

type PerformanceMetrics struct {
	Points           int64   `json:"points"`
	Growth           int     `json:"growth"`
	AvgActionsPerDay float64 `json:"avgActionsPerDay"`
	TotalActions     int     `json:"totalActions"`
	Efficiency       int     `json:"efficiency"`
	Consistency      int     `json:"consistency"`
}

type ActivityDistribution struct {
	Label string `json:"label"`
	Value int    `json:"value"`
}

type Performance struct {
	ChartData    []PerformanceDay       `json:"chartData"`
	Metrics      PerformanceMetrics     `json:"metrics"`
	Distribution []ActivityDistribution `json:"distribution"`
}

type Overview struct {
	Ranking      []RankingEntry `json:"ranking"`
	RecentEvents []Event        `json:"recentEvents"`
	History      []Event        `json:"history"`
	Missions     []Mission      `json:"missions"`
	Performance  Performance    `json:"performance"`
	TotalPoints  int64          `json:"totalPoints"`
	ActiveUsers  int            `json:"activeUsers"`
	TotalEvents  int            `json:"totalEvents"`
	MyPosition   *int           `json:"myPosition"`
}

type Rule struct {
	ID         string `json:"id"`
	ActionType string `json:"actionType"`
	Points     int64  `json:"points"`
	IsActive   bool   `json:"isActive"`
	IsTemp     bool   `json:"isTemp"`
}

type Participant struct {
	UserID       string `json:"userId"`
	Name         string `json:"name"`
	Email        string `json:"email"`
	Role         string `json:"role"`
	IsActive     bool   `json:"isActive"`
	Participates bool   `json:"participates"`
	Points       int64  `json:"points"`
}

type Season struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	ResetReason *string `json:"resetReason"`
	IsActive    bool    `json:"isActive"`
	StartedAt   *string `json:"startedAt"`
	EndedAt     *string `json:"endedAt"`
	CreatedAt   *string `json:"createdAt"`
}

type ManualEntry struct {
	ID              string  `json:"id"`
	UserID          string  `json:"userId"`
	UserName        string  `json:"userName"`
	ActionKey       string  `json:"actionKey"`
	Quantity        int     `json:"quantity"`
	Notes           *string `json:"notes"`
	Status          string  `json:"status"`
	ApprovedBy      *string `json:"approvedBy"`
	ApprovedAt      *string `json:"approvedAt"`
	RejectionReason *string `json:"rejectionReason"`
	AwardedAt       *string `json:"awardedAt"`
	AwardStatus     *string `json:"awardStatus"`
	CreatedAt       *string `json:"createdAt"`
}

type UserOption struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type AdminSnapshot struct {
	Rules                []Rule        `json:"rules"`
	Missions             []Mission     `json:"missions"`
	Participants         []Participant `json:"participants"`
	Seasons              []Season      `json:"seasons"`
	MyManualEntries      []ManualEntry `json:"myManualEntries"`
	PendingManualEntries []ManualEntry `json:"pendingManualEntries"`
	Users                []UserOption  `json:"users"`
	CanManage            bool          `json:"canManage"`
}

type RuleRequest struct {
	Points   int64 `json:"points"`
	IsActive *bool `json:"isActive"`
}

type ParticipantRequest struct {
	Participates bool `json:"participates"`
}

type MissionRequest struct {
	Title        string  `json:"title"`
	Description  *string `json:"description"`
	ActionType   *string `json:"actionType"`
	TargetCount  int64   `json:"targetCount"`
	BonusPoints  int64   `json:"bonusPoints"`
	Period       *string `json:"period"`
	TargetScope  string  `json:"targetScope"`
	TargetUserID *string `json:"targetUserId"`
	IsActive     *bool   `json:"isActive"`
}

type ManualEntryRequest struct {
	ActionKey string `json:"actionKey"`
	Quantity  int    `json:"quantity"`
	Notes     string `json:"notes"`
}

type ManualEntryDecisionRequest struct {
	Status string `json:"status"`
	Reason string `json:"reason"`
}

type SeasonRequest struct {
	Name   string `json:"name"`
	Reason string `json:"reason"`
}
