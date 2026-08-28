package roundrobin

import (
	"errors"
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestResolveDirectUserTeamIDAttachesOnlyActiveTeam(t *testing.T) {
	teamID := "11111111-1111-4111-8111-111111111111"
	resolved, err := resolveDirectUserTeamID([]string{teamID}, nil, false)
	if err != nil {
		t.Fatalf("resolveDirectUserTeamID() error = %v", err)
	}
	if resolved == nil || *resolved != teamID {
		t.Fatalf("resolved team = %#v, want %q", resolved, teamID)
	}
}

func TestResolveDirectUserTeamIDRequiresExplicitTeamForMultipleMemberships(t *testing.T) {
	teamA := "11111111-1111-4111-8111-111111111111"
	teamB := "22222222-2222-4222-8222-222222222222"
	if _, err := resolveDirectUserTeamID([]string{teamA, teamB}, nil, true); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("error = %v, want ErrInvalidInput", err)
	}

	resolved, err := resolveDirectUserTeamID([]string{teamA, teamB}, &teamB, false)
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
	if _, err := resolveDirectUserTeamID([]string{activeTeamID}, &requestedTeamID, true); !errors.Is(err, ErrInvalidReference) {
		t.Fatalf("error = %v, want ErrInvalidReference", err)
	}
}

func TestResolveDirectUserTeamIDRequiresTeamUnlessBypassIsExplicit(t *testing.T) {
	if _, err := resolveDirectUserTeamID(nil, nil, false); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("error = %v, want ErrInvalidInput", err)
	}

	resolved, err := resolveDirectUserTeamID(nil, nil, true)
	if err != nil {
		t.Fatalf("explicit bypass error = %v", err)
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
