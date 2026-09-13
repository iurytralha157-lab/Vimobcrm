package presence

import "time"

type Status string

const (
	StatusOnline  Status = "online"
	StatusIdle    Status = "idle"
	StatusOffline Status = "offline"
)

type User struct {
	UserID         string  `json:"user_id"`
	Name           string  `json:"name"`
	AvatarURL      *string `json:"avatar_url"`
	MemberRole     string  `json:"member_role"`
	IsTeamLeader   bool    `json:"is_team_leader"`
	PresenceStatus Status  `json:"presence_status"`
	LastSeenAt     *string `json:"last_seen_at"`
	IdleSinceAt    *string `json:"idle_since_at"`
}

// ListScope keeps tenant authorization separate from the presence query. An
// unrestricted scope is reserved for organization-wide permission holders;
// team leaders receive an explicit allow-list of users from their led teams.
type ListScope struct {
	OrganizationID    string
	RestrictToUserIDs bool
	UserIDs           []string
}

type Counts struct {
	Total   int `json:"total"`
	Online  int `json:"online"`
	Idle    int `json:"idle"`
	Offline int `json:"offline"`
}

type Data struct {
	Users       []User `json:"users"`
	Counts      Counts `json:"counts"`
	GeneratedAt string `json:"generated_at"`
}

type Response struct {
	Data Data `json:"data"`
}

func newData(users []User, generatedAt time.Time) Data {
	if users == nil {
		users = []User{}
	}

	counts := Counts{Total: len(users)}
	for _, user := range users {
		switch user.PresenceStatus {
		case StatusOnline:
			counts.Online++
		case StatusIdle:
			counts.Idle++
		case StatusOffline:
			counts.Offline++
		}
	}

	return Data{
		Users:       users,
		Counts:      counts,
		GeneratedAt: generatedAt.UTC().Format(time.RFC3339),
	}
}
