package permissions

import "testing"

func TestUsersPresenceViewIsGrantedToAdminsAndTeamLeadersOnlyByDefault(t *testing.T) {
	if !IsKnown(UsersPresenceView) {
		t.Fatalf("%s must be part of the permission catalog", UsersPresenceView)
	}
	if Has(Resolve("user", false, nil, nil), UsersPresenceView) {
		t.Fatal("standard users must not receive presence visibility by default")
	}
	if Has(Resolve("manager", false, nil, nil), UsersPresenceView) {
		t.Fatal("managers must not receive presence visibility without an explicit grant")
	}
	if !Has(Resolve("user", true, nil, nil), UsersPresenceView) {
		t.Fatal("active team leaders must receive presence visibility by default")
	}
	if Has(Resolve("user", true, nil, map[string]bool{UsersPresenceView: false}), UsersPresenceView) {
		t.Fatal("an explicit user override must be able to revoke leader presence visibility")
	}
	if !Has(Resolve("user", false, []string{UsersPresenceView}, nil), UsersPresenceView) {
		t.Fatal("custom roles must retain explicitly configured presence permission data")
	}
	if !Has(Resolve("admin", false, nil, nil), UsersPresenceView) {
		t.Fatal("administrators must inherit the permission wildcard")
	}
}
