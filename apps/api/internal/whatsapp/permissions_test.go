package whatsapp

import (
	"testing"

	"github.com/vimob-crm/vimob-crm/apps/api/internal/permissions"
	"github.com/vimob-crm/vimob-crm/apps/api/internal/tenant"
)

func TestCanViewAllWhatsAppLeadsDoesNotBypassManagerOverrides(t *testing.T) {
	manager := tenant.Context{UserID: "manager", OrganizationID: "org", MemberRole: "manager"}
	if canViewAllWhatsAppLeads(manager) {
		t.Fatal("manager role must not grant organization-wide WhatsApp lead visibility implicitly")
	}

	manager.Permissions = []string{permissions.LeadViewAll}
	if !canViewAllWhatsAppLeads(manager) {
		t.Fatal("explicit lead_view_all permission must grant organization-wide visibility")
	}
}
