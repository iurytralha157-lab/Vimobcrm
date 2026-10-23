package me

import (
	"errors"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
	authpkg "github.com/vimob-crm/vimob-crm/packages/auth"
)

var ErrInvalidInput = errors.New("invalid me input")

type SessionProfile struct {
	User         authpkg.User   `json:"user"`
	Context      tenant.Context `json:"context"`
	Profile      map[string]any `json:"profile"`
	Organization map[string]any `json:"organization"`
}

type AccountStatus struct {
	ProfileExists  bool `json:"profileExists"`
	GloballyActive bool `json:"globallyActive"`
	IsSuperAdmin   bool `json:"isSuperAdmin"`
}

type SwitchOrganizationRequest struct {
	OrganizationID string `json:"organizationId"`
}
