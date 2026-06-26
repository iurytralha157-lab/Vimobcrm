package roundrobin

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
)

var (
	ErrInvalidInput       = errors.New("invalid round robin input")
	ErrInvalidReference   = errors.New("invalid round robin reference")
	ErrRoundRobinNotFound = errors.New("round robin not found")
	ErrRuleNotFound       = errors.New("round robin rule not found")
	ErrMemberNotFound     = errors.New("round robin member not found")
	ErrNoChanges          = errors.New("no round robin changes provided")
	ErrConditionConflict  = errors.New("round robin condition conflict")
)

type RoundRobin struct {
	ID                string           `json:"id"`
	OrganizationID    string           `json:"organizationId"`
	Name              string           `json:"name"`
	IsActive          bool             `json:"isActive"`
	LastAssignedIndex int              `json:"lastAssignedIndex"`
	CreatedBy         string           `json:"createdBy,omitempty"`
	CreatedByUser     *UserSummary     `json:"createdByUser,omitempty"`
	Strategy          string           `json:"strategy"`
	LeadsDistributed  int64            `json:"leadsDistributed"`
	TargetPipelineID  string           `json:"targetPipelineId,omitempty"`
	TargetStageID     string           `json:"targetStageId,omitempty"`
	Settings          map[string]any   `json:"settings,omitempty"`
	ReentryBehavior   string           `json:"reentryBehavior,omitempty"`
	TargetPipeline    *PipelineSummary `json:"targetPipeline,omitempty"`
	TargetStage       *StageSummary    `json:"targetStage,omitempty"`
	Rules             []Rule           `json:"rules"`
	Members           []Member         `json:"members"`
	CreatedAt         time.Time        `json:"createdAt"`
	UpdatedAt         time.Time        `json:"updatedAt"`
}

type UserSummary struct {
	ID        string `json:"id"`
	Name      string `json:"name,omitempty"`
	Email     string `json:"email,omitempty"`
	AvatarURL string `json:"avatarUrl,omitempty"`
}

type PipelineSummary struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type StageSummary struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Color string `json:"color,omitempty"`
}

type Rule struct {
	ID           string         `json:"id"`
	RoundRobinID string         `json:"roundRobinId"`
	MatchType    string         `json:"matchType"`
	MatchValue   string         `json:"matchValue"`
	Match        map[string]any `json:"match,omitempty"`
	Priority     int            `json:"priority"`
	IsActive     bool           `json:"isActive"`
	CreatedAt    time.Time      `json:"createdAt"`
	UpdatedAt    time.Time      `json:"updatedAt"`
}

type Member struct {
	ID           string       `json:"id"`
	RoundRobinID string       `json:"roundRobinId"`
	UserID       string       `json:"userId"`
	TeamID       string       `json:"teamId,omitempty"`
	Position     int          `json:"position"`
	Weight       int          `json:"weight"`
	IsActive     bool         `json:"isActive"`
	User         *UserSummary `json:"user,omitempty"`
	LeadsCount   int64        `json:"leadsCount"`
}

type patchString struct {
	Set   bool
	Value *string
}

type patchBool struct {
	Set   bool
	Value *bool
}

type patchObject struct {
	Set   bool
	Value map[string]any
}

type CreateRequest struct {
	Name             string           `json:"name"`
	Strategy         string           `json:"strategy,omitempty"`
	TargetPipelineID string           `json:"targetPipelineId,omitempty"`
	TargetStageID    string           `json:"targetStageId,omitempty"`
	IsActive         *bool            `json:"isActive,omitempty"`
	Settings         map[string]any   `json:"settings,omitempty"`
	ReentryBehavior  string           `json:"reentryBehavior,omitempty"`
	Conditions       []ConditionInput `json:"conditions,omitempty"`
	Rules            []RuleInput      `json:"rules,omitempty"`
	Members          []MemberInput    `json:"members,omitempty"`
}

type UpdateRequest struct {
	Name             patchString      `json:"name,omitempty"`
	Strategy         patchString      `json:"strategy,omitempty"`
	TargetPipelineID patchString      `json:"targetPipelineId,omitempty"`
	TargetStageID    patchString      `json:"targetStageId,omitempty"`
	IsActive         patchBool        `json:"isActive,omitempty"`
	Settings         patchObject      `json:"settings,omitempty"`
	ReentryBehavior  patchString      `json:"reentryBehavior,omitempty"`
	Conditions       []ConditionInput `json:"conditions,omitempty"`
	ConditionsSet    bool             `json:"-"`
	Rules            []RuleInput      `json:"rules,omitempty"`
	RulesSet         bool             `json:"-"`
	Members          []MemberInput    `json:"members,omitempty"`
	MembersSet       bool             `json:"-"`
}

type RuleRequest struct {
	RoundRobinID string         `json:"roundRobinId,omitempty"`
	MatchType    string         `json:"matchType"`
	MatchValue   string         `json:"matchValue"`
	Match        map[string]any `json:"match,omitempty"`
	Priority     *int           `json:"priority,omitempty"`
	IsActive     *bool          `json:"isActive,omitempty"`
}

type UpdateRuleRequest struct {
	MatchType  patchString `json:"matchType,omitempty"`
	MatchValue patchString `json:"matchValue,omitempty"`
	Match      patchObject `json:"match,omitempty"`
	Priority   *int        `json:"priority,omitempty"`
	IsActive   patchBool   `json:"isActive,omitempty"`
}

type MemberRequest struct {
	UserID   string `json:"userId,omitempty"`
	TeamID   string `json:"teamId,omitempty"`
	Type     string `json:"type,omitempty"`
	EntityID string `json:"entityId,omitempty"`
	Weight   *int   `json:"weight,omitempty"`
	Position *int   `json:"position,omitempty"`
	IsActive *bool  `json:"isActive,omitempty"`
}

type UpdateMemberRequest struct {
	Weight   *int      `json:"weight,omitempty"`
	Position *int      `json:"position,omitempty"`
	IsActive patchBool `json:"isActive,omitempty"`
}

type ConditionInput struct {
	ID     string   `json:"id,omitempty"`
	Type   string   `json:"type"`
	Values []string `json:"values"`
}

type RuleInput struct {
	ID         string         `json:"id,omitempty"`
	MatchType  string         `json:"matchType,omitempty"`
	MatchValue string         `json:"matchValue,omitempty"`
	Match      map[string]any `json:"match,omitempty"`
	Priority   *int           `json:"priority,omitempty"`
	IsActive   *bool          `json:"isActive,omitempty"`
}

type MemberInput struct {
	ID       string `json:"id,omitempty"`
	Type     string `json:"type,omitempty"`
	EntityID string `json:"entityId,omitempty"`
	UserID   string `json:"userId,omitempty"`
	TeamID   string `json:"teamId,omitempty"`
	Weight   *int   `json:"weight,omitempty"`
}

type createInput struct {
	Name             string
	Strategy         string
	TargetPipelineID *string
	TargetStageID    *string
	IsActive         bool
	Settings         map[string]any
	ReentryBehavior  string
	Rules            []ruleInput
	Members          []memberInput
}

type updateInput struct {
	Name             patchString
	Strategy         patchString
	TargetPipelineID patchString
	TargetStageID    patchString
	IsActive         patchBool
	Settings         patchObject
	ReentryBehavior  patchString
	Rules            []ruleInput
	RulesSet         bool
	Members          []memberInput
	MembersSet       bool
}

type ruleInput struct {
	MatchType  string
	MatchValue string
	Match      map[string]any
	Priority   int
	IsActive   bool
}

type memberInput struct {
	Type     string
	EntityID string
	UserID   *string
	TeamID   *string
	Weight   int
}

type ruleMutationInput struct {
	RoundRobinID string
	MatchType    string
	MatchValue   string
	Match        map[string]any
	Priority     int
	IsActive     bool
}

type updateRuleInput struct {
	MatchType  patchString
	MatchValue patchString
	Match      patchObject
	Priority   *int
	IsActive   patchBool
}

type memberMutationInput struct {
	UserID   *string
	TeamID   *string
	Type     string
	EntityID string
	Weight   int
	Position *int
	IsActive bool
}

type updateMemberInput struct {
	Weight   *int
	Position *int
	IsActive patchBool
}

func (field *patchString) UnmarshalJSON(data []byte) error {
	field.Set = true
	if bytes.Equal(bytes.TrimSpace(data), []byte("null")) {
		field.Value = nil
		return nil
	}

	var value string
	if err := json.Unmarshal(data, &value); err != nil {
		return fmt.Errorf("%w: expected string or null", ErrInvalidInput)
	}
	field.Value = &value
	return nil
}

func (field *patchBool) UnmarshalJSON(data []byte) error {
	field.Set = true
	if bytes.Equal(bytes.TrimSpace(data), []byte("null")) {
		field.Value = nil
		return nil
	}

	var value bool
	if err := json.Unmarshal(data, &value); err != nil {
		return fmt.Errorf("%w: expected boolean or null", ErrInvalidInput)
	}
	field.Value = &value
	return nil
}

func (field *patchObject) UnmarshalJSON(data []byte) error {
	field.Set = true
	if bytes.Equal(bytes.TrimSpace(data), []byte("null")) {
		field.Value = nil
		return nil
	}

	var value map[string]any
	if err := json.Unmarshal(data, &value); err != nil {
		return fmt.Errorf("%w: expected object or null", ErrInvalidInput)
	}
	field.Value = value
	return nil
}

func (request *UpdateRequest) UnmarshalJSON(data []byte) error {
	type alias UpdateRequest
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}

	var decoded alias
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	*request = UpdateRequest(decoded)
	_, request.ConditionsSet = raw["conditions"]
	_, request.RulesSet = raw["rules"]
	_, request.MembersSet = raw["members"]
	return nil
}

func (request CreateRequest) Validate() (createInput, error) {
	name := trimMax(request.Name, 120)
	if len([]rune(name)) < 2 {
		return createInput{}, fmt.Errorf("%w: name must have at least 2 characters", ErrInvalidInput)
	}

	strategy := normalizeStrategy(request.Strategy)
	isActive := true
	if request.IsActive != nil {
		isActive = *request.IsActive
	}

	input := createInput{
		Name:            name,
		Strategy:        strategy,
		IsActive:        isActive,
		Settings:        normalizeObject(request.Settings),
		ReentryBehavior: normalizeReentryBehavior(request.ReentryBehavior),
	}

	if request.TargetPipelineID != "" {
		value, ok := normalizeUUID(request.TargetPipelineID)
		if !ok {
			return createInput{}, fmt.Errorf("%w: targetPipelineId is invalid", ErrInvalidInput)
		}
		input.TargetPipelineID = &value
	}
	if request.TargetStageID != "" {
		value, ok := normalizeUUID(request.TargetStageID)
		if !ok {
			return createInput{}, fmt.Errorf("%w: targetStageId is invalid", ErrInvalidInput)
		}
		input.TargetStageID = &value
	}

	rules, err := normalizeRuleInputs(request.Conditions, request.Rules)
	if err != nil {
		return createInput{}, err
	}
	input.Rules = rules

	members, err := normalizeMemberInputs(request.Members)
	if err != nil {
		return createInput{}, err
	}
	input.Members = members

	return input, nil
}

func (request UpdateRequest) Validate() (updateInput, error) {
	input := updateInput{
		Name:             validatePatchString(request.Name, 120),
		Strategy:         validatePatchString(request.Strategy, 40),
		TargetPipelineID: request.TargetPipelineID,
		TargetStageID:    request.TargetStageID,
		IsActive:         request.IsActive,
		Settings:         request.Settings,
		ReentryBehavior:  validatePatchString(request.ReentryBehavior, 40),
		RulesSet:         request.ConditionsSet || request.RulesSet,
		MembersSet:       request.MembersSet,
	}

	if input.Name.Set && (input.Name.Value == nil || len([]rune(*input.Name.Value)) < 2) {
		return updateInput{}, fmt.Errorf("%w: name must have at least 2 characters", ErrInvalidInput)
	}

	if input.Strategy.Set && input.Strategy.Value != nil {
		value := normalizeStrategy(*input.Strategy.Value)
		input.Strategy.Value = &value
	}

	if input.TargetPipelineID.Set && input.TargetPipelineID.Value != nil {
		value, ok := normalizeUUID(*input.TargetPipelineID.Value)
		if !ok {
			return updateInput{}, fmt.Errorf("%w: targetPipelineId is invalid", ErrInvalidInput)
		}
		input.TargetPipelineID.Value = &value
	}
	if input.TargetStageID.Set && input.TargetStageID.Value != nil {
		value, ok := normalizeUUID(*input.TargetStageID.Value)
		if !ok {
			return updateInput{}, fmt.Errorf("%w: targetStageId is invalid", ErrInvalidInput)
		}
		input.TargetStageID.Value = &value
	}

	if input.ReentryBehavior.Set && input.ReentryBehavior.Value != nil {
		value := normalizeReentryBehavior(*input.ReentryBehavior.Value)
		input.ReentryBehavior.Value = &value
	}

	if input.RulesSet {
		rules, err := normalizeRuleInputs(request.Conditions, request.Rules)
		if err != nil {
			return updateInput{}, err
		}
		input.Rules = rules
	}

	if input.MembersSet {
		members, err := normalizeMemberInputs(request.Members)
		if err != nil {
			return updateInput{}, err
		}
		input.Members = members
	}

	if !input.hasChanges() {
		return updateInput{}, ErrNoChanges
	}

	return input, nil
}

func (request RuleRequest) Validate(pathRoundRobinID string) (ruleMutationInput, error) {
	roundRobinID := pathRoundRobinID
	if roundRobinID == "" {
		roundRobinID = request.RoundRobinID
	}
	value, ok := normalizeUUID(roundRobinID)
	if !ok {
		return ruleMutationInput{}, fmt.Errorf("%w: roundRobinId is invalid", ErrInvalidInput)
	}

	rule, err := normalizeRuleInput(RuleInput{
		MatchType:  request.MatchType,
		MatchValue: request.MatchValue,
		Match:      request.Match,
		Priority:   request.Priority,
		IsActive:   request.IsActive,
	}, 0)
	if err != nil {
		return ruleMutationInput{}, err
	}

	return ruleMutationInput{
		RoundRobinID: value,
		MatchType:    rule.MatchType,
		MatchValue:   rule.MatchValue,
		Match:        rule.Match,
		Priority:     rule.Priority,
		IsActive:     rule.IsActive,
	}, nil
}

func (request UpdateRuleRequest) Validate() (updateRuleInput, error) {
	input := updateRuleInput{
		MatchType:  validatePatchString(request.MatchType, 80),
		MatchValue: validatePatchString(request.MatchValue, 600),
		Match:      request.Match,
		Priority:   request.Priority,
		IsActive:   request.IsActive,
	}

	if input.MatchType.Set && (input.MatchType.Value == nil || *input.MatchType.Value == "") {
		return updateRuleInput{}, fmt.Errorf("%w: matchType is required", ErrInvalidInput)
	}

	if !input.MatchType.Set && !input.MatchValue.Set && !input.Match.Set && input.Priority == nil && !input.IsActive.Set {
		return updateRuleInput{}, ErrNoChanges
	}

	return input, nil
}

func (request MemberRequest) Validate() (memberMutationInput, error) {
	weight := 1
	if request.Weight != nil {
		if *request.Weight < 1 || *request.Weight > 1000 {
			return memberMutationInput{}, fmt.Errorf("%w: weight must be between 1 and 1000", ErrInvalidInput)
		}
		weight = *request.Weight
	}

	input := memberMutationInput{
		Type:     strings.TrimSpace(request.Type),
		EntityID: strings.TrimSpace(request.EntityID),
		Weight:   weight,
		Position: request.Position,
		IsActive: true,
	}
	if request.IsActive != nil {
		input.IsActive = *request.IsActive
	}

	if input.Type == "" {
		if request.TeamID != "" {
			input.Type = "team"
			input.EntityID = request.TeamID
		} else {
			input.Type = "user"
			input.EntityID = request.UserID
		}
	}
	if input.EntityID == "" {
		if input.Type == "team" {
			input.EntityID = request.TeamID
		} else {
			input.EntityID = request.UserID
		}
	}

	entityID, ok := normalizeUUID(input.EntityID)
	if !ok {
		return memberMutationInput{}, fmt.Errorf("%w: member entity id is invalid", ErrInvalidInput)
	}
	input.EntityID = entityID

	switch input.Type {
	case "user":
		input.UserID = &entityID
	case "team":
		input.TeamID = &entityID
	default:
		return memberMutationInput{}, fmt.Errorf("%w: member type is invalid", ErrInvalidInput)
	}

	return input, nil
}

func (request UpdateMemberRequest) Validate() (updateMemberInput, error) {
	if request.Weight != nil && (*request.Weight < 1 || *request.Weight > 1000) {
		return updateMemberInput{}, fmt.Errorf("%w: weight must be between 1 and 1000", ErrInvalidInput)
	}
	if request.Position != nil && *request.Position < 0 {
		return updateMemberInput{}, fmt.Errorf("%w: position must be positive", ErrInvalidInput)
	}
	if request.Weight == nil && request.Position == nil && !request.IsActive.Set {
		return updateMemberInput{}, ErrNoChanges
	}
	return updateMemberInput(request), nil
}

func (input updateInput) hasChanges() bool {
	return input.Name.Set ||
		input.Strategy.Set ||
		input.TargetPipelineID.Set ||
		input.TargetStageID.Set ||
		input.IsActive.Set ||
		input.Settings.Set ||
		input.ReentryBehavior.Set ||
		input.RulesSet ||
		input.MembersSet
}

func normalizeRuleInputs(conditions []ConditionInput, rules []RuleInput) ([]ruleInput, error) {
	out := make([]ruleInput, 0, len(conditions)+len(rules))
	for index, condition := range conditions {
		rule, err := condition.toRuleInput(index)
		if err != nil {
			return nil, err
		}
		if rule.MatchValue == "" {
			continue
		}
		out = append(out, rule)
	}

	offset := len(out)
	for index, rule := range rules {
		normalized, err := normalizeRuleInput(rule, offset+index)
		if err != nil {
			return nil, err
		}
		if normalized.MatchValue == "" {
			continue
		}
		out = append(out, normalized)
	}

	return out, nil
}

func (condition ConditionInput) toRuleInput(index int) (ruleInput, error) {
	matchType := trimMax(condition.Type, 80)
	if matchType == "" {
		return ruleInput{}, fmt.Errorf("%w: condition type is required", ErrInvalidInput)
	}

	values := make([]string, 0, len(condition.Values))
	for _, value := range condition.Values {
		value = trimMax(value, 180)
		if value != "" {
			values = append(values, value)
		}
	}

	return ruleInput{
		MatchType:  matchType,
		MatchValue: strings.Join(values, ","),
		Match:      buildRuleMatch(matchType, values),
		Priority:   1000 - index,
		IsActive:   true,
	}, nil
}

func normalizeRuleInput(input RuleInput, index int) (ruleInput, error) {
	matchType := trimMax(input.MatchType, 80)
	if matchType == "" {
		return ruleInput{}, fmt.Errorf("%w: matchType is required", ErrInvalidInput)
	}

	matchValue := trimMax(input.MatchValue, 600)
	isActive := true
	if input.IsActive != nil {
		isActive = *input.IsActive
	}
	priority := 1000 - index
	if input.Priority != nil {
		priority = *input.Priority
	}
	if priority < 0 {
		priority = 0
	}

	match := normalizeObject(input.Match)
	if len(match) == 0 && matchValue != "" {
		match = buildRuleMatch(matchType, splitValues(matchValue))
	}

	return ruleInput{
		MatchType:  matchType,
		MatchValue: matchValue,
		Match:      match,
		Priority:   priority,
		IsActive:   isActive,
	}, nil
}

func normalizeMemberInputs(members []MemberInput) ([]memberInput, error) {
	out := make([]memberInput, 0, len(members))
	for _, member := range members {
		weight := 1
		if member.Weight != nil {
			if *member.Weight < 1 || *member.Weight > 1000 {
				return nil, fmt.Errorf("%w: member weight must be between 1 and 1000", ErrInvalidInput)
			}
			weight = *member.Weight
		}

		memberType := strings.TrimSpace(member.Type)
		entityID := strings.TrimSpace(member.EntityID)
		if memberType == "" {
			if member.TeamID != "" {
				memberType = "team"
				entityID = member.TeamID
			} else {
				memberType = "user"
				entityID = member.UserID
			}
		}
		if entityID == "" {
			if memberType == "team" {
				entityID = member.TeamID
			} else {
				entityID = member.UserID
			}
		}

		entityID, ok := normalizeUUID(entityID)
		if !ok {
			return nil, fmt.Errorf("%w: member entity id is invalid", ErrInvalidInput)
		}

		item := memberInput{
			Type:     memberType,
			EntityID: entityID,
			Weight:   weight,
		}
		switch memberType {
		case "user":
			item.UserID = &entityID
		case "team":
			item.TeamID = &entityID
		default:
			return nil, fmt.Errorf("%w: member type is invalid", ErrInvalidInput)
		}

		out = append(out, item)
	}

	return out, nil
}

func buildRuleMatch(matchType string, values []string) map[string]any {
	switch matchType {
	case "source":
		return map[string]any{"source": values}
	case "webhook":
		return map[string]any{"webhook_id": values}
	case "whatsapp_session":
		return map[string]any{"whatsapp_session_id": values}
	case "meta_form":
		return map[string]any{"meta_form_id": values}
	case "website_category":
		return map[string]any{"website_category": values}
	case "campaign_contains":
		value := ""
		if len(values) > 0 {
			value = values[0]
		}
		return map[string]any{"campaign_name_contains": value}
	case "tag":
		return map[string]any{"tag_in": values}
	case "city":
		return map[string]any{"city_in": values}
	case "interest_property":
		value := ""
		if len(values) > 0 {
			value = values[0]
		}
		return map[string]any{"interest_property_id": value}
	default:
		return map[string]any{}
	}
}

func normalizeStrategy(value string) string {
	value = trimMax(strings.ToLower(value), 40)
	if value == "" {
		return "simple"
	}
	if value != "simple" && value != "weighted" {
		return "simple"
	}
	return value
}

func normalizeReentryBehavior(value string) string {
	value = trimMax(value, 40)
	if value == "" {
		return "redistribute"
	}
	if value != "redistribute" && value != "keep_assignee" {
		return "redistribute"
	}
	return value
}

func normalizeObject(value map[string]any) map[string]any {
	if value == nil {
		return map[string]any{}
	}
	return value
}

func splitValues(value string) []string {
	parts := strings.Split(value, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			out = append(out, part)
		}
	}
	return out
}

func validatePatchString(field patchString, maxLength int) patchString {
	if !field.Set || field.Value == nil {
		return field
	}

	value := trimMax(*field.Value, maxLength)
	field.Value = &value
	return field
}

func trimMax(value string, maxLength int) string {
	value = strings.TrimSpace(value)
	runes := []rune(value)
	if len(runes) > maxLength {
		return string(runes[:maxLength])
	}
	return value
}

func normalizeUUID(value string) (string, bool) {
	var uuid pgtype.UUID
	if err := uuid.Scan(strings.TrimSpace(value)); err != nil {
		return "", false
	}
	if !uuid.Valid {
		return "", false
	}
	return uuid.String(), true
}
