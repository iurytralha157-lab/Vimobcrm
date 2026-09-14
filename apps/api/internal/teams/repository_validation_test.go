package teams

import (
	"errors"
	"os"
	"strings"
	"testing"
)

func TestTeamMutationBoundsMatchFrontendContract(t *testing.T) {
	if _, err := normalizeTeamName(strings.Repeat("a", maxTeamNameLength)); err != nil {
		t.Fatalf("maximum team name rejected: %v", err)
	}
	if _, err := normalizeTeamName(strings.Repeat("a", maxTeamNameLength+1)); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("oversized team name error = %v, want ErrInvalidInput", err)
	}

	validLogo := "https://example.test/" + strings.Repeat("a", maxTeamLogoURLLength-len("https://example.test/"))
	if !validTeamLogoURL(&validLogo) {
		t.Fatal("maximum logo URL was rejected")
	}
	oversizedLogo := validLogo + "a"
	if validTeamLogoURL(&oversizedLogo) {
		t.Fatal("oversized logo URL was accepted")
	}

	members := make([]TeamMemberInput, maxTeamMembers+1)
	for index := range members {
		members[index].UserID = testTeamMemberID
	}
	if _, err := normalizeMembersStrict(members); !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("oversized member list error = %v, want ErrInvalidInput", err)
	}
}

func TestNormalizeMembersStrictRejectsMalformedID(t *testing.T) {
	_, err := normalizeMembersStrict([]TeamMemberInput{{UserID: "not-a-uuid"}})
	if !errors.Is(err, ErrInvalidInput) {
		t.Fatalf("malformed member id error = %v, want ErrInvalidInput", err)
	}
}

func TestUpdateRequiresAnActualMutationField(t *testing.T) {
	if hasTeamUpdate(UpdateTeamRequest{}) {
		t.Fatal("empty update must not be accepted")
	}
	if hasTeamUpdate(UpdateTeamRequest{PreserveLeadership: true}) {
		t.Fatal("preserveLeadership alone is not a mutation")
	}
	emptyMembers := []TeamMemberInput{}
	if !hasTeamUpdate(UpdateTeamRequest{Members: emptyMembers}) {
		t.Fatal("an explicit empty member list must remain a valid mutation")
	}
}

func TestTeamWritesDoNotRecreateUnchangedSchedules(t *testing.T) {
	source, err := os.ReadFile("repository.go")
	if err != nil {
		t.Fatalf("read repository source: %v", err)
	}
	normalized := strings.ToLower(string(source))
	if strings.Contains(normalized, "delete from public.member_availability") {
		t.Fatal("complete schedule writes must upsert days instead of delete/recreate")
	}
	for _, fragment := range []string{
		"current_availability.start_time",
		"is distinct from",
		"on conflict (team_id, user_id) do update",
		"jsonb_to_recordset($2::jsonb)",
		"jsonb_to_recordset($3::jsonb)",
	} {
		if !strings.Contains(normalized, fragment) {
			t.Fatalf("no-op write protection must contain %q", fragment)
		}
	}
}
