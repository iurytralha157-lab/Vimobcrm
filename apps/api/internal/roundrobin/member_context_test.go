package roundrobin

import (
	"errors"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestResolveDirectUserTeamIDKeepsDirectUserWithoutTeam(t *testing.T) {
	teamID := "11111111-1111-4111-8111-111111111111"
	resolved, err := resolveDirectUserTeamID([]string{teamID}, nil)
	if err != nil {
		t.Fatalf("resolveDirectUserTeamID() error = %v", err)
	}
	if resolved != nil {
		t.Fatalf("resolved team = %#v, want nil", resolved)
	}
}

func TestResolveDirectUserTeamIDAllowsDirectUserWithMultipleMemberships(t *testing.T) {
	teamA := "11111111-1111-4111-8111-111111111111"
	teamB := "22222222-2222-4222-8222-222222222222"
	resolved, err := resolveDirectUserTeamID([]string{teamA, teamB}, nil)
	if err != nil {
		t.Fatalf("resolve direct user: %v", err)
	}
	if resolved != nil {
		t.Fatalf("resolved team = %#v, want nil", resolved)
	}

	resolved, err = resolveDirectUserTeamID([]string{teamA, teamB}, &teamB)
	if err != nil {
		t.Fatalf("resolve explicit team: %v", err)
	}
	if resolved == nil || *resolved != teamB {
		t.Fatalf("resolved team = %#v, want %q", resolved, teamB)
	}
}

func TestResolveDirectUserTeamIDRejectsForeignOrInactiveContext(t *testing.T) {
	activeTeamID := "11111111-1111-4111-8111-111111111111"
	requestedTeamID := "22222222-2222-4222-8222-222222222222"
	if _, err := resolveDirectUserTeamID([]string{activeTeamID}, &requestedTeamID); !errors.Is(err, ErrInvalidReference) {
		t.Fatalf("error = %v, want ErrInvalidReference", err)
	}
}

func TestResolveDirectUserTeamIDAllowsUserWithoutMembership(t *testing.T) {
	resolved, err := resolveDirectUserTeamID(nil, nil)
	if err != nil {
		t.Fatalf("direct user error = %v", err)
	}
	if resolved != nil {
		t.Fatalf("explicit bypass team = %#v, want nil", resolved)
	}
}

func TestEnsureResolvedMemberInScopeChecksAutoAttachedTeamAndUser(t *testing.T) {
	teamID := "11111111-1111-4111-8111-111111111111"
	userID := "22222222-2222-4222-8222-222222222222"
	context := tenant.Context{
		MemberRole:   "user",
		IsTeamLeader: true,
		LedTeamIDs:   []string{teamID},
		LedUserIDs:   []string{userID},
	}
	if err := ensureResolvedMemberInScope(context, &userID, &teamID); err != nil {
		t.Fatalf("expected resolved member in scope: %v", err)
	}

	foreignTeamID := "33333333-3333-4333-8333-333333333333"
	if err := ensureResolvedMemberInScope(context, &userID, &foreignTeamID); !errors.Is(err, tenant.ErrOrganizationAccessDenied) {
		t.Fatalf("foreign team error = %v, want access denied", err)
	}
}
