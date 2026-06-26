package leads

const maxLeadEnrichmentIDs = 500

type LeadEnrichment struct {
	LeadID           string                  `json:"lead_id"`
	Tags             []LeadEnrichmentTag     `json:"tags"`
	TasksCount       LeadEnrichmentTaskCount `json:"tasks_count"`
	Assignee         *LeadEnrichmentUser     `json:"assignee"`
	InterestProperty *LeadEnrichmentProperty `json:"interest_property"`
	LeadMeta         []LeadEnrichmentMeta    `json:"lead_meta"`
}

type LeadEnrichmentTag struct {
	ID    string  `json:"id"`
	Name  *string `json:"name"`
	Color *string `json:"color"`
}

type LeadEnrichmentTaskCount struct {
	Pending   int `json:"pending"`
	Completed int `json:"completed"`
}

type LeadEnrichmentUser struct {
	ID        string  `json:"id"`
	Name      *string `json:"name"`
	AvatarURL *string `json:"avatar_url"`
}

type LeadEnrichmentProperty struct {
	ID    string   `json:"id"`
	Code  *string  `json:"code"`
	Title *string  `json:"title"`
	Price *float64 `json:"preco"`
}

type LeadEnrichmentMeta struct {
	LeadID       string  `json:"lead_id"`
	CampaignName *string `json:"campaign_name"`
	CampaignID   *string `json:"campaign_id"`
	AdsetName    *string `json:"adset_name"`
	AdsetID      *string `json:"adset_id"`
	AdName       *string `json:"ad_name"`
	AdID         *string `json:"ad_id"`
	Platform     *string `json:"platform"`
}

type visibleLeadEnrichmentSeed struct {
	LeadID             string
	AssignedUserID     string
	InterestPropertyID string
}
