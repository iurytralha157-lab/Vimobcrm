package gamification

type Envelope[T any] struct {
	Data T `json:"data"`
}

type RankingEntry struct {
	UserID         string  `json:"userId"`
	Name           string  `json:"name"`
	AvatarURL      *string `json:"avatarUrl"`
	Points         int     `json:"points"`
	XP             int     `json:"xp"`
	Level          int     `json:"level"`
	Rank           string  `json:"rank"`
	StreakDays     int     `json:"streakDays"`
	XPCurrentLevel int     `json:"xpCurrentLevel"`
	XPNextLevel    int     `json:"xpNextLevel"`
	LastActivityAt *string `json:"lastActivityAt"`
	Position       int     `json:"position"`
	IsCurrentUser  bool    `json:"isCurrentUser"`
}

type Event struct {
	ID        string  `json:"id"`
	UserID    *string `json:"userId"`
	UserName  string  `json:"userName"`
	EventType string  `json:"eventType"`
	Points    int     `json:"points"`
	CreatedAt *string `json:"createdAt"`
}

type Mission struct {
	ID              string  `json:"id"`
	Title           string  `json:"title"`
	Description     *string `json:"description"`
	TargetCount     int     `json:"targetCount"`
	CurrentProgress int     `json:"currentProgress"`
	BonusPoints     int     `json:"bonusPoints"`
	Period          *string `json:"period"`
}

type Overview struct {
	Ranking      []RankingEntry `json:"ranking"`
	RecentEvents []Event        `json:"recentEvents"`
	Missions     []Mission      `json:"missions"`
	TotalPoints  int            `json:"totalPoints"`
	ActiveUsers  int            `json:"activeUsers"`
	TotalEvents  int            `json:"totalEvents"`
	MyPosition   *int           `json:"myPosition"`
}
